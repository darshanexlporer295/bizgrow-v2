-- run-all-pending.sql: every database step that is still to run on the live project, in one paste.
-- Paste the whole file into the Supabase SQL Editor (New query), then press Run once.
-- It contains, in this order: patch-08, patch-09, patch-11, patch-12, patch-13.
-- It is safe to run more than once. Nothing is deleted and no existing order, product, bill or supplier changes.
-- It assumes schema.sql and patch-01 to patch-07 are already on the project (the state you have now).
-- NOT included on purpose: patch-10-lockdown.sql (optional, run last, only after the bot-check box shows
-- on the shop link and a test order goes through) and patch-10-rollback.sql (the undo for patch-10).
-- Generated from the separate patch files by joining them in order. If a patch file changes, rebuild this file.
-- See supabase/RUN-ORDER.md for the full list of steps.

-- ==================== BEGIN patch-08.sql ====================
-- patch-08: online store orders move stock (stage 5).
-- Run once in the Supabase SQL Editor after patch-07. Safe to run more than once.
-- What changes:
--   * Placing an order takes its quantities out of stock, in the same step as saving
--     the order. If any item is short at that moment, the whole order is refused, and
--     nothing is saved or taken. The messages are the same as the stage 4 stock check.
--   * Cancelling an order puts its quantities back. Reopening a cancelled order takes
--     them out again, and is refused if the stock is no longer there.
--   * Owner bulk cancel of new orders puts their stock back too.
--   * store_orders.stock_taken says whether an order is holding stock, so the take and
--     the put-back each happen once per order, however many times they are asked for.
--   * Orders placed before this patch have stock_taken = false. They never took stock,
--     so cancelling them does not change stock.

alter table public.store_orders add column if not exists stock_taken boolean not null default false;

-- ---------- internal: take and put back the stock of one order ----------

-- Products are locked in id order, so two orders with the same items cannot deadlock.
-- Only the database functions call these; nobody gets a grant on them.

create or replace function public._store_take(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken boolean;
  v_r record;
  v_p public.products%rowtype;
begin
  select o.stock_taken into v_taken from public.store_orders o where o.id = p_order;
  if v_taken is null or v_taken then
    return;
  end if;
  for v_r in
    select i.product_id, sum(i.qty) as q, max(i.name) as name
      from public.store_order_items i
     where i.order_id = p_order and i.product_id is not null
     group by i.product_id
     order by i.product_id
  loop
    select * into v_p from public.products where id = v_r.product_id for update;
    if not found or v_p.deleted_at is not null then
      raise exception '% is no longer available. Please remove it from the order.', v_r.name;
    end if;
    if v_p.stock_qty < v_r.q then
      if v_p.stock_qty <= 0 then
        raise exception '% is out of stock. Please remove it from your order.', v_p.name;
      end if;
      raise exception 'Only % % of % is left. Please lower the quantity.',
        trim_scale(v_p.stock_qty), coalesce(nullif(v_p.unit, ''), 'units'), v_p.name;
    end if;
    update public.products set stock_qty = stock_qty - v_r.q where id = v_r.product_id;
  end loop;
  update public.store_orders set stock_taken = true where id = p_order;
end
$$;

create or replace function public._store_put_back(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken boolean;
  v_r record;
begin
  select o.stock_taken into v_taken from public.store_orders o where o.id = p_order for update;
  if not coalesce(v_taken, false) then
    return;
  end if;
  for v_r in
    select i.product_id, sum(i.qty) as q
      from public.store_order_items i
     where i.order_id = p_order and i.product_id is not null
     group by i.product_id
     order by i.product_id
  loop
    perform 1 from public.products where id = v_r.product_id for update;
    update public.products set stock_qty = stock_qty + v_r.q where id = v_r.product_id;
  end loop;
  update public.store_orders set stock_taken = false where id = p_order;
end
$$;

-- ---------- public: place an order (takes the stock) ----------

create or replace function public.place_store_order(
  p_slug text, p_name text, p_phone text, p_note text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.shops%rowtype;
  v_p public.products%rowtype;
  v_it jsonb;
  v_name text := left(trim(coalesce(p_name, '')), 60);
  v_phone text := regexp_replace(left(coalesce(p_phone, ''), 40), '[^0-9]', '', 'g');
  v_note text := left(trim(coalesce(p_note, '')), 300);
  v_order uuid;
  v_qty numeric;
  v_line numeric;
  v_ordered numeric;
  v_count int := 0;
  v_total numeric := 0;
  v_recent int;
  v_seen boolean;
  v_lines jsonb;
  v_ref text;
begin
  select * into v_s from public.shops
   where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
  if not found then
    raise exception 'This store is not open right now';
  end if;
  if length(v_name) < 2 then
    raise exception 'Please enter your name';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 13 then
    raise exception 'Please enter a valid phone number';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'Too many items in one order';
  end if;

  -- A phone counts as seen when the shop has a customer with it, or has accepted
  -- an order from it. Orders that were never accepted (junk) do not count.
  v_seen := exists (
              select 1 from public.customers c
               where c.shop_id = v_s.id and c.deleted_at is null
                 and right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10) = right(v_phone, 10))
         or exists (
              select 1 from public.store_orders o
               where o.shop_id = v_s.id and right(o.customer_phone, 10) = right(v_phone, 10)
                 and o.status in ('accepted', 'packed', 'delivered'));

  -- Seen phones: 3 orders in 10 minutes. Phones not seen yet: 2 orders in an hour.
  select count(*) into v_recent from public.store_orders o
   where o.shop_id = v_s.id and right(o.customer_phone, 10) = right(v_phone, 10)
     and o.created_at > now() - case when v_seen then interval '10 minutes' else interval '60 minutes' end;
  if v_recent >= (case when v_seen then 3 else 2 end) then
    raise exception 'Too many orders from this number for now. Please wait a while or call the shop.';
  end if;
  -- Whole shop: 300 orders an hour.
  select count(*) into v_recent from public.store_orders
   where shop_id = v_s.id and created_at > now() - interval '1 hour';
  if v_recent >= 300 then
    raise exception 'This store is busy. Please try again later.';
  end if;

  insert into public.store_orders (shop_id, customer_name, customer_phone, note)
  values (v_s.id, v_name, v_phone, nullif(v_note, ''))
  returning id into v_order;

  for v_it in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_it->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Some items are no longer available. Please refresh the store and try again.';
    end if;
    if coalesce(v_it->>'qty', '') !~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' then
      raise exception 'Please check the quantities';
    end if;
    v_qty := (v_it->>'qty')::numeric;
    if v_qty <= 0 or v_qty > 9999 then
      raise exception 'Please check the quantities';
    end if;
    select * into v_p from public.products
     where id = (v_it->>'product_id')::uuid
       and shop_id = v_s.id and deleted_at is null;
    if not found then
      raise exception 'Some items are no longer available. Please refresh the store and try again.';
    end if;
    -- Stock check: the same item may appear twice in one cart, so count what is already in this order.
    -- The real take happens below, under a row lock, and checks again.
    select coalesce(sum(i.qty), 0) into v_ordered from public.store_order_items i
     where i.order_id = v_order and i.product_id = v_p.id;
    if v_p.stock_qty - v_ordered <= 0 then
      raise exception '% is out of stock. Please remove it from your order.', v_p.name;
    end if;
    if v_ordered + v_qty > v_p.stock_qty then
      raise exception 'Only % % of % is left. Please lower the quantity.',
        trim_scale(v_p.stock_qty - v_ordered), coalesce(nullif(v_p.unit, ''), 'units'), v_p.name;
    end if;
    v_line := round(v_p.sell_price * v_qty, 2);
    insert into public.store_order_items (order_id, product_id, name, unit, price, qty, line_total)
    values (v_order, v_p.id, v_p.name, v_p.unit, v_p.sell_price, v_qty, v_line);
    v_count := v_count + 1;
  end loop;

  update public.store_orders
     set item_count = (select count(*) from public.store_order_items i where i.order_id = v_order),
         total = (select coalesce(sum(i.line_total), 0) from public.store_order_items i where i.order_id = v_order)
   where id = v_order
   returning item_count, total into v_count, v_total;

  -- Take the stock now, in this same transaction. If another order has taken the last
  -- of an item since the check above, this raises, and the whole order is rolled back.
  perform public._store_take(v_order);

  -- The lines and total come from the saved rows, so the WhatsApp message matches the order.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', i.name, 'unit', i.unit, 'price', i.price,
           'qty', i.qty, 'line_total', i.line_total) order by i.name), '[]'::jsonb)
    into v_lines
    from public.store_order_items i where i.order_id = v_order;
  v_ref := upper(substr(md5(v_order::text), 1, 6));
  return jsonb_build_object(
    'ok', true,
    'ref', v_ref,
    'item_count', v_count,
    'total', v_total,
    'lines', v_lines);
end
$$;

-- ---------- staff: change one order's status (moves the stock) ----------

-- Moves allowed for owner, manager and cashier:
--   new -> accepted -> packed -> delivered, and cancel from new, accepted or packed.
-- Anything else (reopen from delivered or cancelled, skip a step) is owner only.
-- Cancel puts the stock back. Reopening a cancelled order takes it again.
-- Every real change writes one audit line with the old and the new status.
create or replace function public.set_store_order_status(p_order uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.store_orders%rowtype;
  v_ref text;
  v_step boolean;
begin
  select * into v_o from public.store_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  perform public._need(v_o.shop_id, array['owner', 'manager', 'cashier'], 'Only the owner, manager or cashier can change orders');
  if p_status not in ('new', 'accepted', 'packed', 'delivered', 'cancelled') then
    raise exception 'Unknown order status';
  end if;
  if p_status = v_o.status then
    return jsonb_build_object('ok', true, 'status', v_o.status, 'from', v_o.status, 'changed', false);
  end if;
  v_step := (v_o.status = 'new' and p_status = 'accepted')
         or (v_o.status = 'accepted' and p_status = 'packed')
         or (v_o.status = 'packed' and p_status = 'delivered')
         or (v_o.status in ('new', 'accepted', 'packed') and p_status = 'cancelled');
  if not v_step then
    perform public._need(v_o.shop_id, array['owner'], 'Only the owner can reopen an order or skip a step');
  end if;
  if p_status = 'cancelled' then
    perform public._store_put_back(p_order);
  elsif v_o.status = 'cancelled' then
    perform public._store_take(p_order);
  end if;
  update public.store_orders set status = p_status, updated_at = now() where id = p_order;
  v_ref := upper(substr(md5(p_order::text), 1, 6));
  perform public._audit(v_o.shop_id, 'edit', 'store_orders', p_order,
    'Order ' || v_ref || ' changed from ' || v_o.status || ' to ' || p_status);
  return jsonb_build_object('ok', true, 'status', p_status, 'from', v_o.status, 'changed', true);
end
$$;

-- ---------- owner only: cancel new (junk) orders in one go (puts the stock back) ----------

-- With no ids, cancels every order still marked new. With ids, only those that are new.
create or replace function public.cancel_new_store_orders(p_shop uuid, p_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.store_orders%rowtype;
  v_n int := 0;
  v_ref text;
begin
  perform public._need(p_shop, array['owner'], 'Only the owner can cancel orders in bulk');
  for v_o in
    select * from public.store_orders
     where shop_id = p_shop and status = 'new' and (p_ids is null or id = any(p_ids))
     order by id
     for update
  loop
    perform public._store_put_back(v_o.id);
    update public.store_orders set status = 'cancelled', updated_at = now() where id = v_o.id;
    v_ref := upper(substr(md5(v_o.id::text), 1, 6));
    perform public._audit(p_shop, 'edit', 'store_orders', v_o.id,
      'Order ' || v_ref || ' changed from new to cancelled (bulk cancel)');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cancelled', v_n);
end
$$;

-- ---------- grants ----------

revoke all on function public._store_take(uuid) from public, anon, authenticated;
revoke all on function public._store_put_back(uuid) from public, anon, authenticated;

revoke all on function public.place_store_order(text, text, text, text, jsonb) from public;
grant execute on function public.place_store_order(text, text, text, text, jsonb) to anon, authenticated;

revoke all on function public.set_store_order_status(uuid, text) from public, anon;
grant execute on function public.set_store_order_status(uuid, text) to authenticated;

revoke all on function public.cancel_new_store_orders(uuid, uuid[]) from public, anon;
grant execute on function public.cancel_new_store_orders(uuid, uuid[]) to authenticated;
-- ==================== END patch-08.sql ====================

-- ==================== BEGIN patch-09.sql ====================
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
-- ==================== END patch-09.sql ====================

-- ==================== BEGIN patch-11.sql ====================
-- patch-11: suppliers can be added, edited and deleted in the real app (stage 10).
-- Run once in the Supabase SQL Editor after patch-09 (or use supabase/run-all-pending.sql).
-- Safe to run more than once.
-- What changes:
--   * Suppliers get two new fields: what they supply (items) and a note.
--   * New functions upsert_supplier (add or edit) and delete_supplier (soft delete, like items and people).
--     Owner, manager and stock-keeper can add and edit. Owner and manager can delete, as the rules already
--     said in the role table. Each change writes one line to the activity log.
--   * Only signed-in users can run these. The public (anon) role gets nothing.
-- Nothing is deleted and no existing supplier changes.

alter table public.suppliers add column if not exists items text;
alter table public.suppliers add column if not exists note text;

-- ---------- add or edit a supplier ----------
create or replace function public.upsert_supplier(
  p_shop uuid, p_id uuid, p_name text, p_phone text, p_items text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text := trim(coalesce(p_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_items text := nullif(trim(coalesce(p_items, '')), '');
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_id    uuid;
begin
  perform public._need(p_shop, array['owner','manager','stock-keeper'],
    'Your role cannot change suppliers. Ask the owner or manager.');

  if v_name = '' then raise exception 'Supplier name is needed'; end if;
  if length(v_name) > 60 then raise exception 'Supplier name is too long (max 60 letters)'; end if;
  if v_phone is not null and length(v_phone) > 20 then raise exception 'Phone number is too long'; end if;
  if v_items is not null and length(v_items) > 120 then raise exception 'What they supply is too long (max 120 letters)'; end if;
  if v_note is not null and length(v_note) > 200 then raise exception 'Note is too long (max 200 letters)'; end if;

  if p_id is null then
    insert into public.suppliers (shop_id, name, phone, items, note)
    values (p_shop, v_name, v_phone, v_items, v_note)
    returning id into v_id;
    perform public._audit(p_shop, 'create', 'suppliers', v_id, 'Supplier ' || v_name);
  else
    update public.suppliers
       set name = v_name, phone = v_phone, items = v_items, note = v_note
     where id = p_id and shop_id = p_shop and deleted_at is null
     returning id into v_id;
    if v_id is null then raise exception 'Supplier not found'; end if;
    perform public._audit(p_shop, 'update', 'suppliers', v_id, 'Supplier ' || v_name);
  end if;
  return v_id;
end
$$;

-- ---------- delete a supplier (soft delete) ----------
create or replace function public.delete_supplier(p_shop uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  perform public._need(p_shop, array['owner','manager'], 'Only the owner or manager can delete a supplier');

  update public.suppliers set deleted_at = now()
   where id = p_id and shop_id = p_shop and deleted_at is null
  returning name into v_name;
  if not found then raise exception 'Supplier not found'; end if;

  perform public._audit(p_shop, 'delete', 'suppliers', p_id, 'Supplier ' || v_name);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- grants ----------
-- Signed-in users only. New functions are open to everyone by default in Postgres, so close that first.
revoke all on function
  public.upsert_supplier(uuid, uuid, text, text, text, text),
  public.delete_supplier(uuid, uuid)
  from public, anon;

grant execute on function
  public.upsert_supplier(uuid, uuid, text, text, text, text),
  public.delete_supplier(uuid, uuid)
  to authenticated;
-- ==================== END patch-11.sql ====================

-- ==================== BEGIN patch-12.sql ====================
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
-- ==================== END patch-12.sql ====================

-- ==================== BEGIN patch-13.sql ====================
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
-- ==================== END patch-13.sql ====================

-- ==================== BEGIN patch-14.sql ====================
-- patch-14: plans (Free, Growth, All Features) and the limits that go with them (stage 11).
-- Run once in the Supabase SQL Editor, after schema.sql and patch-01 to patch-12 (supabase/run-all-pending.sql includes it). Safe to run more than once.
-- What changes:
--   * plans: one table. Each row is one plan and its limits. To change a plan, change its row (one line, see below).
--   * shops.plan: the plan each shop is on. Shops that exist when this patch runs get 'all' (All Features), so nobody
--     loses anything. Shops created after this (new sign-ups) start on 'free'.
--   * Limits enforced on the server, so the app cannot get around them:
--       - bills per month (Free: 30). Counted per bill date, deleted bills do not count.
--       - items in stock (Free: 50).
--       - people in the shop, staff plus pending invites (Free: 2).
--       - online store on/off and suppliers (Free: not included).
--     Udhar reminders, the voice helper and full reports are shown as locked in the app (not enforced on the server yet).
--   * plan_requests: a shop owner can ask for another plan. This only records the request for the BizGrow team.
--     Nothing is charged and no plan is changed by the request. The team changes the plan by hand.
-- To change a limit for a plan, for example to give Free 40 bills:
--   update public.plans set bills_per_month = 40 where code = 'free';
-- To move a shop to another plan (done by the BizGrow team in the SQL Editor, not by the app):
--   update public.shops set plan = 'growth' where name = 'Shop name';
-- Nothing is deleted and no existing bill, product, staff row or supplier changes.

-- ---------- 1. the plans ----------
create table if not exists public.plans (
  code            text primary key,
  name            text not null,
  sort_order      int  not null,
  bills_per_month int,        -- null = no limit
  max_items       int,        -- null = no limit
  max_people      int,        -- null = no limit (staff plus pending invites)
  online_store    boolean not null default false,
  suppliers       boolean not null default false,
  udhar_reminders boolean not null default false,
  voice           boolean not null default false,
  full_reports    boolean not null default false
);

insert into public.plans (code, name, sort_order, bills_per_month, max_items, max_people,
                          online_store, suppliers, udhar_reminders, voice, full_reports) values
  ('free',   'Free',         1, 30,   50,  2,    false, false, false, false, false),
  ('growth', 'Growth',       2, 300,  500, 5,    true,  true,  true,  false, true),
  ('all',    'All Features', 3, null, null, null, true,  true,  true,  true,  true)
on conflict (code) do nothing;

alter table public.plans enable row level security;
drop policy if exists "plans read" on public.plans;
create policy "plans read" on public.plans for select to authenticated using (true);
revoke all on public.plans from public, anon, authenticated;
grant select on public.plans to authenticated;

-- ---------- 2. the plan on each shop ----------
-- Only the first run adds the column. Shops that exist at that moment are set to All Features, once.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shops' and column_name = 'plan') then
    alter table public.shops add column plan text not null default 'free' references public.plans(code);
    update public.shops set plan = 'all';
  end if;
end
$$;

-- Only the BizGrow team can change a plan (the SQL Editor has no signed-in user). The app cannot.
create or replace function public._plan_guard_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.plan is distinct from old.plan and auth.uid() is not null then
    raise exception 'Only BizGrow can change the plan. Ask for an upgrade instead.' using errcode = '42501';
  end if;
  if new.store_enabled and (tg_op = 'INSERT' or not old.store_enabled)
     and not (select p.online_store from public.plans p where p.code = new.plan) then
    raise exception 'The online store is not on your plan. Ask BizGrow about upgrading.' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_shop on public.shops;
create trigger plan_guard_shop before insert or update on public.shops
  for each row execute function public._plan_guard_shop();

-- ---------- 3. helpers ----------
create or replace function public._plan_of(p_shop uuid)
returns public.plans
language sql stable security definer set search_path = public as $$
  select p.* from public.plans p join public.shops s on s.plan = p.code where s.id = p_shop
$$;

-- Bills dated in the same month as p_date (deleted bills do not count).
create or replace function public._bills_in_month(p_shop uuid, p_date date)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.bills b
   where b.shop_id = p_shop and b.deleted_at is null
     and b.sale_date >= date_trunc('month', p_date)::date
     and b.sale_date <  (date_trunc('month', p_date) + interval '1 month')::date
$$;

create or replace function public._items_count(p_shop uuid)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.products where shop_id = p_shop and deleted_at is null
$$;

create or replace function public._people_count(p_shop uuid)
returns int
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.staff where shop_id = p_shop and active and deleted_at is null)
       + (select count(*)::int from public.staff_invites where shop_id = p_shop and claimed_at is null)
$$;

-- ---------- 4. limits checked before a row is saved ----------
create or replace function public._plan_guard_bill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  p := public._plan_of(new.shop_id);
  if p.code is not null and p.bills_per_month is not null
     and public._bills_in_month(new.shop_id, new.sale_date) >= p.bills_per_month then
    raise exception 'The % bills for this month are used up on the % plan. Ask BizGrow about the next plan.',
      p.bills_per_month, p.name using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_bill on public.bills;
create trigger plan_guard_bill before insert on public.bills
  for each row execute function public._plan_guard_bill();

create or replace function public._plan_guard_product()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  if new.deleted_at is not null then return new; end if;
  p := public._plan_of(new.shop_id);
  if p.code is not null and p.max_items is not null
     and public._items_count(new.shop_id) >= p.max_items then
    raise exception 'Your % plan allows % items. Remove some items or ask BizGrow about the next plan.',
      p.name, p.max_items using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_product on public.products;
create trigger plan_guard_product before insert on public.products
  for each row execute function public._plan_guard_product();

create or replace function public._plan_guard_supplier()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  p := public._plan_of(new.shop_id);
  if p.code is not null and not p.suppliers then
    raise exception 'Suppliers are not on your % plan. Ask BizGrow about upgrading.', p.name
      using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_supplier on public.suppliers;
create trigger plan_guard_supplier before insert on public.suppliers
  for each row execute function public._plan_guard_supplier();

create or replace function public._plan_guard_people()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  if tg_table_name = 'staff_invites' and new.claimed_at is not null then return new; end if;
  p := public._plan_of(new.shop_id);
  if p.code is not null and p.max_people is not null
     and public._people_count(new.shop_id) >= p.max_people then
    raise exception 'Your % plan allows % people in the shop. Remove someone or ask BizGrow about the next plan.',
      p.name, p.max_people using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_people on public.staff_invites;
create trigger plan_guard_people before insert on public.staff_invites
  for each row execute function public._plan_guard_people();

-- ---------- 5. upgrade requests (recorded only) ----------
create table if not exists public.plan_requests (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  from_plan    text not null,
  to_plan      text not null references public.plans(code),
  requested_by uuid references public.staff(id) on delete set null,
  status       text not null default 'new' check (status in ('new', 'done', 'dropped')),
  created_at   timestamptz not null default now()
);
create index if not exists plan_requests_shop_idx on public.plan_requests (shop_id, status, created_at);

alter table public.plan_requests enable row level security;
drop policy if exists "owner reads plan requests" on public.plan_requests;
create policy "owner reads plan requests" on public.plan_requests for select to authenticated
  using (public.has_shop_role(shop_id, array['owner']));
revoke all on public.plan_requests from public, anon, authenticated;
grant select on public.plan_requests to authenticated;

-- ---------- 6. functions the app calls ----------
create or replace function public._plan_json(p public.plans)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('code', p.code, 'name', p.name, 'sort_order', p.sort_order,
    'bills_per_month', p.bills_per_month, 'max_items', p.max_items, 'max_people', p.max_people,
    'features', jsonb_build_object('online_store', p.online_store, 'suppliers', p.suppliers,
      'udhar_reminders', p.udhar_reminders, 'voice', p.voice, 'full_reports', p.full_reports))
$$;

-- All three plans, for the Plans screen. Any signed-in user can read them.
create or replace function public.get_plans()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in again.' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(public._plan_json(p) order by p.sort_order) from public.plans p), '[]'::jsonb);
end
$$;

-- The shop's plan, the usage so far and any open upgrade request. Any member of the shop can read it.
create or replace function public.get_my_plan(p_shop uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.plans%rowtype;
  v_req record;
begin
  if auth.uid() is null then raise exception 'Please log in again.' using errcode = '28000'; end if;
  if public._my_role(p_shop) is null then raise exception 'You are not in this shop' using errcode = '42501'; end if;
  p := public._plan_of(p_shop);
  select r.to_plan, r.created_at into v_req
    from public.plan_requests r where r.shop_id = p_shop and r.status = 'new'
   order by r.created_at desc limit 1;
  return public._plan_json(p) || jsonb_build_object(
    'usage', jsonb_build_object(
      'bills', public._bills_in_month(p_shop, public._ist_today()),
      'items', public._items_count(p_shop),
      'people', public._people_count(p_shop)),
    'requested', case when v_req.to_plan is null then null
                 else jsonb_build_object('to_plan', v_req.to_plan, 'at', v_req.created_at) end);
end
$$;

-- The owner asks for another plan. Recorded for the BizGrow team. Nothing is charged and the plan does not change here.
create or replace function public.request_plan_upgrade(p_shop uuid, p_plan text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_current text;
  v_id uuid;
  v_plan text := lower(trim(coalesce(p_plan, '')));
begin
  perform public._need(p_shop, array['owner'], 'Only the owner can ask for a plan change.');
  select plan into v_current from public.shops where id = p_shop;
  if not exists (select 1 from public.plans where code = v_plan) then raise exception 'Pick a plan'; end if;
  if v_plan = v_current then raise exception 'That is already your plan'; end if;

  select r.id into v_id from public.plan_requests r
   where r.shop_id = p_shop and r.status = 'new' and r.to_plan = v_plan limit 1;
  if v_id is null then
    insert into public.plan_requests (shop_id, from_plan, to_plan, requested_by)
    values (p_shop, v_current, v_plan, public._actor(p_shop))
    returning id into v_id;
    perform public._audit(p_shop, 'request', 'plan_requests', v_id, 'Asked for the ' || v_plan || ' plan');
  end if;
  return jsonb_build_object('ok', true, 'to_plan', v_plan);
end
$$;

revoke all on function public._plan_of(uuid), public._bills_in_month(uuid, date), public._items_count(uuid),
  public._people_count(uuid), public._plan_json(public.plans), public._plan_guard_shop(),
  public._plan_guard_bill(), public._plan_guard_product(), public._plan_guard_supplier(),
  public._plan_guard_people() from public, anon, authenticated;
revoke all on function public.get_plans(), public.get_my_plan(uuid), public.request_plan_upgrade(uuid, text) from public, anon;
grant execute on function public.get_plans(), public.get_my_plan(uuid), public.request_plan_upgrade(uuid, text) to authenticated;
-- ==================== END patch-14.sql ====================
