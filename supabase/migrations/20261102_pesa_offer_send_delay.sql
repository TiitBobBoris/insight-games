-- Pakkumine läheb kliendile viivitusega (pesa_settings offer_delay_hours, offer_quiet_hours).
alter table tube_offer_requests add column if not exists send_after timestamptz;
alter table tube_offer_requests drop constraint tube_offer_requests_status_check;
alter table tube_offer_requests add constraint tube_offer_requests_status_check check (status = any (array['new','needs_review','scheduled','sending','offer_sent','followup_sent','meeting_booked','ordered','drawings_bought','closed','unsubscribed']));
insert into pesa_settings(key, value) values ('offer_delay_hours', '2-4'), ('offer_quiet_hours', '21-8') on conflict (key) do nothing;
select cron.schedule('pesa-send-due', '*/10 * * * *', $$
  select net.http_post(url := 'https://xlhtavzsanlikmxrddrb.supabase.co/functions/v1/tube-offer-notify?a=send_due',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$$);
