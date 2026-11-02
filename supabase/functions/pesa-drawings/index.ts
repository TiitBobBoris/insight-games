// Pesa maja jooniste müük (Stripe Checkout) ja allalaadimine.
//
//   GET  ?a=info                         → hinnad + kas makse on seadistatud (leht joonised.html)
//   GET  ?a=lead&t=…                     → päringu nimi/e-post/mudel/suurus (järelkirja lingist, eeltäitmiseks)
//   POST ?a=checkout {model,size,email,name,t,consent} → Stripe Checkout'i URL
//   GET  ?a=done&session_id=…            → pärast makset: kontrolli, väljasta, suuna tänulehele
//   POST ?a=webhook                      → Stripe'i sündmused (varuvariant, kui klient sulges akna)
//   GET  ?a=dl&o=…                       → suunab allalaadimisele (www.sportsport.ee/pesa/joonised-dl.php)
//   GET  ?a=check&o=… / ?a=consumed&o=…  → joonised-dl.php küsib, kas link kehtib, ja märgib allalaadimise tehtuks
//
// Secret: STRIPE_SECRET_KEY (sk_test_… või sk_live_…); live-võti võib olla ka nime Pesa-joonised all (eelistatud). Webhooki ja KM-määra loob funktsioon ise
// esimese makse eel ning hoiab nende id-d tabelis pesa_secrets.
// Failid: sportsport.ee serveris pesa/_joonised/PESA-1/89-7.zip jne (otse ligipääs keelatud).
// Lülitid pesa_settings: drawings_ready (on = failid üleval), download_max (täielike allalaadimiste arv, vaikimisi 1).
import { createClient } from 'npm:@supabase/supabase-js@2.49.10';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const SITE = 'https://www.sportsport.ee/pesa';
const PAGE = `${SITE}/joonised.html`;
const FN_URL = 'https://xlhtavzsanlikmxrddrb.supabase.co/functions/v1/pesa-drawings';
const LOGO = `${SITE}/tube-assets/email/projektbyroo-sport-logo.png`;
const MODELS = ['PESA 1', 'PESA 2', 'PESA 3', 'PESA 4'];
const SLUG: Record<string, string> = { '89,7 m²': '89-7', '109,7 m²': '109-7', '123,4 m²': '123-4' };
const ROOMS: Record<string, string> = { '89,7 m²': '2 magamistuba', '109,7 m²': '3 magamistuba', '123,4 m²': '4 magamistuba' };
// Tagasisuunamine lubatud ainult nendele lehtedele (localhost: arendus).
const ORIGINS = [/^https:\/\/www\.sportsport\.ee\/pesa\//, /^https:\/\/tube-majad\.vercel\.app\//, /^http:\/\/(localhost|127\.0\.0\.1):\d+\//];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const text = (t: string, status = 200) =>
  new Response(`${t}\n\nPesa majad: ${SITE}/\n`, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

const eur = (n: number) => n.toLocaleString('et-EE', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ') + ' €';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const firstName = (n: string) => (n || '').trim().split(/\s+/)[0] || '';
const fmtDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d}.${+m}.${y}`; };
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

type Order = {
  id: string; created_at: string; stripe_session_id: string; stripe_mode: string; request_id: string | null;
  email: string; name: string | null; model: string; size: string; amount_net: number; amount_total: number;
  license_accepted_at: string | null; invoice_url: string | null; file_path: string | null;
  download_token: string; downloads: number; expires_at: string; delivered_at: string | null;
};

// --- Stripe REST (vormikodeering, ilma SDK-ta)
function form(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}
const stripeKey = () => (Deno.env.get('Pesa-joonised') || Deno.env.get('STRIPE_SECRET_KEY') || '').trim();
async function stripe(path: string, method = 'GET', body?: Record<string, unknown>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${stripeKey()}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: body ? form(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message || ''}`.slice(0, 300));
  return data;
}
const stripeMode = () => (/^(sk|rk)_live_/.test(stripeKey()) ? 'live' : 'test');

async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function resend(body: Record<string, unknown>) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

let logoBytes: Uint8Array | null = null;
async function getLogo() {
  if (!logoBytes) { try { const r = await fetch(LOGO); if (r.ok) logoBytes = new Uint8Array(await r.arrayBuffer()); } catch (_) { /* ilma logota */ } }
  return logoBytes;
}

// Litsentsileping PDF-ina (manus kliendi kirjale).
async function licensePdf(o: Order) {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.11, 0.12), mute = rgb(0.43, 0.43, 0.45);
  const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF€–—‘’“”„•…šžŠŽ]/g, '?');
  let y = 780;
  const t = (s: string, x: number, size = 10.5, font = f, color = ink) => pg.drawText(safe(s), { x, y, size, font, color });
  const lb = await getLogo();
  if (lb) { const img = await doc.embedPng(lb); const w = 110, h = w * img.height / img.width; pg.drawImage(img, { x: 56, y: 790 - h, width: w, height: h }); y = 790 - h - 30; }
  t('Litsentsileping: Pesa maja joonised', 56, 18, b); y -= 24;
  t(`Tellimus ${o.id.slice(0, 8).toUpperCase()} · ${fmtDate(o.created_at)}`, 56, 10, f, mute); y -= 26;
  const para = (h: string, txt: string) => {
    if (h) { t(h, 56, 11, b); y -= 15; }
    let line = '';
    for (const w of txt.split(' ')) {
      if (f.widthOfTextAtSize(line + ' ' + w, 10.5) > 483) { t(line.trim(), 56); y -= 14; line = ''; }
      line += ' ' + w;
    }
    if (line.trim()) { t(line.trim(), 56); y -= 14; }
    y -= 8;
  };
  para('1. Pooled', `Litsentsiandja: Projektbüroo Sport OÜ (edaspidi Projektbüroo). Litsentsisaaja: ${o.name || o.email}, ${o.email}.`);
  para('2. Litsentsi objekt', `${o.model} ${o.size} (${ROOMS[o.size] || ''}) eelprojekti mahus arhitektuursed joonised ja pindade tabelid failivormingutes PDF, DWG, ArchiCAD (PLA), SketchUp (SKP) ja XLS. Tasu: ${eur(Number(o.amount_net))} + km (kokku ${eur(Number(o.amount_total))}).`);
  para('3. Lubatud kasutus', 'Lihtlitsents (mitte-ainulitsents) ühe (1) hoone projekteerimiseks ja ehitamiseks ühel kinnistul. Litsentsisaaja võib jooniseid muuta ja kohandada ise või lasta neid kohandada enda valitud pädeval projekteerijal ehitusloa ja ehitusprojekti koostamiseks.');
  para('4. Keelatud', 'Jooniste või nende osade edasimüük, jagamine, avaldamine ja üleandmine kolmandatele isikutele (v.a litsentsisaaja projekteerija, ehitaja ja ametiasutused sama hoone tarbeks), kasutamine rohkem kui ühe hoone jaoks ning tüüpprojektina pakkumine.');
  para('5. Autoriõigus', 'Autoriõigus jääb Projektbüroole ja autoritele. Autori isiklikud õigused, sh õigus nimele, säilivad.');
  para('6. Vastutus', 'Joonised on arhitektuurne lähtematerjal. Ehitusloa projekti, kohandatud lahenduse, konstruktsioonide ja eriosade eest vastutab litsentsisaaja valitud pädev projekteerija. Projektbüroo ei vastuta kolmandate isikute tehtud muudatuste ega nende põhjal tehtud ehitustööde eest.');
  para('7. Taganemisõigus', `Litsentsisaaja nõustus ${o.license_accepted_at ? fmtDate(o.license_accepted_at) + ' ' : ''}digitaalse sisu kohese kättesaadavaks tegemisega ja kinnitas teadmist, et kaotab sellega 14-päevase taganemisõiguse (VÕS § 53 lg 4 p 13).`);
  para('8. Kehtivus', 'Leping jõustub tasu laekumisel. Lepingule kohaldatakse Eesti õigust. Küsimused: tiit@sportsport.ee, +372 5560 1425.');
  y = 70;
  t('Projektbüroo Sport OÜ · tiit@sportsport.ee · +372 5560 1425 · www.sportsport.ee/pesa', 56, 9, f, mute);
  const bytes = await doc.save();
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function clientHtml(o: Order, dl: string, hasFile: boolean) {
  const until = fmtDate(o.expires_at);
  const btn = hasFile
    ? `<p style="margin:0 0 14px"><a href="${esc(dl)}" style="display:inline-block;background:#1d1d1f;color:#fff;text-decoration:none;border-radius:980px;padding:13px 24px;font-size:16px">Laadi joonised alla</a></p>
       <p style="font-size:14px;line-height:1.5;color:#6e6e73;margin:0 0 26px">Link on ühekordne ja kehtib kuni ${until}: see sulgub pärast täielikku allalaadimist (katkenud allalaadimist võid korrata). Pakk on umbes 140 MB – salvesta see endale.</p>`
    : `<p style="font-size:16px;line-height:1.55;margin:0 0 26px">Valmistame sinu failid ette ja saadame allalaadimislingi ühe tööpäeva jooksul.</p>`;
  return `<!doctype html><html lang="et"><body style="margin:0;background:#f5f5f7">
<div style="max-width:600px;margin:0 auto;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#1d1d1f">
  <div style="padding:26px 32px 20px"><img src="${LOGO}" width="132" alt="Projektbüroo Sport" style="display:block;width:132px;height:auto;border:0"></div>
  <img src="${SITE}/tube-assets/email/tube-0${MODELS.indexOf(o.model) + 1 || 1}-${SLUG[o.size] || '109-7'}.jpg" width="600" alt="${esc(o.model)}" style="display:block;width:100%;height:auto">
  <div style="padding:32px 32px 8px">
    <h1 style="font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:0 0 16px">Sinu ${esc(o.model)} joonised</h1>
    <p style="font-size:17px;line-height:1.5;margin:0 0 20px">Tere${firstName(o.name || '') ? ', ' + esc(firstName(o.name || '')) : ''}!<br>Aitäh ostu eest. Sinu pakis on ${esc(o.model)} ${esc(o.size)} eelprojekti mahus joonised (PDF, DWG, ArchiCAD ja SketchUp) ning pindade tabelid.</p>
    ${btn}
    <p style="font-size:16px;line-height:1.55;margin:0 0 12px">Litsentsileping on kirja manuses: joonised on ühe hoone ehitamiseks ja võid neid ise või oma arhitekti abiga kohandada. Edasimüük ja jagamine ei ole lubatud.</p>
    ${o.invoice_url ? `<p style="font-size:16px;line-height:1.55;margin:0 0 12px"><a href="${esc(o.invoice_url)}" style="color:#06c">Vaata arvet →</a></p>` : ''}
    <p style="font-size:16px;line-height:1.55;margin:0 0 28px">Kui soovid, et kohandame projekti sinu krundile ja taotleme ehitusloa, vasta sellele kirjale.</p>
    <p style="font-size:16px;line-height:1.55;margin:0 0 28px">Parimate soovidega<br><strong>Tiit Sild</strong><br>arhitekt, Projektbüroo Sport OÜ<br><a href="tel:+37255601425" style="color:#1d1d1f">+372 5560 1425</a></p>
  </div>
</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const u = new URL(req.url), a = u.searchParams.get('a');
  const TIIT = Deno.env.get('TUBE_OFFER_TO') || 'tiit@sportsport.ee';

  const { data: st } = await sb.from('pesa_settings').select('key,value');
  const set = Object.fromEntries((st || []).map((x) => [x.key, x.value]));
  const VAT = Number(set.vat_percent || 24);
  const { data: prices } = await sb.from('pesa_prices').select('size,drawings_price').order('sort');
  const priceOf = (size: string) => Number((prices || []).find((p) => p.size === size)?.drawings_price || 0);
  const ready = !!stripeKey();

  const secret = async (k: string) => (await sb.from('pesa_secrets').select('value').eq('key', k).maybeSingle()).data?.value as string | undefined;
  const putSecret = (k: string, v: string) => sb.from('pesa_secrets').upsert({ key: k, value: v, updated_at: new Date().toISOString() });

  // KM-määr ja webhook luuakse Stripe'is esimesel vajadusel (eraldi test- ja live-režiimile).
  async function taxRate() {
    const k = `stripe_tax_rate_${stripeMode()}_${VAT}`;
    let id = await secret(k);
    if (!id) {
      const tr = await stripe('tax_rates', 'POST', { display_name: 'KM', description: `Käibemaks ${VAT}%`, percentage: VAT, inclusive: false, country: 'EE', jurisdiction: 'EE' });
      id = tr.id as string; await putSecret(k, id);
    }
    return id;
  }
  async function ensureWebhook() {
    const k = `stripe_whsec_${stripeMode()}`;
    if (await secret(k)) return;
    const url = `${FN_URL}?a=webhook`;
    const list = await stripe('webhook_endpoints?limit=100');
    for (const w of list.data || []) if (w.url === url) await stripe(`webhook_endpoints/${w.id}`, 'DELETE');
    const w = await stripe('webhook_endpoints', 'POST', {
      url, description: 'Pesa majad: jooniste väljastamine',
      enabled_events: { 0: 'checkout.session.completed', 1: 'checkout.session.async_payment_succeeded' },
    });
    await putSecret(k, w.secret);
  }

  const MAX_DL = Number(set.download_max || 1);
  const downloadPath = (model: string, size: string) =>
    set.drawings_ready === 'on' && SLUG[size] && MODELS.includes(model) ? `${model.replace(/\s+/g, '-')}/${SLUG[size]}.zip` : null;

  // Makstud sessioonist tellimus + kirjad. Korduv kutse (tänuleht + webhook) ei saada topelt.
  async function fulfill(sessionId: string): Promise<Order | null> {
    const s = await stripe(`checkout/sessions/${sessionId}?expand[]=invoice`);
    if (s.payment_status !== 'paid') return null;
    const m = s.metadata || {};
    const row = {
      stripe_session_id: s.id, stripe_mode: s.livemode ? 'live' : 'test',
      request_id: m.request_id || null, email: s.customer_details?.email || s.customer_email, name: s.customer_details?.name || m.name || null,
      model: m.model, size: m.size, amount_net: (s.amount_subtotal || 0) / 100, amount_total: (s.amount_total || 0) / 100,
      license_accepted_at: m.consent_at || null, invoice_url: s.invoice?.hosted_invoice_url || null,
    };
    const { data: ins } = await sb.from('pesa_drawing_orders').upsert(row, { onConflict: 'stripe_session_id', ignoreDuplicates: true }).select();
    if (!ins?.length) return (await sb.from('pesa_drawing_orders').select('*').eq('stripe_session_id', s.id).single()).data as Order;
    const o = ins[0] as Order;
    const file = downloadPath(o.model, o.size);
    const dl = `${FN_URL}?a=dl&o=${o.download_token}`;
    let err: string | null = null;
    try {
      await resend({
        from: set.client_from || 'Tiit Sild | Pesa majad <tiit@send.sportsport.ee>', to: [o.email], reply_to: TIIT, bcc: [TIIT],
        subject: `Sinu ${o.model} joonised (${o.size})`, html: clientHtml(o, dl, !!file),
        attachments: [{ filename: 'Pesa-joonised-litsentsileping.pdf', content: await licensePdf(o) }],
      });
    } catch (e) { err = (e as Error).message; }
    try {
      await resend({
        from: set.admin_from || 'Pesa majad <pesa@send.sportsport.ee>', to: [TIIT], reply_to: o.email,
        subject: `${s.livemode ? '' : '[TEST] '}Joonised müüdud: ${o.model} ${o.size} – ${o.name || o.email}`,
        text: [`${o.name || ''} <${o.email}>`, `${o.model} · ${o.size}`, `Summa: ${eur(Number(o.amount_total))} (km-ta ${eur(Number(o.amount_net))})`,
          file ? `Fail: ${file} (link saadetud)` : 'FAILID POLE VEEL SERVERIS (drawings_ready ≠ on) – saada kliendile link käsitsi (klient sai teate „1 tööpäeva jooksul").',
          o.invoice_url ? `Arve: ${o.invoice_url}` : '', err ? `Kliendikirja viga: ${err}` : ''].filter(Boolean).join('\n'),
      });
    } catch (_) { /* Tiidu teavitus pole kriitiline */ }
    await sb.from('pesa_drawing_orders').update({ file_path: file, delivered_at: err ? null : new Date().toISOString(), error: err }).eq('id', o.id);
    // Seo ost päringuga (järelkirja lingis tokenit pole, seega vajadusel e-posti järgi).
    let rid = o.request_id;
    if (!rid) rid = (await sb.from('tube_offer_requests').select('id').ilike('email', o.email).order('created_at', { ascending: false }).limit(1).maybeSingle()).data?.id || null;
    if (rid) {
      await sb.from('tube_offer_requests').update({ status: 'drawings_bought' }).eq('id', rid);
      if (!o.request_id) await sb.from('pesa_drawing_orders').update({ request_id: rid }).eq('id', o.id);
    }
    return { ...o, file_path: file };
  }

  try {
    if (a === 'info') {
      return json({ ready, mode: ready ? stripeMode() : null, vat: VAT, models: MODELS, prices: (prices || []).map((p) => ({ size: p.size, net: Number(p.drawings_price), rooms: ROOMS[p.size] })) });
    }

    if (a === 'lead') {
      const t = u.searchParams.get('t') || '';
      if (!/^[0-9a-f-]{16,}$/i.test(t)) return json({});
      const { data } = await sb.from('tube_offer_requests').select('name,email,model,size').eq('token', t).maybeSingle();
      return json(data || {});
    }

    if (a === 'checkout' && req.method === 'POST') {
      if (!ready) return json({ error: 'Makse pole veel seadistatud.' }, 503);
      const b = await req.json().catch(() => ({}));
      const model = String(b.model || ''), size = String(b.size || ''), email = String(b.email || '').trim(), name = String(b.name || '').trim().slice(0, 120);
      const net = priceOf(size);
      if (!MODELS.includes(model) || !net) return json({ error: 'Vali maja ja suurus.' }, 400);
      if (email && !emailOk(email)) return json({ error: 'Kontrolli e-posti aadressi.' }, 400);
      if (!b.consent) return json({ error: 'Nõustu litsentsi ja kohese kättesaadavaks tegemisega.' }, 400);
      const back = String(b.return || PAGE);
      const page = ORIGINS.some((r) => r.test(back)) ? back.split('?')[0] : PAGE;
      let requestId: string | null = null;
      if (b.t && /^[0-9a-f-]{16,}$/i.test(String(b.t))) requestId = (await sb.from('tube_offer_requests').select('id').eq('token', String(b.t)).maybeSingle()).data?.id || null;
      const [tax] = await Promise.all([taxRate(), ensureWebhook()]);
      const s = await stripe('checkout/sessions', 'POST', {
        mode: 'payment', locale: 'et',
        line_items: { 0: { quantity: 1, tax_rates: { 0: tax }, price_data: {
          currency: 'eur', unit_amount: Math.round(net * 100), tax_behavior: 'exclusive',
          product_data: { name: `${model} joonised · ${size}`, description: 'PDF, DWG ja ArchiCAD. Litsents ühe hoone ehitamiseks.' },
        } } },
        customer_email: email || undefined,
        customer_creation: 'always',
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true },
        invoice_creation: { enabled: true, invoice_data: {
          description: `${model} ${size} joonised (PDF, DWG, PLN). Lihtlitsents ühe hoone ehitamiseks.`,
          footer: 'Projektbüroo Sport OÜ · tiit@sportsport.ee · +372 5560 1425',
          metadata: { model, size },
        } },
        metadata: { model, size, name, request_id: requestId || '', consent_at: new Date().toISOString() },
        payment_intent_data: { description: `${model} joonised ${size}` },
        custom_text: { submit: { message: 'Pärast makset saad allalaadimislingi ja litsentsilepingu e-postile.' } },
        success_url: `${FN_URL}?a=done&session_id={CHECKOUT_SESSION_ID}&r=${encodeURIComponent(page)}`,
        cancel_url: `${page}?maja=${encodeURIComponent(model)}&suurus=${encodeURIComponent(size)}${b.t ? '&t=' + encodeURIComponent(String(b.t)) : ''}`,
      });
      return json({ url: s.url });
    }

    if (a === 'done') {
      const id = u.searchParams.get('session_id') || '', r = u.searchParams.get('r') || PAGE;
      const page = ORIGINS.some((x) => x.test(r)) ? r : PAGE;
      if (!/^cs_(test|live)_\w+$/.test(id)) return redirect(page);
      const o = await fulfill(id).catch(() => null);
      if (!o) return redirect(`${page}?ok=pending`);
      return redirect(`${page}?ok=1&maja=${encodeURIComponent(o.model)}&suurus=${encodeURIComponent(o.size)}${o.file_path ? '&o=' + o.download_token : ''}`);
    }

    if (a === 'webhook' && req.method === 'POST') {
      const raw = await req.text();
      const sig = req.headers.get('stripe-signature') || '';
      const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=') as [string, string]));
      const ts = Number(parts.t || 0), v1s = sig.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
      const whsec = await secret(`stripe_whsec_${stripeMode()}`);
      if (!whsec || !ts || Math.abs(Date.now() / 1000 - ts) > 300) return json({ error: 'bad signature' }, 400);
      const expect = await hmacHex(whsec, `${ts}.${raw}`);
      if (!v1s.includes(expect)) return json({ error: 'bad signature' }, 400);
      const ev = JSON.parse(raw);
      if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') await fulfill(ev.data.object.id);
      return json({ received: true });
    }

    // Pakkimistööd sportsport.ee serverile (joonised-dl.php?a=import). Ainult selle serveri IP-lt.
    if (a === 'import_job' || a === 'import_done') {
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
      const allowed = new Set((set.import_ip || '').split(',').map((x: string) => x.trim()).filter(Boolean));
      try { for (const r of await Deno.resolveDns('www.sportsport.ee', 'A')) allowed.add(r); } catch (_) { /* ainult import_ip */ }
      if (!allowed.has(ip)) { console.log('import ip', ip); return json({ error: 'forbidden', ip }, 403); }
      const now = new Date().toISOString();
      if (a === 'import_done') {
        const b = await req.json().catch(() => ({}));
        await sb.from('pesa_import_jobs').update({ done_at: now, result: String(b.result || '').slice(0, 2000) }).eq('id', Number(b.id));
        return json({ ok: true });
      }
      const { data: job } = await sb.from('pesa_import_jobs').select('id').is('taken_at', null).order('id').limit(1).maybeSingle();
      if (!job) return json({ job: null });
      const { data: got } = await sb.from('pesa_import_jobs').update({ taken_at: now }).eq('id', job.id).is('taken_at', null).select('id,zip,files');
      if (!got?.length) return json({ job: null });
      const j = got[0], [m, sz] = j.zip.replace('.zip', '').split('/');
      const readme = [`${m.replace('-', ' ')} · ${Object.keys(SLUG).find((k) => SLUG[k] === sz)} – Pesa maja joonised`, '',
        'PDF/      prinditavad joonised (vundament, plaan, katus, vaated, lõiked, uste/akende nimekirjad, eksplikatsioonid, 3D)',
        'DWG/      AutoCAD-failid', 'ArchiCAD/ PLA-arhiiv (raamatukogud kaasas)', 'SketchUp/ 3D-mudel', 'Tabelid/  ruumide ja terrasside pindade tabelid', '',
        'Joonised on eelprojekti mahus ja ingliskeelsed. Ehitusloa taotlemiseks kohanda need oma krundile ja lisa asendiplaan.',
        'Litsents: üks hoone, muutmine ja kohandamine lubatud, edasimüük ja jagamine keelatud (vt litsentsileping e-kirjas).', '',
        'Projektbüroo Sport OÜ · tiit@sportsport.ee · +372 5560 1425 · www.sportsport.ee/pesa'].join('\r\n');
      return json({ job: { ...j, readme } });
    }

    if (a === 'dl' || a === 'check' || a === 'consumed') {
      const t = u.searchParams.get('o') || '';
      const { data: o } = /^[0-9a-f]{36}$/.test(t) ? await sb.from('pesa_drawing_orders').select('*').eq('download_token', t).maybeSingle() : { data: null };
      const file = o ? o.file_path || downloadPath(o.model, o.size) : null;
      const msg = !o ? 'Linki ei leitud. Kirjuta tiit@sportsport.ee ja saadame uue.'
        : new Date(o.expires_at) < new Date() ? 'Allalaadimislink on aegunud. Kirjuta tiit@sportsport.ee ja saadame uue.'
        : o.downloads >= MAX_DL ? 'See link on juba kasutatud (joonised on alla laaditud). Uue lingi saamiseks kirjuta tiit@sportsport.ee.'
        : !file ? 'Failid on veel ettevalmistamisel. Saadame lingi e-postile ühe tööpäeva jooksul.' : '';
      if (a === 'dl') return msg ? text(msg, 410) : redirect(`${SITE}/joonised-dl.php?o=${t}`);
      if (a === 'check') return json(msg ? { ok: false, message: msg } : { ok: true, file, name: `${o!.model.replace(/\s+/g, '-')}_${SLUG[o!.size]}_joonised.zip` });
      if (o && !msg) await sb.from('pesa_drawing_orders').update({ downloads: o.downloads + 1, file_path: file }).eq('id', o.id);
      return json({ ok: !msg });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Midagi läks valesti. Proovi uuesti või kirjuta tiit@sportsport.ee.' }, 500);
  }
});
