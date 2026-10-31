// Pesa maja (endine TUBE) pakkumise päringu teavitus.
// Brauser lisab rea tabelisse tube_offer_requests (anon insert) ja kutsub seejärel seda funktsiooni.
// Funktsioon saadab e-kirja KÕIGI veel teavitamata ridade kohta (viimased 14 päeva), nii et
// vahele jäänud kutse saab järgmise päringuga tasa. Sisendit ei usaldata – read loetakse andmebaasist.
//
// Secret'id (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   – kohustuslik
//   TUBE_OFFER_TO    – vaikimisi tiit@sportsport.ee
//   TUBE_OFFER_FROM  – vaikimisi "Pesa majad <onboarding@resend.dev>" (kuni oma domeen on Resendis kinnitatud)
import { createClient } from 'npm:@supabase/supabase-js@2.49.10';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Row = {
  id: string; created_at: string; name: string; email: string; phone: string;
  plot_status: string | null; plot: string | null; planning: string | null;
  model: string | null; size: string | null; notes: string | null; page_url: string | null;
};

function mailText(r: Row) {
  const when = new Date(r.created_at).toLocaleString('et-EE', { timeZone: 'Europe/Tallinn' });
  return [
    'Uus Pesa maja pakkumise päring',
    '',
    `Nimi: ${r.name}`,
    `E-post: ${r.email}`,
    `Telefon: ${r.phone}`,
    `Krundi olukord: ${r.plot_status || '—'}`,
    `Krundi aadress / katastritunnus: ${r.plot || '—'}`,
    `Detailplaneering / projekteerimistingimused: ${r.planning || '—'}`,
    `Pesa maja: ${r.model || '—'}`,
    `Suurus: ${r.size || '—'}`,
    `Erisoovid: ${r.notes || '—'}`,
    '',
    `Saadetud: ${when}`,
    `Leht: ${r.page_url || '—'}`,
    `Päringu ID: ${r.id}`,
    '',
    'Vastamiseks vajuta lihtsalt „Vasta” – kiri läheb kliendile.',
  ].join('\n');
}

async function sendMail(r: Row, key: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('TUBE_OFFER_FROM') || 'Pesa majad <onboarding@resend.dev>',
      to: [Deno.env.get('TUBE_OFFER_TO') || 'tiit@sportsport.ee'],
      reply_to: r.email,
      subject: `Pesa maja pakkumise päring — ${r.name}${r.model && r.model !== 'Pole veel otsustanud' ? ' · ' + r.model : ''}`,
      text: mailText(r),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = Deno.env.get('RESEND_API_KEY');
  const since = new Date(Date.now() - 14 * 864e5).toISOString();

  // Võta read "enda kätte": märgime notified_at enne saatmist, et kaks samaaegset kutset ei saadaks topelt.
  const { data: pending, error } = await sb.from('tube_offer_requests')
    .select('id').is('notified_at', null).gte('created_at', since).order('created_at').limit(10);
  if (error) return json({ error: 'db' }, 500);
  if (!pending?.length) return json({ sent: 0 });
  if (!key) {
    await sb.from('tube_offer_requests').update({ notify_error: 'RESEND_API_KEY puudub' }).in('id', pending.map((p) => p.id));
    return json({ sent: 0, pending: pending.length, error: 'not_configured' });
  }

  const { data: claimed } = await sb.from('tube_offer_requests')
    .update({ notified_at: new Date().toISOString(), notify_error: null })
    .in('id', pending.map((p) => p.id)).is('notified_at', null).select('*');

  let sent = 0;
  for (const r of (claimed || []) as Row[]) {
    try {
      await sendMail(r, key);
      sent++;
    } catch (e) {
      await sb.from('tube_offer_requests')
        .update({ notified_at: null, notify_error: String((e as Error).message || e).slice(0, 500) }).eq('id', r.id);
    }
  }
  return json({ sent, pending: pending.length });
});
