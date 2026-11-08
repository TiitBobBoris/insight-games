-- Pesa: reklaamiküpsiste nõusolek ja Meta CAPI Lead-sündmuse olek päringu real.
alter table public.tube_offer_requests
  add column if not exists ad_consent boolean not null default false,
  add column if not exists fbp text,
  add column if not exists fbc text,
  add column if not exists client_user_agent text,
  add column if not exists capi_sent_at timestamptz,
  add column if not exists capi_error text;
comment on column public.tube_offer_requests.ad_consent is 'Külastaja andis küpsiste nõusolekus reklaami (advertisement) kategooriale loa; ainult siis saadetakse Lead Meta CAPI-sse.';
