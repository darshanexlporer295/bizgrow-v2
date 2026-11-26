-- patch-12: stronger protection for the online store (stage 10).
-- Run once in the Supabase SQL Editor after patch-11 (or use supabase/run-all-pending.sql). Safe to run more than once.
-- What changes:
--   * Order and tracking limits per connection, not only per phone number and per store. The Worker passes a
--     one-way code made from the visitor's connection address and the day (the address itself is never stored).
--     * Orders: 25 per connection per store per hour. Only orders that are saved count.
--     * Tracking: 30 tries per connection per store per 15 minutes. Every try counts, refused or not.
--   * The new functions sit beside the old ones. The Worker uses the new ones and falls back to the old ones
--     if they are not there yet, so nothing breaks before this patch is run.
--   * store_client_log keeps only the one-way code and the time, for two hours. Nobody can read it through the API.
-- Nothing is deleted and no existing order or supplier changes.
-- Connections that share one address (for example a mobile network) share the limit. The per-store limit of
-- 300 orders an hour still applies to everyone.

-- ---------- 1. the limit log (one-way codes only) ----------
create table if not exists public.store_client_log (
  id          bigint generated always as identity primary key,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  client_key  text not null,
  kind        text not null check (kind in ('order', 'track')),
  tried_at    timestamptz not null default now()
);
create index if not exists store_client_log_idx on public.store_client_log (shop_id, client_key, kind, tried_at);

alter table public.store_client_log enable row level security;
revoke all on public.store_client_log from public, anon, authenticated;

-- ---------- 2. place an order, with a limit per connection ----------
create or replace function public.place_store_order_for_client(
  p_slug text, p_name text, p_phone text, p_note text, p_items jsonb, p_client_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop   uuid;
  v_key    text := nullif(trim(coalesce(p_client_key, '')), '');
  v_recent int;
begin
  if v_key is not null then
    select id into v_shop
      from public.shops
     where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
    if found then
      delete from public.store_client_log where shop_id = v_shop and tried_at < now() - interval '2 hours';
      select count(*) into v_recent
        from public.store_client_log
       where shop_id = v_shop and client_key = v_key and kind = 'order' and tried_at > now() - interval '1 hour';
      if v_recent >= 25 then
        raise exception 'Too many orders from this connection for now. Please wait a while, or call the shop.';
      end if;
      -- Counted only when the order is saved: if place_store_order refuses, this line is rolled back too.
      insert into public.store_client_log (shop_id, client_key, kind) values (v_shop, v_key, 'order');
    end if;
  end if;
  return public.place_store_order(p_slug, p_name, p_phone, p_note, p_items);
end
$$;

-- ---------- 3. track an order, with a limit per connection ----------
create or replace function public.track_store_order_for_client(
  p_slug text, p_ref text, p_phone text, p_client_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop   uuid;
  v_key    text := nullif(trim(coalesce(p_client_key, '')), '');
  v_recent int;
begin
  if v_key is not null then
    select id into v_shop
      from public.shops
     where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
    if found then
      delete from public.store_client_log where shop_id = v_shop and tried_at < now() - interval '2 hours';
      select count(*) into v_recent
        from public.store_client_log
       where shop_id = v_shop and client_key = v_key and kind = 'track' and tried_at > now() - interval '15 minutes';
      -- Every try is counted, refused or not, so a fast guessing run cannot skip the count.
      insert into public.store_client_log (shop_id, client_key, kind) values (v_shop, v_key, 'track');
      if v_recent >= 30 then
        return jsonb_build_object('ok', false, 'limited', true,
          'message', 'Too many tries for now. Please wait a few minutes and try again, or call the shop.');
      end if;
    end if;
  end if;
  return public.track_store_order(p_slug, p_ref, p_phone);
end
$$;

-- ---------- 4. grants ----------
-- The public web address may call these two (as it could call the old ones), and the Worker and signed-in users too.
-- patch-10-lockdown.sql later takes the public role off the order function, as it does for place_store_order.
revoke all on function public.place_store_order_for_client(text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.place_store_order_for_client(text, text, text, text, jsonb, text) to anon, authenticated, service_role;

revoke all on function public.track_store_order_for_client(text, text, text, text) from public, anon, authenticated;
grant execute on function public.track_store_order_for_client(text, text, text, text) to anon, authenticated, service_role;
