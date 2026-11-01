// Pesa maja päringud: automaatne pakkumine kliendile + teavitus Tiidule.
// Brauser lisab rea tabelisse tube_offer_requests (anon insert) ja kutsub seejärel seda funktsiooni (POST).
// Funktsioon töötleb KÕIK veel töötlemata read (viimased 14 päeva). Sisendit ei usaldata – read loetakse andmebaasist.
//
//   POST                         → töötle uued päringud
//   GET ?a=approve&id=…&s=…      → Tiit kinnitab ülevaatust vajava pakkumise (link Tiidu kirjas)
//   GET ?a=unsubscribe&t=…       → klient loobub edasistest kirjadest
//
// Lülitid tabelis pesa_settings: auto_send (on/off), booking_url, offer_valid_days.
// Secret'id: RESEND_API_KEY (kohustuslik), TUBE_OFFER_TO (vaikimisi tiit@sportsport.ee),
//   TUBE_OFFER_FROM (Tiidu teavitus), PESA_CLIENT_FROM (kliendikiri; vaikimisi Tiit Sild <tiit@sportsport.ee>).
import { createClient } from 'npm:@supabase/supabase-js@2.49.10';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const SITE = 'https://www.sportsport.ee/pesa';
const FN_URL = 'https://xlhtavzsanlikmxrddrb.supabase.co/functions/v1/tube-offer-notify';
const SLUG: Record<string, string> = { '89,7 m²': '89-7', '109,7 m²': '109-7', '123,4 m²': '123-4' };
const ROOMS: Record<string, string> = { '89,7 m²': '2 magamistuba', '109,7 m²': '3 magamistuba', '123,4 m²': '4 magamistuba' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
// Supabase serveerib funktsioonide HTML-i lihttekstina, seega vastused on lihttekst.
const page = (title: string, text: string, status = 200) =>
  new Response(`${title}\n\n${text.replace(/<br>/g, '\n')}\n\nPesa majad: ${SITE}/\n`, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

type Row = {
  id: string; created_at: string; name: string; email: string; phone: string | null;
  plot_status: string | null; plot: string | null; planning: string | null;
  model: string | null; size: string | null; notes: string | null; page_url: string | null;
  region_code: string | null; region_name: string | null; status: string; token: string;
  utm_source: string | null; utm_campaign: string | null;
};
type Price = { size: string; base_price: number; region_surcharge: number };
type Quote = { tier: 'surcharge' | 'standard' | 'unknown'; model: string | null; lines: { size: string; standard: number; surcharge: number }[]; valid_until: string };

const eur = (n: number) => n.toLocaleString('et-EE').replace(/[\u00a0\u202f]/g, ' ') + ' €';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
const decided = (v: string | null) => !!v && v !== 'Pole veel otsustanud';

async function sign(id: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('approve:' + id)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}

function tierOf(r: Row, regions: Set<string>): Quote['tier'] {
  if (r.region_code && regions.has(r.region_code)) return 'surcharge';
  if (r.region_code && /^\d{3,4}$/.test(r.region_code)) return 'standard';
  if (r.region_code === 'muu') return 'standard';
  return 'unknown';
}

function buildQuote(r: Row, tier: Quote['tier'], prices: Price[], validDays: number): Quote {
  const chosen = decided(r.size) ? prices.filter((p) => p.size === r.size) : prices;
  const until = new Date(Date.now() + validDays * 864e5).toISOString().slice(0, 10);
  return {
    tier, model: decided(r.model) ? r.model : null, valid_until: until,
    lines: chosen.map((p) => ({ size: p.size, standard: p.base_price, surcharge: p.base_price + p.region_surcharge })),
  };
}

function reviewReasons(r: Row, q: Quote): string[] {
  const out: string[] = [];
  if (r.plot_status === 'Krunt on olemas' && q.tier === 'unknown') out.push('krundi asukohta ei õnnestunud määrata');
  if (r.plot_status === 'Krunt on olemas' && r.planning === 'Ei ole') out.push('detailplaneeringut ega projekteerimistingimusi pole – võib vajada projekteerimistingimuste taotlust');
  if (/korrus|kelder|teine maja|kaks maja|2 maja|abihoone|garaa|laienda|suurem|saun.*eraldi|kortermaja|paarismaja/i.test(r.notes || ''))
    out.push('erisoovides on suurem muudatus');
  return out;
}

const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };

function priceRows(q: Quote) {
  return q.lines.map((l) => {
    const p = q.tier === 'surcharge' ? eur(l.surcharge) : q.tier === 'standard' ? eur(l.standard) : `${eur(l.standard)} / ${eur(l.surcharge)}`;
    return { size: l.size, rooms: ROOMS[l.size], price: p };
  });
}

function offerHtml(r: Row, q: Quote, booking: string) {
  const m = q.model ? Number(q.model.replace(/\D/g, '')) || 1 : 1;
  const sz = q.lines.length === 1 ? q.lines[0].size : '109,7 m²';
  const img = q.model ? `${SITE}/tube-assets/email/tube-0${m}-${SLUG[sz]}.jpg` : `${SITE}/tube-assets/email/pesa-nomme.jpg`;
  const rows = priceRows(q).map((p) =>
    `<tr><td style="padding:14px 0;border-bottom:1px solid #e8e8ed">${esc(q.model || 'Pesa maja')} · ${esc(p.size)}<br><span style="color:#6e6e73;font-size:14px">${esc(p.rooms)}</span></td>
     <td style="padding:14px 0;border-bottom:1px solid #e8e8ed;text-align:right;font-weight:600;white-space:nowrap">${esc(p.price)} + km</td></tr>`).join('');
  const tierNote = q.tier === 'unknown'
    ? '<p style="font-size:14px;color:#6e6e73;margin:8px 0 0">Esimene hind kehtib krundile väljaspool Tallinnat, Tartut, Pärnut ja Viimsit, teine nendes omavalitsustes.</p>'
    : '';
  const where = r.plot ? esc(r.plot) : r.region_name ? esc(r.region_name) : 'krunt on alles otsimisel';
  const meet = booking
    ? `<a href="${esc(booking)}" style="color:#06c">Broneeri tasuta kohtumine arhitektiga →</a>`
    : 'Kui soovid enne arutada, vasta sellele kirjale – kohtumine arhitektiga on tasuta.';
  return `<!doctype html><html lang="et"><body style="margin:0;background:#f5f5f7">
<div style="max-width:600px;margin:0 auto;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#1d1d1f">
  <img src="${img}" width="600" alt="${esc(q.model || 'Pesa maja')}" style="display:block;width:100%;height:auto">
  <div style="padding:32px 32px 8px">
    <p style="font-size:14px;color:#6e6e73;margin:0">Pesa majad · Projektbüroo Sport</p>
    <h1 style="font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:8px 0 18px">Sinu Pesa maja pakkumine</h1>
    <p style="font-size:17px;line-height:1.5;margin:0 0 18px">Tere, ${esc(firstName(r.name))}!<br>Aitäh päringu eest. Siin on projekteerimise pakkumine – projekt ehitusloani.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:17px;border-collapse:collapse">${rows}</table>
    ${tierNote}
    <p style="font-size:14px;color:#6e6e73;margin:10px 0 24px">Krunt: ${where}. Pakkumine kehtib kuni ${fmtDate(q.valid_until)}.</p>
    <h2 style="font-size:19px;margin:0 0 8px">Mis on hinnas</h2>
    <p style="font-size:16px;line-height:1.55;margin:0 0 18px">Hoone arhitektuurne projekt (eelprojekt ja ehitusloa projekt) koos ehitusloa taotlusega ning vajalike muudatuste ja kohandustega sinu pere ja krundi järgi.</p>
    <h2 style="font-size:19px;margin:0 0 8px">Mis ei ole hinnas</h2>
    <p style="font-size:16px;line-height:1.55;margin:0 0 18px">Maja ehitus ja eriosade projektid. Aitame leida ehitaja ja soovitame sobivaid partnereid.</p>
    <h2 style="font-size:19px;margin:0 0 8px">Ajakava</h2>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px">Päringust ehitusloa taotluseni kulub tavaliselt umbes kuu. Ehitusloa menetluse kiirus sõltub omavalitsusest.</p>
    <div style="background:#f5f5f7;border-radius:14px;padding:20px 22px;margin:0 0 24px">
      <p style="font-size:17px;font-weight:600;margin:0 0 6px">Järgmine samm</p>
      <p style="font-size:16px;line-height:1.55;margin:0">Vasta sellele kirjale „Sobib" või helista <a href="tel:+37255601425" style="color:#06c">+372 5560 1425</a> – saadame lepingu ja alustame.<br>${meet}</p>
    </div>
    <p style="font-size:16px;line-height:1.55;margin:0 0 28px">Parimate soovidega<br><strong>Tiit Sild</strong><br>arhitekt, Projektbüroo Sport OÜ<br><a href="tel:+37255601425" style="color:#1d1d1f">+372 5560 1425</a> · <a href="mailto:tiit@sportsport.ee" style="color:#1d1d1f">tiit@sportsport.ee</a></p>
  </div>
  <div style="padding:18px 32px 28px;border-top:1px solid #e8e8ed;font-size:12px;line-height:1.5;color:#86868b">
    Said selle kirja, sest saatsid päringu lehel ${SITE.replace('https://', '')}. Pakkumine on lisatud ka PDF-ina.
    <a href="${FN_URL}?a=unsubscribe&t=${r.token}" style="color:#86868b">Ära saada mulle rohkem kirju</a>.
  </div>
</div></body></html>`;
}

function offerText(r: Row, q: Quote, booking: string) {
  const lines = priceRows(q).map((p) => `- ${q.model || 'Pesa maja'} · ${p.size} (${p.rooms}): ${p.price} + km`).join('\n');
  return [`Tere, ${firstName(r.name)}!`, '', 'Aitäh päringu eest. Siin on Pesa maja projekteerimise pakkumine – projekt ehitusloani.', '', lines,
    q.tier === 'unknown' ? '(Esimene hind väljaspool Tallinnat, Tartut, Pärnut ja Viimsit, teine nendes omavalitsustes.)' : '',
    `Pakkumine kehtib kuni ${fmtDate(q.valid_until)}.`, '',
    'Hinnas: hoone arhitektuurne projekt (eelprojekt ja ehitusloa projekt) koos ehitusloa taotlusega ning vajalike muudatuste ja kohandustega.',
    'Ei ole hinnas: maja ehitus ja eriosade projektid. Aitame leida ehitaja.',
    'Ajakava: päringust ehitusloa taotluseni tavaliselt umbes kuu.', '',
    'Järgmine samm: vasta „Sobib" või helista +372 5560 1425.', booking ? `Tasuta kohtumine arhitektiga: ${booking}` : 'Kohtumine arhitektiga on tasuta – vasta sellele kirjale.', '',
    'Tiit Sild, arhitekt, Projektbüroo Sport OÜ', '', `Loobu kirjadest: ${FN_URL}?a=unsubscribe&t=${r.token}`].join('\n');
}

async function offerPdf(r: Row, q: Quote): Promise<string | null> {
  try { return await offerPdfInner(r, q); } catch (_) { return null; }
}
async function offerPdfInner(r: Row, q: Quote) {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.11, 0.11, 0.12), mute = rgb(0.43, 0.43, 0.45);
  let y = 780;
  // Standardfont toetab ainult WinAnsi märke; muud asendatakse, et PDF ei kukuks.
  const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF€–—‘’“”„•…šžŠŽ]/g, '?');
  const t = (s: string, x: number, size = 11, font = f, color = ink) => pg.drawText(safe(s), { x, y, size, font, color });
  t('Pesa majad · Projektbüroo Sport OÜ', 56, 10, f, mute); y -= 34;
  t('Pakkumine: Pesa maja projekt ehitusloani', 56, 20, b); y -= 26;
  t(`Klient: ${r.name}`, 56); y -= 16;
  t(`Krunt: ${r.plot || r.region_name || 'otsimisel'}`, 56); y -= 16;
  t(`Kuupäev: ${fmtDate(new Date().toISOString().slice(0, 10))}   ·   Kehtib kuni: ${fmtDate(q.valid_until)}`, 56); y -= 34;
  for (const p of priceRows(q)) {
    t(`${q.model || 'Pesa maja'} · ${p.size} (${p.rooms})`, 56, 12);
    const s = safe(`${p.price} + km`); pg.drawText(s, { x: 539 - b.widthOfTextAtSize(s, 12), y, size: 12, font: b, color: ink }); y -= 8;
    pg.drawLine({ start: { x: 56, y }, end: { x: 539, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.87) }); y -= 18;
  }
  if (q.tier === 'unknown') { t('Esimene hind väljaspool Tallinnat, Tartut, Pärnut ja Viimsit, teine nendes omavalitsustes.', 56, 9, f, mute); y -= 16; }
  y -= 12;
  const para = (h: string, txt: string) => {
    t(h, 56, 12, b); y -= 16;
    const words = txt.split(' '); let line = '';
    for (const w of words) {
      if (f.widthOfTextAtSize(line + ' ' + w, 11) > 480) { t(line.trim(), 56); y -= 15; line = ''; }
      line += ' ' + w;
    }
    if (line.trim()) { t(line.trim(), 56); y -= 15; }
    y -= 10;
  };
  para('Hinnas', 'Hoone arhitektuurne projekt (eelprojekt ja ehitusloa projekt) koos ehitusloa taotlusega ning vajalike muudatuste ja kohandustega pere ja krundi järgi.');
  para('Ei ole hinnas', 'Maja ehitus ja eriosade projektid. Aitame leida ehitaja ja soovitame sobivaid partnereid.');
  para('Ajakava', 'Päringust ehitusloa taotluseni kulub tavaliselt umbes kuu. Ehitusloa menetluse kiirus sõltub omavalitsusest.');
  para('Järgmine samm', 'Kinnita pakkumine vastuskirjaga või helista +372 5560 1425 – saadame lepingu. Kohtumine arhitektiga on tasuta.');
  y = 70;
  t('Tiit Sild, arhitekt · Projektbüroo Sport OÜ · +372 5560 1425 · tiit@sportsport.ee · www.sportsport.ee/pesa', 56, 9, f, mute);
  const bytes = await doc.save();
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function pdfAttach(filename: string, r: Row, q: Quote) {
  const content = await offerPdf(r, q);
  return content ? { attachments: [{ filename, content }] } : {};
}

// Tiidule: PDF ja kliendikirja HTML-eelvaade manusena.
async function previewAttach(r: Row, q: Quote, booking: string) {
  const pdf = await offerPdf(r, q);
  const html = new TextEncoder().encode(offerHtml(r, q, booking));
  let bin = ''; for (let i = 0; i < html.length; i += 0x8000) bin += String.fromCharCode(...html.subarray(i, i + 0x8000));
  return { attachments: [...(pdf ? [{ filename: 'Pakkumise-eelvaade.pdf', content: pdf }] : []), { filename: 'Kliendikirja-eelvaade.html', content: btoa(bin) }] };
}

function adminText(r: Row, q: Quote | null, state: string, approveUrl?: string) {
  const when = new Date(r.created_at).toLocaleString('et-EE', { timeZone: 'Europe/Tallinn' });
  return [
    state, '',
    `Nimi: ${r.name}`, `E-post: ${r.email}`, `Telefon: ${r.phone || '—'}`,
    `Krundi olukord: ${r.plot_status || '—'}`, `Krundi aadress: ${r.plot || '—'}`, `Piirkond: ${r.region_name || '—'} (${q?.tier || '—'})`,
    `Detailplaneering / projekteerimistingimused: ${r.planning || '—'}`,
    `Pesa maja: ${r.model || '—'}`, `Suurus: ${r.size || '—'}`, `Erisoovid: ${r.notes || '—'}`, '',
    q ? 'Pakkumine:\n' + priceRows(q).map((p) => `- ${p.size}: ${p.price} + km`).join('\n') : '',
    approveUrl ? `\nKINNITA JA SAADA KLIENDILE: ${approveUrl}\n(Kui hind vajab muutmist, vasta kliendile ise.)` : '', '',
    `Allikas: ${r.utm_source || '—'} / ${r.utm_campaign || '—'}`, `Saadetud: ${when}`, `Leht: ${r.page_url || '—'}`, `Päringu ID: ${r.id}`, '',
    'Vastamiseks vajuta „Vasta" – kiri läheb kliendile.',
  ].join('\n');
}

async function resend(key: string, body: Record<string, unknown>) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = Deno.env.get('RESEND_API_KEY');
  const TIIT = Deno.env.get('TUBE_OFFER_TO') || 'tiit@sportsport.ee';
  const ADMIN_FROM = Deno.env.get('TUBE_OFFER_FROM') || 'Pesa majad <onboarding@resend.dev>';
  const CLIENT_FROM = Deno.env.get('PESA_CLIENT_FROM') || 'Tiit Sild | Pesa majad <tiit@sportsport.ee>';

  const { data: st } = await sb.from('pesa_settings').select('key,value');
  const set = Object.fromEntries((st || []).map((x) => [x.key, x.value]));
  const autoSend = set.auto_send === 'on', booking = set.booking_url || '', validDays = Number(set.offer_valid_days || 30);
  const { data: prices } = await sb.from('pesa_prices').select('size,base_price,region_surcharge').order('sort');
  const { data: regs } = await sb.from('pesa_regions').select('ehak');
  const regions = new Set((regs || []).map((x) => x.ehak));

  async function sendOffer(r: Row, q: Quote) {
    const subject = `Sinu Pesa maja pakkumine${q.model ? ' – ' + q.model : ''}${q.lines.length === 1 ? ', ' + q.lines[0].size : ''}`;
    await resend(key!, {
      from: CLIENT_FROM, to: [r.email], reply_to: TIIT, bcc: [TIIT], subject,
      html: offerHtml(r, q, booking), text: offerText(r, q, booking),
      ...(await pdfAttach('Pesa-maja-pakkumine.pdf', r, q)),
      headers: { 'List-Unsubscribe': `<${FN_URL}?a=unsubscribe&t=${r.token}>` },
    });
    await sb.from('tube_offer_requests').update({ status: 'offer_sent', offer_sent_at: new Date().toISOString(), review_reason: null }).eq('id', r.id);
  }

  // --- GET: kinnitamine ja loobumine
  if (req.method === 'GET') {
    const u = new URL(req.url), a = u.searchParams.get('a');
    if (a === 'unsubscribe') {
      const t = u.searchParams.get('t') || '';
      if (!/^[0-9a-f-]{36}$/i.test(t)) return page('Link ei kehti', 'Seda linki ei leitud.', 400);
      await sb.from('tube_offer_requests').update({ unsubscribed_at: new Date().toISOString(), status: 'unsubscribed' })
        .eq('token', t).not('status', 'in', '(ordered,drawings_bought)');
      return page('Oled loobunud', 'Me ei saada sulle enam Pesa majade kirju. Kui soovid siiski pakkumist arutada, kirjuta tiit@sportsport.ee.');
    }
    if (a === 'approve') {
      const id = u.searchParams.get('id') || '', s = u.searchParams.get('s') || '';
      if (!/^[0-9a-f-]{36}$/i.test(id) || s !== await sign(id)) return page('Link ei kehti', 'Kinnituslink on vigane.', 403);
      const { data: r } = await sb.from('tube_offer_requests').select('*').eq('id', id).single();
      if (!r) return page('Päringut ei leitud', id, 404);
      if (r.offer_sent_at) return page('Juba saadetud', `Pakkumine saadeti kliendile ${new Date(r.offer_sent_at).toLocaleString('et-EE', { timeZone: 'Europe/Tallinn' })}.`);
      if (!key) return page('Viga', 'RESEND_API_KEY puudub.', 500);
      try { await sendOffer(r as Row, r.price_quote as Quote); }
      catch (e) { return page('Saatmine ebaõnnestus', String((e as Error).message) + '<br>Kui viga mainib domeeni, pole sportsport.ee veel Resendis kinnitatud.', 502); }
      return page('Pakkumine saadetud', `Pakkumine saadeti aadressile ${r.email}. Koopia on sinu postkastis.`);
    }
    return page('Pesa majad', 'Siin pole midagi vaadata.', 404);
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // --- POST: uued päringud
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: pending, error } = await sb.from('tube_offer_requests')
    .select('id').is('notified_at', null).gte('created_at', since).order('created_at').limit(10);
  if (error) return json({ error: 'db' }, 500);
  if (!pending?.length) return json({ sent: 0 });
  if (!key) {
    await sb.from('tube_offer_requests').update({ notify_error: 'RESEND_API_KEY puudub' }).in('id', pending.map((p) => p.id));
    return json({ sent: 0, pending: pending.length, error: 'not_configured' });
  }
  // Võta read enda kätte enne saatmist, et kaks samaaegset kutset ei saadaks topelt.
  const { data: claimed } = await sb.from('tube_offer_requests')
    .update({ notified_at: new Date().toISOString(), notify_error: null })
    .in('id', pending.map((p) => p.id)).is('notified_at', null).select('*');

  let sent = 0;
  for (const r of (claimed || []) as Row[]) {
    try {
      const q = buildQuote(r, tierOf(r, regions), (prices || []) as Price[], validDays);
      const reasons = reviewReasons(r, q);
      await sb.from('tube_offer_requests').update({ region_tier: q.tier, price_quote: q }).eq('id', r.id);
      const approveUrl = `${FN_URL}?a=approve&id=${r.id}&s=${await sign(r.id)}`;
      let state: string, subj: string;
      if (reasons.length) {
        await sb.from('tube_offer_requests').update({ status: 'needs_review', review_reason: reasons.join('; ') }).eq('id', r.id);
        state = `PAKKUMINE OOTAB SINU KINNITUST\nPõhjus: ${reasons.join('; ')}.`; subj = 'Kinnita pakkumine';
      } else if (autoSend) {
        try { await sendOffer(r, q); state = 'Automaatne pakkumine saadeti kliendile (koopia sinu postkastis).'; subj = 'Pakkumine saadetud'; }
        catch (e) {
          await sb.from('tube_offer_requests').update({ status: 'needs_review', review_reason: 'automaatne saatmine ebaõnnestus: ' + String((e as Error).message).slice(0, 200) }).eq('id', r.id);
          state = 'AUTOMAATNE SAATMINE EBAÕNNESTUS – kinnita käsitsi.'; subj = 'Kinnita pakkumine';
        }
      } else {
        await sb.from('tube_offer_requests').update({ status: 'needs_review', review_reason: 'testrežiim (auto_send = off)' }).eq('id', r.id);
        state = 'TESTREŽIIM: pakkumist kliendile ei saadetud. Eelvaade on lisatud PDF-ina; kinnituslingiga saadad selle kliendile.'; subj = 'Kinnita pakkumine';
      }
      const needsApprove = !state.startsWith('Automaatne');
      await resend(key, {
        from: ADMIN_FROM, to: [TIIT], reply_to: r.email,
        subject: `${subj}: Pesa päring — ${r.name}${decided(r.model) ? ' · ' + r.model : ''}`,
        text: adminText(r, q, state, needsApprove ? approveUrl : undefined),
        ...(needsApprove ? await previewAttach(r, q, booking) : {}),
      });
      sent++;
    } catch (e) {
      await sb.from('tube_offer_requests')
        .update({ notified_at: null, notify_error: String((e as Error).message || e).slice(0, 500) }).eq('id', r.id);
    }
  }
  return json({ sent, pending: pending.length });
});
