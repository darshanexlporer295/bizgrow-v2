-- patch-13: tighter limits per visitor, and no default rights for the public role on new objects (stage 11).
-- Run once in the Supabase SQL Editor after patch-12 (or use supabase/run-all-pending.sql). Safe to run more than once.
-- If patch-12 is already on the project, this file alone is enough (it does not need the other patches again).
-- What changes:
--   * One visitor (one connection, one day code) can place at most 10 orders an hour from one store.
--     It was 25. Only saved orders count.
--   * One visitor can try order tracking at most 10 times in 15 minutes for one store. It was 30.
--     Every try counts, refused or not.
--   * A visitor's share is now small next to the whole store's caps, which stay as they were:
--     300 orders an hour, and 300 tracking tries an hour, for the whole shop. One visitor cannot use up
--     either of them on their own. The per-phone limits from patch-07 and patch-09 still apply too.
--   * The connection code is now required. A call with no connection code used to skip the per-visitor
--     limit; now it is refused with a plain "please try again" message.
--   * Default rights: tables, sequences and functions created in the public schema from now on are not
--     open to the public (anon) role. Functions get no default right for the PUBLIC group either.
--     Objects that already exist are not changed here; patch-10-lockdown.sql already removes the public
--     role's table access from them.
-- Nothing is deleted and no existing order, product, bill or supplier changes.

-- ---------- 1. orders: per visitor, required connection code ----------
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
  if v_key is null or length(v_key) > 200 then
    raise exception 'Please try again in a moment.';
  end if;
  select id into v_shop
    from public.shops
   where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
  if found then
    delete from public.store_client_log where shop_id = v_shop and tried_at < now() - interval '2 hours';
    select count(*) into v_recent
      from public.store_client_log
     where shop_id = v_shop and client_key = v_key and kind = 'order' and tried_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'Too many orders from you for now. Please wait a while, or call the shop.';
    end if;
    -- Counted only when the order is saved: if place_store_order refuses, this line is rolled back too.
    insert into public.store_client_log (shop_id, client_key, kind) values (v_shop, v_key, 'order');
  end if;
  return public.place_store_order(p_slug, p_name, p_phone, p_note, p_items);
end
$$;

-- ---------- 2. tracking: per visitor, required connection code ----------
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
  if v_key is null or length(v_key) > 200 then
    raise exception 'Please try again in a moment.';
  end if;
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
    if v_recent >= 10 then
      return jsonb_build_object('ok', false, 'limited', true,
        'message', 'Too many tries for now. Please wait a few minutes and try again, or call the shop.');
    end if;
  end if;
  return public.track_store_order(p_slug, p_ref, p_phone);
end
$$;

-- ---------- 3. grants (same as patch-12; repeated so this file stands on its own) ----------
revoke all on function public.place_store_order_for_client(text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.place_store_order_for_client(text, text, text, text, jsonb, text) to anon, authenticated, service_role;

revoke all on function public.track_store_order_for_client(text, text, text, text) from public, anon, authenticated;
grant execute on function public.track_store_order_for_client(text, text, text, text) to anon, authenticated, service_role;

-- ---------- 4. default rights for future objects in the public schema ----------
-- Supabase gives the public (anon) role access to every new table, sequence and function in the public schema
-- unless these defaults are removed. These lines remove that for objects created later by the role that runs this file.
-- Existing objects are not touched. If the defaults were never set, these lines do nothing.
-- The function line for the public group has no "in schema public": on this Postgres, a schema-only
-- revoke from public did not remove the group's execute right from new functions, the global form does.
-- Side effect: extension functions created later by the same role also lose the public group's execute right
-- (grant them explicitly if a future patch needs one).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges revoke execute on functions from public;
