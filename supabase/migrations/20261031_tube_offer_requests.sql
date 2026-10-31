-- TUBE müügilehe pakkumise päringud. Rakendatud Supabase'i projektis xlhtavzsanlikmxrddrb 31.10.2026.
create table public.tube_offer_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320 and email like '%@%'),
  phone text not null check (char_length(phone) between 3 and 60),
  plot_status text check (char_length(plot_status) <= 100),
  plot text check (char_length(plot) <= 300),
  planning text check (char_length(planning) <= 100),
  model text check (char_length(model) <= 50),
  size text check (char_length(size) <= 50),
  notes text check (char_length(notes) <= 5000),
  page_url text check (char_length(page_url) <= 500),
  notified_at timestamptz,
  notify_error text
);
comment on table public.tube_offer_requests is 'TUBE müügilehe pakkumise päringud. Anonüümne insert, lugemine ainult adminil; teavituse saadab edge function tube-offer-notify.';

alter table public.tube_offer_requests enable row level security;

create policy "tube offer anon insert" on public.tube_offer_requests
  for insert to anon, authenticated
  with check (notified_at is null and notify_error is null);

create policy "tube offer admin read" on public.tube_offer_requests
  for select to authenticated
  using ((select public.is_app_admin_email(auth.jwt() ->> 'email')));

revoke all on public.tube_offer_requests from anon;
grant insert on public.tube_offer_requests to anon;
create index tube_offer_requests_pending_idx on public.tube_offer_requests (created_at) where notified_at is null;
