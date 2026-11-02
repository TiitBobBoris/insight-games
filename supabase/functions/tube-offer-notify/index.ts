// Pesa maja päringud: automaatne pakkumine kliendile + teavitus Tiidule.
// Brauser lisab rea tabelisse tube_offer_requests (anon insert) ja kutsub seejärel seda funktsiooni (POST).
// Funktsioon töötleb KÕIK veel töötlemata read (viimased 14 päeva). Sisendit ei usaldata – read loetakse andmebaasist.
//
//   POST                         → töötle uued päringud
//   GET ?a=approve&id=…&s=…      → Tiit kinnitab ülevaatust vajava pakkumise (link Tiidu kirjas)
//   GET ?a=unsubscribe&t=…       → klient loobub edasistest kirjadest
//   POST ?a=followup             → järelkirjad (GitHub Actions kord päevas): kohtumine + jooniste ost
//
// Lülitid tabelis pesa_settings: auto_send (on/off), booking_url, offer_valid_days, followup_days,
//   drawings_checkout_url, client_from / admin_from (saatjad; Resendis on kinnitatud send.sportsport.ee).
// Secret'id: RESEND_API_KEY (kohustuslik), TUBE_OFFER_TO (vaikimisi tiit@sportsport.ee),
//   TUBE_OFFER_FROM (Tiidu teavitus), PESA_CLIENT_FROM (kliendikiri; vaikimisi Tiit Sild <tiit@sportsport.ee>).
import { createClient } from 'npm:@supabase/supabase-js@2.49.10';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';

const SITE = 'https://www.sportsport.ee/pesa';
const FN_URL = 'https://xlhtavzsanlikmxrddrb.supabase.co/functions/v1/tube-offer-notify';
const LOGO = `${SITE}/tube-assets/email/projektbyroo-sport-logo.png`;
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
type Price = { size: string; base_price: number; region_surcharge: number; drawings_price: number | null };
type Quote = { tier: 'surcharge' | 'standard' | 'unknown'; model: string | null; lines: { size: string; standard: number; surcharge: number; drawings?: number | null }[]; valid_until: string };
// Pakkumise read. amount: kindel summa; 'drawings' = jooniste hind (pesa_prices); 'rest' = ülejäänu standardhinnast.
// Üle kirjutatav pesa_settings võtmega offer_items (JSON samas kujus).
type Item = { title: string; detail: string; amount: number | 'drawings' | 'rest' };
const DEFAULT_ITEMS: Item[] = [
  { title: 'Pesa maja standardprojekt', amount: 'drawings', detail: 'Valitud maja eelprojekti mahus joonised (plaanid, lõiked, vaated, 3D) ja kasutusõigus ühe hoone ehitamiseks.' },
  { title: 'Eskiisprojekti kohandused koostöös sinuga', amount: 890, detail: 'Ruumide, akende ja uste, materjalide ja viimistluse kohandamine sinu pere soovide järgi: kuni 2 kohtumist ja 2 parandusringi.' },
  { title: 'Asendiplaan ja hoone sidumine krundiga', amount: 590, detail: 'Hoone paigutus krundil, kõrgused, juurdepääs ja liitumised geodeetilise alusplaani põhjal.' },
  { title: 'Ehitusloa projekt, arhitektuurne osa', amount: 'rest', detail: 'Korruse- ja katuseplaan, lõiked, vaated, seletuskiri ja tehnilised näitajad ehitusprojekti nõuete järgi.' },
  { title: 'Ehitusloa taotlus ja menetlus', amount: 850, detail: 'Taotluse esitamine ehitisregistris, suhtlus omavalitsusega ja menetluse käigus küsitud parandused.' },
];
let ITEMS: Item[] = DEFAULT_ITEMS;
const SURCHARGE_TITLE = 'Lisatasu: Tallinn, Tartu, Pärnu ja Viimsi';
const SURCHARGE_DETAIL = 'Nendes omavalitsustes on ehitusloa menetlus mahukam ja nõudeid rohkem.';
const NOT_INCLUDED = 'Geodeetiline alusplaan, ehitusgeoloogia, konstruktsioonide ja tehnosüsteemide (eriosade) projektid, riigilõiv ning maja ehitus. Aitame leida ehitaja ja soovitame sobivaid partnereid.';

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
    lines: chosen.map((p) => ({ size: p.size, standard: p.base_price, surcharge: p.base_price + p.region_surcharge, drawings: p.drawings_price })),
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

// Hind: piirkonna järgi; kui piirkond pole teada, väiksem hind (lisatasu on märkusena all).
const total = (q: Quote, l: Quote['lines'][0]) => (q.tier === 'surcharge' ? l.surcharge : l.standard);
function priceRows(q: Quote) {
  return q.lines.map((l) => ({ size: l.size, rooms: ROOMS[l.size], price: eur(total(q, l)) }));
}
// Read iga suuruse kohta: [pealkiri, selgitus, summad suuruste kaupa].
function breakdown(q: Quote) {
  const rows = ITEMS.map((it) => ({ title: it.title, detail: it.detail, amounts: [] as number[] }));
  for (const l of q.lines) {
    const draw = Number(l.drawings || 0);
    let used = 0;
    ITEMS.forEach((it, i) => { if (it.amount !== 'rest') { const v = it.amount === 'drawings' ? draw : Number(it.amount); rows[i].amounts.push(v); used += v; } });
    ITEMS.forEach((it, i) => { if (it.amount === 'rest') rows[i].amounts.push(l.standard - used); });
  }
  const out = rows.filter((r) => r.amounts.some((v) => v > 0));
  if (q.tier === 'surcharge') out.push({ title: SURCHARGE_TITLE, detail: SURCHARGE_DETAIL, amounts: q.lines.map((l) => l.surcharge - l.standard) });
  return out;
}
const surchargeNote = (q: Quote) => {
  const d = q.lines[0] ? q.lines[0].surcharge - q.lines[0].standard : 0;
  return q.tier === 'unknown' && d > 0 ? `Hind kehtib krundile väljaspool Tallinnat, Tartut, Pärnut ja Viimsit. Nendes omavalitsustes on hind ${eur(d)} kõrgem.` : '';
};

function offerHtml(r: Row, q: Quote, booking: string) {
  const m = q.model ? Number(q.model.replace(/\D/g, '')) || 1 : 1;
  const sz = q.lines.length === 1 ? q.lines[0].size : '109,7 m²';
  const img = q.model ? `${SITE}/tube-assets/email/tube-0${m}-${SLUG[sz]}.jpg` : `${SITE}/tube-assets/email/pesa-nomme.jpg`;
  const bd = breakdown(q), multi = q.lines.length > 1;
  const td = 'padding:12px 0;border-bottom:1px solid #e8e8ed;vertical-align:top';
  const num = (v: number) => `<td style="${td};padding-left:12px;text-align:right;white-space:nowrap">${eur(v)}</td>`;
  const head = multi ? `<tr><td style="${td};color:#6e6e73;font-size:14px">Töö</td>${q.lines.map((l) => `<td style="${td};padding-left:12px;text-align:right;color:#6e6e73;font-size:14px;white-space:nowrap">${esc(l.size)}<br>${esc(ROOMS[l.size])}</td>`).join('')}</tr>` : '';
  const rows = head + bd.map((b) => `<tr><td style="${td}">${esc(b.title)}<br><span style="color:#6e6e73;font-size:14px;line-height:1.45">${esc(b.detail)}</span></td>${b.amounts.map(num).join('')}</tr>`).join('')
    + `<tr><td style="padding:14px 0;font-weight:600">Kokku${multi ? '' : ` · ${esc(q.model || 'Pesa maja')} ${esc(q.lines[0]?.size || '')}`}</td>${q.lines.map((l) => `<td style="padding:14px 0 14px 12px;text-align:right;font-weight:600;white-space:nowrap">${eur(total(q, l))} + km</td>`).join('')}</tr>`;
  const note = surchargeNote(q);
  const tierNote = note ? `<p style="font-size:14px;color:#6e6e73;margin:8px 0 0">${esc(note)}</p>` : '';
  const where = r.plot ? esc(r.plot) : r.region_name ? esc(r.region_name) : 'krunt on alles otsimisel';
  const meet = booking
    ? `<a href="${esc(booking)}" style="color:#06c">Broneeri tasuta kohtumine arhitektiga →</a>`
    : 'Kui soovid enne arutada, vasta sellele kirjale – kohtumine arhitektiga on tasuta.';
  return `<!doctype html><html lang="et"><body style="margin:0;background:#f5f5f7">
<div style="max-width:600px;margin:0 auto;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#1d1d1f">
  <div style="padding:26px 32px 20px"><img src="${LOGO}" width="132" alt="Projektbüroo Sport" style="display:block;width:132px;height:auto;border:0"></div>
  <img src="${img}" width="600" alt="${esc(q.model || 'Pesa maja')}" style="display:block;width:100%;height:auto">
  <div style="padding:32px 32px 8px">
    <p style="font-size:14px;color:#6e6e73;margin:0">Pesa majad · Projektbüroo Sport</p>
    <h1 style="font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:8px 0 18px">Sinu Pesa maja pakkumine</h1>
    <p style="font-size:17px;line-height:1.5;margin:0 0 18px">Tere, ${esc(firstName(r.name))}!<br>Aitäh päringu eest. Siin on projekteerimise pakkumine – projekt ehitusloani.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:16px;line-height:1.4;border-collapse:collapse">${rows}</table>
    ${tierNote}
    <p style="font-size:14px;color:#6e6e73;margin:10px 0 24px">Krunt: ${where}. Pakkumine kehtib kuni ${fmtDate(q.valid_until)}.</p>
    <h2 style="font-size:19px;margin:0 0 8px">Mis ei ole hinnas</h2>
    <p style="font-size:16px;line-height:1.55;margin:0 0 18px">${NOT_INCLUDED}</p>
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
  const multi = q.lines.length > 1;
  const items = breakdown(q).map((b) => `- ${b.title}: ${b.amounts.map(eur).join(' / ')}`).join('\n');
  const totals = q.lines.map((l) => `${q.model || 'Pesa maja'} · ${l.size} (${ROOMS[l.size]}): ${eur(total(q, l))} + km`).join('\n');
  return [`Tere, ${firstName(r.name)}!`, '', 'Aitäh päringu eest. Siin on Pesa maja projekteerimise pakkumine – projekt ehitusloani.', '',
    multi ? `Töö (${q.lines.map((l) => l.size).join(' / ')}):` : 'Töö:', items, '', 'Kokku:', totals, surchargeNote(q),
    `Pakkumine kehtib kuni ${fmtDate(q.valid_until)}.`, '',
    `Ei ole hinnas: ${NOT_INCLUDED}`,
    'Ajakava: päringust ehitusloa taotluseni tavaliselt umbes kuu.', '',
    'Järgmine samm: vasta „Sobib" või helista +372 5560 1425.', booking ? `Tasuta kohtumine arhitektiga: ${booking}` : 'Kohtumine arhitektiga on tasuta – vasta sellele kirjale.', '',
    'Tiit Sild, arhitekt, Projektbüroo Sport OÜ', '', `Loobu kirjadest: ${FN_URL}?a=unsubscribe&t=${r.token}`].join('\n');
}

async function offerPdf(r: Row, q: Quote): Promise<string | null> {
  try { return await offerPdfInner(r, q); } catch (_) { return null; }
}
let logoBytes: Uint8Array | null = null;
async function getLogo() {
  if (!logoBytes) { try { const res = await fetch(LOGO); if (res.ok) logoBytes = new Uint8Array(await res.arrayBuffer()); } catch (_) { /* ilma logota */ } }
  return logoBytes;
}
// Pildid ja fondid tulevad meie serverist (tube-assets) ja jäävad funktsiooni mällu.
const assetCache = new Map<string, Uint8Array | null>();
async function asset(url: string) {
  if (!assetCache.has(url)) {
    let v: Uint8Array | null = null;
    try { const res = await fetch(url); if (res.ok) v = new Uint8Array(await res.arrayBuffer()); } catch (_) { /* ilma */ }
    if (v) assetCache.set(url, v); else return null;
  }
  return assetCache.get(url)!;
}
const FONTS = `${SITE}/tube-assets/fonts`;
const SIGNATURE = `${SITE}/tube-assets/email/allkiri.png`;

async function offerPdfInner(r: Row, q: Quote) {
  const W = 595, H = 842, L = 56, R = 539;
  const doc = await PDFDocument.create();
  doc.setTitle(`Pakkumine – ${q.model || 'Pesa maja'} projekt ehitusloani`);
  doc.setAuthor('Projektbüroo Sport OÜ');
  doc.registerFontkit(fontkit);
  // Fondid: Inter (tekst) ja Jost Light (pealkirjad, sobib logoga). Kui ei saa, Helvetica.
  const [fr, fb, fl] = await Promise.all(['Inter-Regular', 'Inter-SemiBold', 'Jost-Light'].map((n) => asset(`${FONTS}/${n}.ttf`)));
  const custom = !!(fr && fb && fl);
  const f = custom ? await doc.embedFont(fr!, { subset: true }) : await doc.embedFont(StandardFonts.Helvetica);
  const b = custom ? await doc.embedFont(fb!, { subset: true }) : await doc.embedFont(StandardFonts.HelveticaBold);
  const lt = custom ? await doc.embedFont(fl!, { subset: true }) : f;
  const safe = (s: string) => custom ? s.replace(/[^\x20-\x7E\xA0-ɏ€–—‘’“”„•…·²]/g, '') : s.replace(/[^\x20-\x7E\xA0-\xFF€–—‘’“”„•…šžŠŽ]/g, '?');

  const ink = rgb(0.11, 0.11, 0.12), mute = rgb(0.42, 0.42, 0.44), rule = rgb(0.87, 0.86, 0.84);
  const sand = rgb(0.957, 0.945, 0.925), accent = rgb(0.6, 0.47, 0.3), white = rgb(1, 1, 1);
  let pg = doc.addPage([W, H]);
  let y = 0;
  const t = (s: string, x: number, size = 10, font = f, color = ink) => pg.drawText(safe(s), { x, y, size, font, color });
  const tr = (s: string, xr: number, size = 10, font = f, color = ink) => { const v = safe(s); pg.drawText(v, { x: xr - font.widthOfTextAtSize(v, size), y, size, font, color }); };
  // Hõredas suurtähtedes silt (pdf-lib ei toeta tähevahet, joonistame tähthaaval).
  const caps = (s: string, x: number, size = 7.5, color = accent, track = 1.6) => {
    for (const ch of safe(s.toUpperCase())) { pg.drawText(ch, { x, y, size, font: b, color }); x += b.widthOfTextAtSize(ch, size) + track; }
    return x;
  };
  const wrap = (txt: string, width: number, size: number, font = f) => {
    const out: string[] = []; let line = '';
    for (const w of safe(txt).split(' ')) {
      if (line && font.widthOfTextAtSize(line + ' ' + w, size) > width) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
    }
    if (line) out.push(line);
    return out;
  };
  const hr = (x1 = L, x2 = R, color = rule, th = 0.6) => pg.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: th, color });

  const lb = await getLogo();
  const logo = lb ? await doc.embedPng(lb) : null;
  const drawLogo = (x: number, top: number, w: number) => { if (logo) pg.drawImage(logo, { x, y: top - w * logo.height / logo.width, width: w, height: w * logo.height / logo.width }); };
  const today = fmtDate(new Date().toISOString().slice(0, 10));
  const offerNo = `P-${new Date().getFullYear()}-${r.id.slice(0, 4).toUpperCase()}`;
  const house = q.model || 'Pesa maja';
  const multi = q.lines.length > 1;
  const footer = () => {
    const yy = y; y = 34;
    hr(L, R, rule, 0.5); y = 22;
    t('Projektbüroo Sport OÜ  ·  +372 5560 1425  ·  tiit@sportsport.ee  ·  sportsport.ee/pesa', L, 7.5, f, mute);
    tr(`Pakkumine ${offerNo}`, R, 7.5, f, mute);
    y = yy;
  };

  // ---------- 1. leht: kaas ----------
  const m = q.model ? Number(q.model.replace(/\D/g, '')) || 1 : 1;
  const sz = q.lines.length === 1 ? q.lines[0].size : '109,7 m²';
  const heroUrl = q.model ? `${SITE}/tube-assets/email/tube-0${m}-${SLUG[sz]}.jpg` : `${SITE}/tube-assets/email/pesa-nomme.jpg`;
  const hb = await asset(heroUrl);
  const heroH = 372;
  if (hb) {
    const img = await doc.embedJpg(hb);
    const s = Math.max(W / img.width, heroH / img.height), iw = img.width * s, ih = img.height * s;
    pg.drawImage(img, { x: (W - iw) / 2, y: H - heroH - (ih - heroH) / 2, width: iw, height: ih });
    pg.drawRectangle({ x: 0, y: 0, width: W, height: H - heroH, color: white });
  } else pg.drawRectangle({ x: 0, y: H - heroH, width: W, height: heroH, color: sand });

  y = H - heroH - 46;
  caps(`Pakkumine  ·  ${offerNo}`, L);
  y -= 44; t(house, L, 40, lt);
  y -= 30; t('Projekt ehitusloani', L, 22, lt, mute);

  // Andmed kahes veerus
  y -= 40;
  const meta: [string, string][] = [
    ['Klient', r.name],
    ['Krunt', r.plot || r.region_name || 'otsimisel'],
    ['Maja', multi ? `${house}, suurus valimata` : `${house} · ${q.lines[0].size} · ${ROOMS[q.lines[0].size]}`],
    ['Kuupäev', today],
    ['Kehtib kuni', fmtDate(q.valid_until)],
    ['Arhitekt', 'Tiit Sild, volitatud arhitekt'],
  ];
  const colA = L, colB = 330, metaTop = y;
  meta.forEach(([k, v], i) => {
    const x = i < 3 ? colA : colB; y = metaTop - (i % 3) * 34;
    caps(k, x, 6.5, mute, 1.2);
    y -= 13; const vv = wrap(v, i < 3 ? 250 : 200, 10.5)[0] || ''; t(vv, x, 10.5);
  });
  y = metaTop - 3 * 34 - 4;

  // Hind
  y -= 10; hr(L, R, ink, 0.8); y -= 22;
  caps('Projekteerimise hind', L, 6.5, mute, 1.2);
  if (!multi) {
    const p = eur(total(q, q.lines[0]));
    y -= 36; t(p, L, 34, lt);
    t('+ km', L + lt.widthOfTextAtSize(safe(p), 34) + 8, 11, f, mute);
    tr(`koos km ${eur(Math.round(total(q, q.lines[0]) * 1.24))}`, R, 9, f, mute);
  } else {
    y -= 30;
    const cw = (R - L) / q.lines.length;
    q.lines.forEach((l, i) => {
      const x = L + i * cw;
      const p = eur(total(q, l)); t(p, x, 24, lt);
      t('+ km', x + lt.widthOfTextAtSize(safe(p), 24) + 5, 8.5, f, mute);
    });
    y -= 15; q.lines.forEach((l, i) => t(`${l.size} · ${ROOMS[l.size]}`, L + i * cw, 8.5, f, mute));
  }
  const note = surchargeNote(q);
  if (note) { y -= 18; for (const d of wrap(note, R - L, 8)) { t(d, L, 8, f, mute); y -= 10.5; } }

  drawLogo(L, 80, 96);
  y = 54; tr('tiit@sportsport.ee  ·  +372 5560 1425', R, 8, f, mute);
  y = 42; tr('www.sportsport.ee/pesa', R, 8, f, mute);

  // ---------- 2. leht: hinna sisu ----------
  let pageNo = 2;
  const newPage = () => {
    pg = doc.addPage([W, H]);
    drawLogo(L, H - 44, 72);
    y = H - 64; tr(`${house}  ·  lk ${pageNo++}`, R, 7.5, f, mute);
    y = H - 118;
  };
  const room = (need: number) => { if (y - need < 70) { footer(); newPage(); } };
  newPage();

  caps('Mis on hinnas', L); y -= 30;
  t('Töö sisu ja hind', L, 24, lt); y -= 30;

  const n = q.lines.length, colW = multi ? 76 : 90, numW = 30, labelW = R - L - numW - n * colW - 10;
  const colX = (i: number) => R - (n - 1 - i) * colW;
  if (multi) {
    q.lines.forEach((l, i) => tr(l.size, colX(i), 8.5, b, mute)); y -= 11;
    q.lines.forEach((l, i) => tr(ROOMS[l.size], colX(i), 7.5, f, mute)); y -= 9;
  }
  hr(L, R, ink, 0.8); y -= 22;
  breakdown(q).forEach((row, i) => {
    const det = wrap(row.detail, labelW, 8.6);
    room(20 + det.length * 11 + 18);
    t(String(i + 1).padStart(2, '0'), L, 13, lt, accent);
    t(row.title, L + numW, 10.5, b);
    row.amounts.forEach((v, j) => tr(eur(v), colX(j), 10.5));
    y -= 14;
    for (const d of det) { t(d, L + numW, 8.6, f, mute); y -= 11; }
    y -= 8; hr(); y -= 20;
  });

  // Kokku: tume riba
  room(80);
  y += 4;
  const band = 40;
  pg.drawRectangle({ x: L, y: y - band + 12, width: R - L, height: band, color: ink });
  y -= 13;
  t('Kokku', L + 16, 12, b, white);
  q.lines.forEach((l, i) => tr(eur(total(q, l)) + ' + km', colX(i) - (i === n - 1 ? 14 : 0), 12, b, white));
  y -= 30;
  t('Koos käibemaksuga (24%)', L + 16, 8.5, f, mute);
  q.lines.forEach((l, i) => tr(eur(Math.round(total(q, l) * 1.24)), colX(i) - (i === n - 1 ? 14 : 0), 8.5, f, mute));
  y -= 13;
  if (note) { for (const d of wrap(note, R - L - 32, 8)) { t(d, L + 16, 8, f, mute); y -= 10.5; } }
  y -= 26;

  // Tingimused kahes veerus
  const half = (R - L - 30) / 2;
  const blocks: [string, string][] = [
    ['Ei ole hinnas', NOT_INCLUDED],
    ['Ajakava', 'Päringust ehitusloa taotluseni kulub tavaliselt umbes kuu. Ehitusloa menetluse kiirus sõltub omavalitsusest. Tasume ainult tehtud töö eest etappide kaupa.'],
  ];
  const wrapped = blocks.map(([, txt]) => wrap(txt, half, 9));
  const bh = 22 + Math.max(...wrapped.map((w) => w.length)) * 13;
  room(bh + 10);
  const top = y;
  blocks.forEach(([h], i) => {
    const x = L + i * (half + 30); y = top;
    caps(h, x, 6.5, ink, 1.2); y -= 18;
    for (const l of wrapped[i]) { t(l, x, 9, f, mute); y -= 13; }
  });
  y = top - bh - 14;

  // Järgmine samm: liivakarva kast
  const stepTxt = wrap('Kinnita pakkumine vastuskirjaga „Sobib" või helista +372 5560 1425 – saadame lepingu ja alustame. Esimene kohtumine arhitektiga on tasuta.', R - L - 40, 9.5);
  const boxH = 34 + stepTxt.length * 13.5;
  room(boxH + 120);
  pg.drawRectangle({ x: L, y: y - boxH, width: R - L, height: boxH, color: sand });
  y -= 22; caps('Järgmine samm', L + 20, 6.5, accent, 1.2); y -= 17;
  for (const l of stepTxt) { t(l, L + 20, 9.5); y -= 13.5; }
  y -= 34;

  // Allkiri
  t('Lugupidamisega', L, 9.5, f, mute); y -= 10;
  const sig = await asset(SIGNATURE);
  if (sig) { try { const im = await doc.embedPng(sig); const h = 38, w = h * im.width / im.height; pg.drawImage(im, { x: L, y: y - h, width: w, height: h }); } catch (_) { /* vigane pilt */ } }
  y -= 46; hr(L, L + 170, ink, 0.5); y -= 14;
  t('Tiit Sild', L, 10.5, b); y -= 13;
  t('Volitatud arhitekt, tase 8  ·  Projektbüroo Sport OÜ', L, 8.5, f, mute);
  footer();

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

function followupHtml(r: Row, q: Quote, booking: string, prices: Price[], checkout: string) {
  const sizes = q.lines.map((l) => l.size);
  const dp = prices.filter((p) => sizes.includes(p.size) && p.drawings_price);
  const dRows = dp.map((p) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e8e8ed">${esc(q.model || 'Pesa maja')} · ${esc(p.size)}</td><td style="padding:10px 0;border-bottom:1px solid #e8e8ed;text-align:right;font-weight:600;white-space:nowrap">${eur(p.drawings_price!)} + km</td></tr>`).join('');
  const meet = booking
    ? `<a href="${esc(booking)}" style="display:inline-block;background:#1d1d1f;color:#fff;text-decoration:none;border-radius:980px;padding:12px 22px;font-size:16px">Vali kohtumise aeg</a>`
    : 'Vasta sellele kirjale ja lepime aja kokku.';
  const buy = checkout
    ? `<a href="${esc(checkout)}" style="color:#06c">Osta joonised →</a>`
    : 'Jooniste ostmiseks vasta sellele kirjale „Soovin jooniseid" – saadame arve ja pärast tasumist allalaadimislingi.';
  return `<!doctype html><html lang="et"><body style="margin:0;background:#f5f5f7">
<div style="max-width:600px;margin:0 auto;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#1d1d1f">
  <div style="padding:26px 32px 20px"><img src="${LOGO}" width="132" alt="Projektbüroo Sport" style="display:block;width:132px;height:auto;border:0"></div>
  <img src="${SITE}/tube-assets/email/pesa-nomme.jpg" width="600" alt="Pesa maja Nõmmel" style="display:block;width:100%;height:auto">
  <div style="padding:32px 32px 8px">
    <h1 style="font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:0 0 16px">Kohtume ja vaatame sinu Pesa maja koos üle?</h1>
    <p style="font-size:17px;line-height:1.5;margin:0 0 18px">Tere, ${esc(firstName(r.name))}!<br>Saatsime sulle nädal tagasi Pesa maja pakkumise. Kui sul on küsimusi või soovid lahendust oma krundil arutada, kohtume arhitektiga <strong>tasuta</strong> – kohapeal või videokõnes, 30 minutit.</p>
    <p style="margin:0 0 30px">${meet}</p>
    <h2 style="font-size:19px;margin:0 0 8px">Soovid projekti ise edasi viia?</h2>
    <p style="font-size:16px;line-height:1.55;margin:0 0 12px">Võid osta valitud maja joonised (PDF, DWG ja ArchiCAD) ning kohandada need ise või teise arhitekti abiga ehitusloa projektiks. Litsents kehtib ühe hoone ehitamiseks; jooniste edasimüük ei ole lubatud.</p>
    ${dRows ? `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:16px;border-collapse:collapse;margin:0 0 12px">${dRows}</table>` : ''}
    <p style="font-size:16px;line-height:1.55;margin:0 0 28px">${buy}</p>
    <p style="font-size:16px;line-height:1.55;margin:0 0 28px">Parimate soovidega<br><strong>Tiit Sild</strong><br>arhitekt, Projektbüroo Sport OÜ<br><a href="tel:+37255601425" style="color:#1d1d1f">+372 5560 1425</a></p>
  </div>
  <div style="padding:18px 32px 28px;border-top:1px solid #e8e8ed;font-size:12px;line-height:1.5;color:#86868b">
    See on viimane automaatne kiri sinu päringu kohta. <a href="${FN_URL}?a=unsubscribe&t=${r.token}" style="color:#86868b">Ära saada mulle rohkem kirju</a>.
  </div>
</div></body></html>`;
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

  const { data: st } = await sb.from('pesa_settings').select('key,value');
  const set = Object.fromEntries((st || []).map((x) => [x.key, x.value]));
  const ADMIN_FROM = set.admin_from || Deno.env.get('TUBE_OFFER_FROM') || 'Pesa majad <onboarding@resend.dev>';
  const CLIENT_FROM = set.client_from || Deno.env.get('PESA_CLIENT_FROM') || 'Tiit Sild | Pesa majad <tiit@send.sportsport.ee>';
  try { ITEMS = set.offer_items ? JSON.parse(set.offer_items) : DEFAULT_ITEMS; } catch (_) { ITEMS = DEFAULT_ITEMS; }
  const autoSend = set.auto_send === 'on', booking = set.booking_url || '', validDays = Number(set.offer_valid_days || 30);
  const { data: prices } = await sb.from('pesa_prices').select('size,base_price,region_surcharge,drawings_price').order('sort');
  const { data: regs } = await sb.from('pesa_regions').select('ehak');
  const regions = new Set((regs || []).map((x) => x.ehak));

  async function sendOffer(r: Row, q: Quote) {
    // Vanemates pakkumistes pole jooniste hinda – võta see hinnatabelist.
    q = { ...q, lines: q.lines.map((l) => ({ ...l, drawings: l.drawings ?? (prices || []).find((p) => p.size === l.size)?.drawings_price ?? 0 })) };
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
    // Pakkumise PDF-i eelvaade (sama allkiri mis kinnituslingil).
    if (a === 'pdf') {
      const id = u.searchParams.get('id') || '', s = u.searchParams.get('s') || '';
      if (!/^[0-9a-f-]{36}$/i.test(id) || s !== await sign(id)) return page('Link ei kehti', 'Link on vigane.', 403);
      const { data: r } = await sb.from('tube_offer_requests').select('*').eq('id', id).single();
      if (!r) return page('Päringut ei leitud', id, 404);
      const q = buildQuote(r as Row, tierOf(r as Row, regions), (prices || []) as Price[], validDays);
      const pdf = await offerPdfInner(r as Row, q);
      return new Response(Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="pakkumine.pdf"' } });
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

  // --- POST ?a=followup: järelkirjad (kutsub GitHub Actions kord päevas; korduv kutse ei saada topelt)
  if (new URL(req.url).searchParams.get('a') === 'followup') {
    if (!key) return json({ error: 'not_configured' }, 500);
    const days = Number(set.followup_days || 7);
    const due = new Date(Date.now() - days * 864e5).toISOString();
    const { data: claimed } = await sb.from('tube_offer_requests')
      .update({ followup_sent_at: new Date().toISOString() })
      .eq('status', 'offer_sent').is('followup_sent_at', null).is('unsubscribed_at', null).lte('offer_sent_at', due)
      .select('*');
    let n = 0;
    for (const r of (claimed || []) as (Row & { price_quote: Quote })[]) {
      try {
        await resend(key, {
          from: CLIENT_FROM, to: [r.email], reply_to: TIIT, bcc: [TIIT],
          subject: 'Kohtume tasuta ja vaatame sinu Pesa maja üle?',
          html: followupHtml(r, r.price_quote, booking, (prices || []) as Price[], set.drawings_checkout_url || ''),
          headers: { 'List-Unsubscribe': `<${FN_URL}?a=unsubscribe&t=${r.token}>` },
        });
        await sb.from('tube_offer_requests').update({ status: 'followup_sent' }).eq('id', r.id);
        n++;
      } catch (e) {
        await sb.from('tube_offer_requests').update({ followup_sent_at: null, notify_error: 'järelkiri: ' + String((e as Error).message).slice(0, 300) }).eq('id', r.id);
      }
    }
    return json({ followups: n });
  }

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
