-- patch-09: customers can track their online store order (stage 7).
-- Run once in the Supabase SQL Editor after patch-08. Safe to run more than once.
-- What changes:
--   * A customer enters the order reference and the phone number they ordered with,
--     and gets back only the order's status (new, accepted, packed, delivered or
--     cancelled). Nothing else is returned: no name, phone, items or total.
--   * A wrong phone number, a wrong reference, an unknown store and a closed store all
--     get the same answer, so the tracking cannot be used to check whether an order exists.
--   * Tracking is rate limited: 10 tries per phone number in 15 minutes, and 300 tries
--     per store in an hour. A refused try is still counted, and the reply is a plain
--     "please wait" message.
--   * store_track_log keeps a hashed phone key per try (never the phone number itself)
--     for two hours. Nobody can read it through the API.
--   * Only track_store_order is open to the public store (anon). The log table has no
--     grants and no policies.

create table if not exists public.store_track_log (
  id        bigint generated always as identity primary key,
  shop_id   uuid not null references public.shops(id) on delete cascade,
  phone_key text not null,
  tried_at  timestamptz not null default now()
);
create index if not exists store_track_log_shop_idx on public.store_track_log (shop_id, tried_at);
create index if not exists store_track_log_phone_idx on public.store_track_log (shop_id, phone_key, tried_at);

alter table public.store_track_log enable row level security;
revoke all on public.store_track_log from public, anon, authenticated;

create or replace function public.track_store_order(p_slug text, p_ref text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop    uuid;
  v_digits  text;
  v_ref     text;
  v_key     text;
  v_by_phone int;
  v_by_shop  int;
  v_status  text;
begin
  select id into v_shop
    from public.shops
   where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  v_digits := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  v_ref    := upper(regexp_replace(coalesce(p_ref, ''), '[^A-Za-z0-9]', '', 'g'));
  v_key    := md5(v_shop::text || ':' || v_digits);

  delete from public.store_track_log
   where shop_id = v_shop and tried_at < now() - interval '2 hours';
  insert into public.store_track_log (shop_id, phone_key) values (v_shop, v_key);

  select count(*) into v_by_phone
    from public.store_track_log
   where shop_id = v_shop and phone_key = v_key and tried_at > now() - interval '15 minutes';
  select count(*) into v_by_shop
    from public.store_track_log
   where shop_id = v_shop and tried_at > now() - interval '1 hour';
  if v_by_phone > 10 or v_by_shop > 300 then
    return jsonb_build_object('ok', false, 'limited', true,
      'message', 'Too many tries for now. Please wait a few minutes and try again, or call the shop.');
  end if;

  if length(v_ref) <> 6 or length(v_digits) < 10 then
    return jsonb_build_object('ok', false);
  end if;

  select o.status into v_status
    from public.store_orders o
   where o.shop_id = v_shop
     and upper(substr(md5(o.id::text), 1, 6)) = v_ref
     and right(regexp_replace(o.customer_phone, '[^0-9]', '', 'g'), 10) = v_digits
   limit 1;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object('ok', true, 'ref', v_ref, 'status', v_status);
end;
$$;

revoke all on function public.track_store_order(text, text, text) from public, anon, authenticated;
grant execute on function public.track_store_order(text, text, text) to anon, authenticated;
