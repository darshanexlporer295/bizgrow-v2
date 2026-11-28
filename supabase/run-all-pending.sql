-- run-all-pending.sql: every database step that is still to run on the live project, in one paste.
-- Paste the whole file into the Supabase SQL Editor (New query), then press Run once.
-- It contains, in this order: patch-08, patch-09, patch-11, patch-12, patch-13, patch-14, patch-15, patch-16, patch-17, patch-18.
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

-- ==================== BEGIN patch-15.sql ====================
-- patch-15: promo codes, the platform owner, and online payment for plan upgrades.
-- Run after patch-14 (plans, shops.plan). Safe to run more than once. Nothing existing is deleted.
--
-- What changes:
--   * plans.price_paise: the price of a plan in paise (100 paise = Rs 1). Null = not sold online.
--     ASSUMED PRICES, please check and change them: Growth Rs 499 and All Features Rs 999, per 30 days.
--   * shops: plan_until (when a time-limited plan ends) and plan_base (the plan to go back to). Null plan_until = no end.
--   * platform_admins: the BizGrow platform owner(s). Only they can create, list or switch off promo codes.
--     Seed yourself with supabase/make-platform-owner.sql (one line to edit, run once in the SQL Editor).
--   * promo_codes, promo_redemptions: a code gives a plan for N days (or for good), with a limit on uses.
--     One use per shop per code. Redeeming is atomic (row lock), so the limit cannot be passed by two people at once.
--   * promo_attempts: counts tries per person so codes cannot be guessed (10 tries per 15 minutes).
--   * plan_payments: one row per online payment attempt. Only the Worker (service key) can write it.
--     No card data is stored here. Razorpay keeps card details.
--   * Changing a shop's plan is allowed only inside these functions (not by the app directly).
--
-- Nothing here is readable or writable by shop owners except through the functions below.

-- ---------- 1. prices and plan end dates ----------
alter table public.plans add column if not exists price_paise int check (price_paise is null or price_paise >= 0);
-- ASSUMED prices (set once, only where no price is set yet):
update public.plans set price_paise = 49900 where code = 'growth' and price_paise is null;  -- ASSUMED Rs 499 / 30 days
update public.plans set price_paise = 99900 where code = 'all'    and price_paise is null;  -- ASSUMED Rs 999 / 30 days

alter table public.shops add column if not exists plan_until timestamptz;
alter table public.shops add column if not exists plan_base  text references public.plans(code);

-- ---------- 2. the plan guard: only our own functions may change plan fields ----------
-- Replaces the guard from patch-14 with the same rules, plus: plan, plan_base and plan_until
-- can change only inside the functions in this file (they set bizgrow.plan_change = on).
create or replace function public._plan_guard_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.plan, new.plan_base, new.plan_until) is distinct from (old.plan, old.plan_base, old.plan_until)
     and auth.uid() is not null
     and coalesce(current_setting('bizgrow.plan_change', true), '') <> 'on' then
    raise exception 'Only BizGrow can change the plan. Ask for an upgrade instead.' using errcode = '42501';
  end if;
  if new.store_enabled and (tg_op = 'INSERT' or not old.store_enabled)
     and not (select p.online_store from public.plans p where p.code = new.plan) then
    raise exception 'The online store is not on your plan. Ask BizGrow about upgrading.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- The plan a shop is on right now. After plan_until passes, it is the plan_base (read-only, so it can be used in checks).
create or replace function public._plan_of(p_shop uuid)
returns public.plans
language sql stable security definer set search_path = public as $$
  select p.* from public.plans p join public.shops s
    on p.code = (case when s.plan_until is not null and s.plan_until <= now() and s.plan_base is not null
                      then s.plan_base else s.plan end)
  where s.id = p_shop
$$;

-- Writes the end of a time-limited plan into the shop row. Called by the functions below.
create or replace function public._sync_shop_plan(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops
     set plan = plan_base, plan_base = null, plan_until = null
   where id = p_shop and plan_until is not null and plan_until <= now() and plan_base is not null;
  perform set_config('bizgrow.plan_change', 'off', true);
end
$$;

-- ---------- 3. platform owner ----------
create table if not exists public.platform_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------- 4. promo codes ----------
create table if not exists public.promo_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9-]{3,29}$'),
  plan          text not null references public.plans(code),
  duration_days int check (duration_days is null or duration_days between 1 and 3650),  -- null = for good
  max_uses      int not null check (max_uses between 1 and 10000),
  used_count    int not null default 0 check (used_count >= 0),
  expires_at    timestamptz,                                                             -- null = no end date for the code
  active        boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (used_count <= max_uses)
);
create unique index if not exists promo_codes_code_key on public.promo_codes (code);

create table if not exists public.promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references public.promo_codes(id) on delete cascade,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  redeemed_by uuid references auth.users(id) on delete set null,
  plan        text not null,
  plan_until  timestamptz,
  created_at  timestamptz not null default now(),
  unique (promo_id, shop_id)
);

create table if not exists public.promo_attempts (
  id        bigint generated always as identity primary key,
  user_id   uuid not null,
  tried_at  timestamptz not null default now()
);
create index if not exists promo_attempts_user_idx on public.promo_attempts (user_id, tried_at);

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.promo_attempts enable row level security;
revoke all on public.promo_codes, public.promo_redemptions, public.promo_attempts from public, anon, authenticated;

-- Shop owner types a code. Returns jsonb for ordinary answers, so the counted try is kept even when it fails.
create or replace function public.redeem_promo_code(p_shop uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_promo  public.promo_codes;
  v_shop   public.shops;
  v_cur    public.plans;
  v_new    public.plans;
  v_base   text;
  v_until  timestamptz;
  v_recent int;
begin
  if v_user is null then raise exception 'Please log in again.' using errcode = '42501'; end if;

  -- Rate limit first, and record the try before anything can fail (so guessing is counted).
  select count(*) into v_recent from public.promo_attempts
   where user_id = v_user and tried_at > now() - interval '15 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait 15 minutes and try again.');
  end if;
  insert into public.promo_attempts (user_id) values (v_user);

  -- A plain check, not _need: _need raises, and a raise would undo the counted try above.
  if p_shop is null or not public.has_shop_role(p_shop, array['owner']) then
    return jsonb_build_object('ok', false, 'message', 'Only the shop owner can use a promo code.');
  end if;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid.');
  end if;

  -- Lock the code row: two shops using the last use at the same moment queue up here.
  select * into v_promo from public.promo_codes where code = v_code for update;
  if not found or not v_promo.active
     or (v_promo.expires_at is not null and v_promo.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid or has ended.');
  end if;
  if exists (select 1 from public.promo_redemptions where promo_id = v_promo.id and shop_id = p_shop) then
    return jsonb_build_object('ok', false, 'message', 'Your shop has already used this code.');
  end if;
  if v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('ok', false, 'message', 'This code has been used up.');
  end if;

  perform public._sync_shop_plan(p_shop);
  select * into v_shop from public.shops where id = p_shop for update;
  select * into v_cur from public.plans where code = (case when v_shop.plan_until is not null and v_shop.plan_until > now()
                                                              and v_shop.plan_base is not null then v_shop.plan_base else v_shop.plan end);
  select * into v_new from public.plans where code = v_promo.plan;
  if v_new.sort_order <= v_cur.sort_order then
    return jsonb_build_object('ok', false, 'message', 'Your shop already has this plan or a better one.');
  end if;

  v_base  := case when v_shop.plan_until is not null and v_shop.plan_base is not null then v_shop.plan_base else v_shop.plan end;
  v_until := case when v_promo.duration_days is null then null else now() + make_interval(days => v_promo.duration_days) end;

  update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
  insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
  values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan = v_promo.plan, plan_base = v_base, plan_until = v_until where id = p_shop;
  perform set_config('bizgrow.plan_change', 'off', true);

  perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code for the ' || v_new.name || ' plan');
  return jsonb_build_object('ok', true, 'plan', v_new.code, 'plan_name', v_new.name, 'plan_until', v_until);
end
$$;
revoke all on function public.redeem_promo_code(uuid, text) from public, anon;
grant execute on function public.redeem_promo_code(uuid, text) to authenticated;

-- Platform owner only. Every other caller gets a plain refusal.
create or replace function public.admin_create_promo(p_code text, p_plan text, p_duration_days int,
                                                    p_max_uses int, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    raise exception 'The code must be 4 to 30 letters or numbers (a dash is allowed inside).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where code = lower(btrim(coalesce(p_plan, '')))) then
    raise exception 'Pick a plan.' using errcode = '22023';
  end if;
  insert into public.promo_codes (code, plan, duration_days, max_uses, expires_at, created_by)
  values (v_code, lower(btrim(p_plan)), p_duration_days, p_max_uses, p_expires_at, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
exception when unique_violation then
  raise exception 'That code already exists. Pick another.' using errcode = '22023';
end
$$;

create or replace function public.admin_list_promos()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'plan', c.plan, 'duration_days', c.duration_days,
      'max_uses', c.max_uses, 'used_count', c.used_count, 'expires_at', c.expires_at,
      'active', c.active, 'created_at', c.created_at
    ) order by c.created_at desc)
    from public.promo_codes c), '[]'::jsonb);
end
$$;

create or replace function public.admin_set_promo_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  update public.promo_codes set active = coalesce(p_active, false) where id = p_id;
  if not found then raise exception 'Code not found.' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Platform owner only: who used one code, when, and which shop. Used by the Admin screen.
create or replace function public.admin_promo_usage(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shop_name', sh.name, 'plan', r.plan, 'plan_until', r.plan_until, 'redeemed_at', r.created_at
    ) order by r.created_at desc)
    from public.promo_redemptions r join public.shops sh on sh.id = r.shop_id
    where r.promo_id = p_id), '[]'::jsonb);
end
$$;

revoke all on function public.admin_create_promo(text, text, int, int, timestamptz),
                     public.admin_list_promos(),
                     public.admin_set_promo_active(uuid, boolean),
                     public.admin_promo_usage(uuid) from public, anon;
grant execute on function public.admin_create_promo(text, text, int, int, timestamptz),
                         public.admin_list_promos(),
                         public.admin_set_promo_active(uuid, boolean),
                         public.admin_promo_usage(uuid) to authenticated;

-- ---------- 5. online payments for plan upgrades (called by the Worker with the service key only) ----------
create table if not exists public.plan_payments (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references public.shops(id) on delete cascade,
  plan                text not null references public.plans(code),
  amount_paise        int  not null check (amount_paise > 0),
  currency            text not null default 'INR' check (currency = 'INR'),
  status              text not null default 'pending' check (status in ('pending', 'paid')),
  razorpay_order_id   text unique,
  razorpay_payment_id text unique,
  requested_by        uuid references auth.users(id) on delete set null,
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);
alter table public.plan_payments enable row level security;
revoke all on public.plan_payments from public, anon, authenticated;

create or replace function public.billing_begin_order(p_user_id uuid, p_shop uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan public.plans; v_cur public.plans; v_row uuid;
begin
  if not exists (select 1 from public.staff where shop_id = p_shop and auth_user_id = p_user_id and role = 'owner' and active) then
    raise exception 'Only the shop owner can pay for a plan.' using errcode = '22023';
  end if;
  select * into v_plan from public.plans where code = lower(btrim(coalesce(p_plan, '')));
  if not found or v_plan.price_paise is null then
    raise exception 'Online payment is not set up for this plan yet.' using errcode = '22023';
  end if;
  select * into v_cur from public._plan_of(p_shop);
  if v_plan.sort_order <= v_cur.sort_order then
    raise exception 'Your shop already has this plan or a better one.' using errcode = '22023';
  end if;
  -- Rate limit: at most 10 payment orders per owner in 15 minutes, so a button mash cannot flood Razorpay.
  if (select count(*) from public.plan_payments
       where requested_by = p_user_id and created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many payment tries. Please wait 15 minutes and try again.' using errcode = '22023';
  end if;
  insert into public.plan_payments (shop_id, plan, amount_paise, requested_by)
  values (p_shop, v_plan.code, v_plan.price_paise, p_user_id) returning id into v_row;
  return jsonb_build_object('ok', true, 'payment_id', v_row, 'amount_paise', v_plan.price_paise,
                            'currency', 'INR', 'plan', v_plan.code);
end
$$;

create or replace function public.billing_attach_order(p_payment uuid, p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.plan_payments set razorpay_order_id = p_order
   where id = p_payment and status = 'pending' and razorpay_order_id is null;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Marks an order paid and moves the shop to the plan. Idempotent: the same payment again changes nothing.
-- p_source 'verify' comes with the signed-in owner's id, which must be the shop owner. 'webhook' has none.
create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount int, p_currency text,
                                                   p_source text, p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.plan_payments; s public.shops; v_base text; v_until timestamptz; v_plan public.plans; v_cur public.plans;
begin
  if p_source not in ('verify', 'webhook') then raise exception 'Unknown source.' using errcode = '22023'; end if;
  select * into r from public.plan_payments where razorpay_order_id = p_order for update;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;

  if r.status = 'paid' then
    if r.razorpay_payment_id = p_payment then
      return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan);
    end if;
    raise exception 'This order was already paid.' using errcode = '22023';
  end if;

  if p_amount is distinct from r.amount_paise or upper(coalesce(p_currency, '')) <> r.currency then
    raise exception 'Amount does not match this plan.' using errcode = '22023';
  end if;
  if p_source = 'verify' and (p_user_id is null or not exists (
       select 1 from public.staff where shop_id = r.shop_id and auth_user_id = p_user_id and role = 'owner' and active)) then
    raise exception 'Only the shop owner can confirm this payment.' using errcode = '42501';
  end if;

  perform public._sync_shop_plan(r.shop_id);
  select * into s from public.shops where id = r.shop_id for update;
  select * into v_plan from public.plans where code = r.plan;
  select * into v_cur from public._plan_of(r.shop_id);
  if v_cur.sort_order >= v_plan.sort_order then
    -- Never move a shop down: the money is recorded, the plan stays as it is, and the owner is told.
    update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
    perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id,
      'Online payment for the ' || v_plan.name || ' plan received; the shop already had a plan at or above it, so the plan was not changed');
    return jsonb_build_object('ok', true, 'status', 'paid', 'plan', v_cur.code, 'plan_changed', false);
  end if;
  -- The plan to go back to when this payment's 30 days end.
  v_base := case when s.plan_until is not null and s.plan_base is not null then s.plan_base else s.plan end;
  -- Renewing the same plan while it still runs adds 30 days on top; any other case starts 30 days from now.
  v_until := case when s.plan_until is not null and s.plan_until > now() and s.plan = r.plan
                  then s.plan_until + interval '30 days' else now() + interval '30 days' end;

  update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan = r.plan, plan_base = v_base, plan_until = v_until where id = r.shop_id;
  perform set_config('bizgrow.plan_change', 'off', true);
  perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id, 'Paid for the ' || v_plan.name || ' plan online');
  return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan, 'plan_changed', true);
end
$$;

revoke all on function public.billing_begin_order(uuid, uuid, text), public.billing_attach_order(uuid, text),
                     public.billing_mark_paid(text, text, int, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.billing_begin_order(uuid, uuid, text), public.billing_attach_order(uuid, text),
                         public.billing_mark_paid(text, text, int, text, text, uuid) to service_role;
-- ==================== END patch-15.sql ====================

-- ==================== BEGIN patch-16.sql ====================
-- patch-16: where a shop's plan came from, and fair rules for promo codes and payments.
-- Run after patch-15 (plans, promo codes, plan payments). Safe to run more than once. Nothing existing is deleted.
--
-- Why: patch-14 gave every shop that existed then the plan 'all' as a default (no payment, no end date).
-- Patch-15 compared plans by rank, so such a shop was "already on a better plan" and every code was refused:
-- "You already have the plan or a better plan than this."
--
-- What changes:
--   * shops.plan_source: where the current plan came from.
--       'free'   = the default plan for new shops
--       'legacy' = the patch-14 default 'all' (not a payment, not a code). Treated like a free shop for codes and payments.
--       'promo'  = a promo code, 'paid' = an online payment, 'manual' = set by BizGrow by hand.
--   * shops.plan_base_source: the same, for the plan to go back to (plan_base).
--   * A promo or a payment can move a legacy or free shop to its plan, and sets the end date.
--   * A real plan (paid, promo or manual) is never replaced by a lower one. A lower code is refused and the message
--     names the current plan and its end date.
--   * A code for the plan the shop already has, with an end date: its days are added to the end date.
--     A code for the plan the shop already has for good: refused, with a message saying so.
--   * Platform owner only: admin_shop_plan (see the source) and admin_set_plan_source (change it).
--   * The plan guard now also protects plan_source and plan_base_source.

-- ---------- 1. columns and the one-time backfill ----------
alter table public.shops add column if not exists plan_source      text;
alter table public.shops add column if not exists plan_base_source text;

-- Existing shops (only rows not set yet, so a second run changes nothing).
update public.shops s set plan_source = case
    when s.plan = 'free' then 'free'
    when exists (select 1 from public.plan_payments p where p.shop_id = s.id and p.plan = s.plan and p.status = 'paid') then 'paid'
    when exists (select 1 from public.promo_redemptions r where r.shop_id = s.id and r.plan = s.plan) then 'promo'
    when s.plan = 'all' and s.plan_until is null then 'legacy'
    else 'manual' end
 where s.plan_source is null;

update public.shops s set plan_base_source = case
    when s.plan_base = 'free' then 'free'
    when exists (select 1 from public.plan_payments p where p.shop_id = s.id and p.plan = s.plan_base and p.status = 'paid') then 'paid'
    when exists (select 1 from public.promo_redemptions r where r.shop_id = s.id and r.plan = s.plan_base) then 'promo'
    when s.plan_base = 'all' then 'legacy'
    else 'manual' end
 where s.plan_base is not null and s.plan_base_source is null;

alter table public.shops alter column plan_source set default 'free';
alter table public.shops alter column plan_source set not null;

alter table public.shops drop constraint if exists shops_plan_source_check;
alter table public.shops add constraint shops_plan_source_check
  check (plan_source in ('free', 'legacy', 'promo', 'paid', 'manual'));
alter table public.shops drop constraint if exists shops_plan_base_source_check;
alter table public.shops add constraint shops_plan_base_source_check
  check (plan_base_source is null or plan_base_source in ('free', 'legacy', 'promo', 'paid', 'manual'));

-- ---------- 2. the plan guard: plan_source too ----------
create or replace function public._plan_guard_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.plan, new.plan_base, new.plan_until, new.plan_source, new.plan_base_source)
         is distinct from (old.plan, old.plan_base, old.plan_until, old.plan_source, old.plan_base_source)
     and auth.uid() is not null
     and coalesce(current_setting('bizgrow.plan_change', true), '') <> 'on' then
    raise exception 'Only BizGrow can change the plan. Ask for an upgrade instead.' using errcode = '42501';
  end if;
  if new.store_enabled and (tg_op = 'INSERT' or not old.store_enabled)
     and not (select p.online_store from public.plans p where p.code = new.plan) then
    raise exception 'The online store is not on your plan. Ask BizGrow about upgrading.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ---------- 3. helpers ----------
-- A date for messages, in India time, e.g. "17 Dec 2026".
create or replace function public._day_text(p_at timestamptz)
returns text language sql immutable as $$
  select to_char(p_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')
$$;

-- Writes the end of a time-limited plan into the shop row. The plan goes back to plan_base and its source with it.
create or replace function public._sync_shop_plan(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops
     set plan = plan_base, plan_source = coalesce(plan_base_source, 'free'),
         plan_base = null, plan_base_source = null, plan_until = null
   where id = p_shop and plan_until is not null and plan_until <= now() and plan_base is not null;
  perform set_config('bizgrow.plan_change', 'off', true);
end
$$;

-- ---------- 4. promo codes ----------
create or replace function public.redeem_promo_code(p_shop uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_promo    public.promo_codes;
  v_shop     public.shops;
  v_cur      public.plans;
  v_new      public.plans;
  v_rank     int;
  v_base     text;
  v_base_src text;
  v_until    timestamptz;
  v_recent   int;
  v_msg      text;
begin
  if v_user is null then raise exception 'Please log in again.' using errcode = '42501'; end if;

  -- Rate limit first, and record the try before anything can fail (so guessing is counted).
  select count(*) into v_recent from public.promo_attempts
   where user_id = v_user and tried_at > now() - interval '15 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait 15 minutes and try again.');
  end if;
  insert into public.promo_attempts (user_id) values (v_user);

  -- A plain check, not _need: _need raises, and a raise would undo the counted try above.
  if p_shop is null or not public.has_shop_role(p_shop, array['owner']) then
    return jsonb_build_object('ok', false, 'message', 'Only the shop owner can use a promo code.');
  end if;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid.');
  end if;

  -- Lock the code row: two shops using the last use at the same moment queue up here.
  select * into v_promo from public.promo_codes where code = v_code for update;
  if not found or not v_promo.active
     or (v_promo.expires_at is not null and v_promo.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid or has ended.');
  end if;
  if exists (select 1 from public.promo_redemptions where promo_id = v_promo.id and shop_id = p_shop) then
    return jsonb_build_object('ok', false, 'message', 'Your shop has already used this code.');
  end if;
  if v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('ok', false, 'message', 'This code has been used up.');
  end if;

  perform public._sync_shop_plan(p_shop);
  select * into v_shop from public.shops where id = p_shop for update;
  select * into v_cur from public._plan_of(p_shop);
  select * into v_new from public.plans where code = v_promo.plan;
  -- A legacy default shop has no real plan yet, so it ranks below every plan (any code can apply).
  v_rank := case when v_shop.plan_source = 'legacy' then 0 else v_cur.sort_order end;

  if v_new.sort_order > v_rank then
    -- Upgrade. The plan to go back to when this code's days end: the current base if the shop is on a timed plan, else its plan now.
    if v_shop.plan_until is not null and v_shop.plan_base is not null then
      v_base := v_shop.plan_base;  v_base_src := v_shop.plan_base_source;
    else
      v_base := v_shop.plan;       v_base_src := v_shop.plan_source;
    end if;
    v_until := case when v_promo.duration_days is null then null else now() + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan = v_promo.plan, plan_source = 'promo', plan_until = v_until,
                            plan_base = case when v_until is null then null else v_base end,
                            plan_base_source = case when v_until is null then null else v_base_src end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code for the ' || v_new.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_new.code, 'plan_name', v_new.name, 'plan_until', v_until);
  end if;

  if v_new.code = v_cur.code and v_shop.plan_source <> 'legacy' then
    -- The same plan the shop already has.
    if v_shop.plan_until is null then
      return jsonb_build_object('ok', false, 'message',
        'Your shop is already on the ' || v_cur.name || ' plan for good, so this code was not used.');
    end if;
    -- Days go on top of the current end date. A code with no end date makes the plan permanent.
    v_until := case when v_promo.duration_days is null then null
                    else greatest(v_shop.plan_until, now()) + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan_until = v_until,
                            plan_base = case when v_until is null then null else plan_base end,
                            plan_base_source = case when v_until is null then null else plan_base_source end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code to extend the ' || v_cur.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_cur.code, 'plan_name', v_cur.name, 'plan_until', v_until, 'extended', true);
  end if;

  -- A lower plan: refused, and the message says what the shop has now and until when.
  v_msg := 'Your shop is on the ' || v_cur.name || ' plan'
        || case when v_shop.plan_until is not null then ' until ' || public._day_text(v_shop.plan_until) else ' for good' end
        || '. This code gives the ' || v_new.name || ' plan, which is lower, so it was not used.';
  return jsonb_build_object('ok', false, 'message', v_msg);
end
$$;
revoke all on function public.redeem_promo_code(uuid, text) from public, anon;
grant execute on function public.redeem_promo_code(uuid, text) to authenticated;

-- ---------- 5. online payment: the same rules as codes ----------
create or replace function public.billing_begin_order(p_user_id uuid, p_shop uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan public.plans; v_cur public.plans; v_shop public.shops; v_rank int; v_row uuid; v_msg text;
begin
  if not exists (select 1 from public.staff where shop_id = p_shop and auth_user_id = p_user_id and role = 'owner' and active) then
    raise exception 'Only the shop owner can pay for a plan.' using errcode = '22023';
  end if;
  select * into v_plan from public.plans where code = lower(btrim(coalesce(p_plan, '')));
  if not found or v_plan.price_paise is null then
    raise exception 'Online payment is not set up for this plan yet.' using errcode = '22023';
  end if;
  perform public._sync_shop_plan(p_shop);
  select * into v_shop from public.shops where id = p_shop;
  select * into v_cur from public._plan_of(p_shop);
  v_rank := case when v_shop.plan_source = 'legacy' then 0 else v_cur.sort_order end;
  if v_plan.sort_order <= v_rank then
    v_msg := 'Your shop is already on the ' || v_cur.name || ' plan'
          || case when v_shop.plan_until is not null then ' until ' || public._day_text(v_shop.plan_until) else ' for good' end
          || '. Pick a higher plan.';
    raise exception '%', v_msg using errcode = '22023';
  end if;
  -- Rate limit: at most 10 payment orders per owner in 15 minutes, so a button mash cannot flood Razorpay.
  if (select count(*) from public.plan_payments
       where requested_by = p_user_id and created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many payment tries. Please wait 15 minutes and try again.' using errcode = '22023';
  end if;
  insert into public.plan_payments (shop_id, plan, amount_paise, requested_by)
  values (p_shop, v_plan.code, v_plan.price_paise, p_user_id) returning id into v_row;
  return jsonb_build_object('ok', true, 'payment_id', v_row, 'amount_paise', v_plan.price_paise,
                            'currency', 'INR', 'plan', v_plan.code);
end
$$;

create or replace function public.billing_attach_order(p_payment uuid, p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.plan_payments set razorpay_order_id = p_order
   where id = p_payment and status = 'pending' and razorpay_order_id is null;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Marks an order paid and moves the shop to the plan. Idempotent: the same payment again changes nothing.
-- p_source 'verify' comes with the signed-in owner's id, which must be the shop owner. 'webhook' has none.
create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount int, p_currency text,
                                                   p_source text, p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.plan_payments; s public.shops; v_base text; v_base_src text; v_until timestamptz;
        v_plan public.plans; v_cur public.plans; v_rank int;
begin
  if p_source not in ('verify', 'webhook') then raise exception 'Unknown source.' using errcode = '22023'; end if;
  select * into r from public.plan_payments where razorpay_order_id = p_order for update;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;

  if r.status = 'paid' then
    if r.razorpay_payment_id = p_payment then
      return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan);
    end if;
    raise exception 'This order was already paid.' using errcode = '22023';
  end if;

  if p_amount is distinct from r.amount_paise or upper(coalesce(p_currency, '')) <> r.currency then
    raise exception 'Amount does not match this plan.' using errcode = '22023';
  end if;
  if p_source = 'verify' and (p_user_id is null or not exists (
       select 1 from public.staff where shop_id = r.shop_id and auth_user_id = p_user_id and role = 'owner' and active)) then
    raise exception 'Only the shop owner can confirm this payment.' using errcode = '42501';
  end if;

  perform public._sync_shop_plan(r.shop_id);
  select * into s from public.shops where id = r.shop_id for update;
  select * into v_plan from public.plans where code = r.plan;
  select * into v_cur from public._plan_of(r.shop_id);
  v_rank := case when s.plan_source = 'legacy' then 0 else v_cur.sort_order end;
  if v_rank >= v_plan.sort_order then
    -- Never move a shop down: the money is recorded, the plan stays as it is, and the owner is told.
    update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
    perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id,
      'Online payment for the ' || v_plan.name || ' plan received; the shop already had a plan at or above it, so the plan was not changed');
    return jsonb_build_object('ok', true, 'status', 'paid', 'plan', v_cur.code, 'plan_changed', false);
  end if;
  -- The plan to go back to when this payment's 30 days end.
  if s.plan_until is not null and s.plan_base is not null then
    v_base := s.plan_base;  v_base_src := s.plan_base_source;
  else
    v_base := s.plan;       v_base_src := s.plan_source;
  end if;
  -- Renewing the same plan while it still runs adds 30 days on top; any other case starts 30 days from now.
  v_until := case when s.plan_until is not null and s.plan_until > now() and s.plan = r.plan
                  then s.plan_until + interval '30 days' else now() + interval '30 days' end;

  update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan = r.plan, plan_source = 'paid', plan_base = v_base, plan_base_source = v_base_src,
                          plan_until = v_until
   where id = r.shop_id;
  perform set_config('bizgrow.plan_change', 'off', true);
  perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id, 'Paid for the ' || v_plan.name || ' plan online');
  return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan, 'plan_changed', true);
end
$$;

revoke all on function public.billing_begin_order(uuid, uuid, text), public.billing_attach_order(uuid, text),
                     public.billing_mark_paid(text, text, int, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.billing_begin_order(uuid, uuid, text), public.billing_attach_order(uuid, text),
                         public.billing_mark_paid(text, text, int, text, text, uuid) to service_role;

-- ---------- 6. platform owner: see and set where a shop's plan came from ----------
-- Sources: free (default), legacy (old default, not paid), promo, paid, manual (set by hand).
create or replace function public.admin_shop_plan(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.shops;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Shop not found.' using errcode = '22023'; end if;
  return jsonb_build_object('shop_id', s.id, 'shop', s.name, 'plan', s.plan, 'plan_source', s.plan_source,
    'plan_until', s.plan_until, 'plan_base', s.plan_base, 'plan_base_source', s.plan_base_source);
end
$$;

create or replace function public.admin_set_plan_source(p_shop uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_src text := lower(btrim(coalesce(p_source, ''))); v_old text;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  if v_src not in ('free', 'legacy', 'promo', 'paid', 'manual') then
    raise exception 'Pick one of: free, legacy, promo, paid, manual.' using errcode = '22023';
  end if;
  select plan_source into v_old from public.shops where id = p_shop for update;
  if not found then raise exception 'Shop not found.' using errcode = '22023'; end if;
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan_source = v_src where id = p_shop;
  perform set_config('bizgrow.plan_change', 'off', true);
  perform public._audit(p_shop, 'plan_source', 'shops', p_shop, 'Plan source set from ' || v_old || ' to ' || v_src || ' by BizGrow');
  return jsonb_build_object('ok', true, 'plan_source', v_src);
end
$$;

revoke all on function public.admin_shop_plan(uuid), public.admin_set_plan_source(uuid, text) from public, anon;
grant execute on function public.admin_shop_plan(uuid), public.admin_set_plan_source(uuid, text) to authenticated;
-- ==================== END patch-16.sql ====================

-- ==================== BEGIN patch-17.sql ====================
-- patch-17: promo codes, done properly end to end.
-- Run after patch-16. Safe to run more than once. Nothing existing is deleted.
--
-- What changes:
--   * A promo or a payment that ends goes back to FREE, never to the old default "All Features" (patch-14 gave
--     existing shops that plan with no payment; it must not come back when a code runs out).
--     Rule, at read time and when written: a base of 'legacy' (or none) means 'free'.
--   * Expiry is checked when the plan is read (get_my_plan, every paid or promo check), so the shop falls back to Free
--     even if nobody opens the app. The data is kept.
--   * get_my_plan also returns the end date, how many days are left, and the plan it goes back to. The app shows
--     a gentle "ends in N days" note from that.
--   * Codes ignore case AND spaces: " shop 2026 " is the same as SHOP2026.
--   * redeem_promo_code: clear, plain messages; a success message with the end date.
--   * admin_create_promo: checks every field and gives a plain message (days 1 to 3650 or for good, uses 1 to 10000,
--     an end date in the future, a paid plan only). No raw database text reaches the screen.
--   * One-time fix of rows already written by patch-15/16 (a promo that ended went back to 'All Features').

-- ---------- 1. helpers: where a shop goes back to ----------
create or replace function public._norm_code(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[[:space:]]+', '', 'g'))
$$;

-- The plan a shop goes back to when its time-limited plan ends. An old default ('legacy') or nothing means Free.
create or replace function public._fallback_code(p_plan text, p_source text)
returns text language sql immutable as $$
  select case when p_plan is null or p_source is null or p_source = 'legacy' then 'free' else p_plan end
$$;

create or replace function public._fallback_source(p_source text)
returns text language sql immutable as $$
  select case when p_source is null or p_source = 'legacy' then 'free' else p_source end
$$;

-- Whole calendar days left in India time (0 = ends today or already ended).
create or replace function public._days_left(p_at timestamptz)
returns int language sql stable as $$
  select greatest(0, ((p_at at time zone 'Asia/Kolkata')::date - (now() at time zone 'Asia/Kolkata')::date))::int
$$;

revoke all on function public._norm_code(text), public._fallback_code(text, text), public._fallback_source(text),
                       public._days_left(timestamptz) from public, anon, authenticated;

-- ---------- 2. the plan a shop has now (read time): an ended plan is Free, or its base when that is a real plan ----------
create or replace function public._plan_of(p_shop uuid)
returns public.plans
language sql stable security definer set search_path = public as $$
  select p.* from public.plans p join public.shops s
    on p.code = (case when s.plan_until is not null and s.plan_until <= now()
                      then public._fallback_code(s.plan_base, s.plan_base_source)
                      else s.plan end)
  where s.id = p_shop
$$;

-- Writes the end of a time-limited plan into the shop row (called before each paid or promo check).
create or replace function public._sync_shop_plan(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops
     set plan = public._fallback_code(plan_base, plan_base_source),
         plan_source = public._fallback_source(plan_base_source),
         plan_base = null, plan_base_source = null, plan_until = null
   where id = p_shop and plan_until is not null and plan_until <= now();
  perform set_config('bizgrow.plan_change', 'off', true);
end
$$;

-- ---------- 3. one-time fix of rows already written ----------
do $$
declare r record;
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  -- A promo or payment that ends must go back to Free, not to the old default.
  update public.shops set plan_base = 'free', plan_base_source = 'free'
   where plan_base_source = 'legacy';
  perform set_config('bizgrow.plan_change', 'off', true);
  -- Any shop whose time is already up goes back now (the same rule the read path uses).
  for r in select id from public.shops where plan_until is not null and plan_until <= now() loop
    perform public._sync_shop_plan(r.id);
  end loop;
end
$$;

-- ---------- 4. promo codes: redeem ----------
create or replace function public.redeem_promo_code(p_shop uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_code     text := public._norm_code(p_code);
  v_promo    public.promo_codes;
  v_shop     public.shops;
  v_cur      public.plans;
  v_new      public.plans;
  v_rank     int;
  v_base     text;
  v_base_src text;
  v_until    timestamptz;
  v_recent   int;
  v_msg      text;
begin
  if v_user is null then raise exception 'Please log in again.' using errcode = '42501'; end if;

  -- Rate limit first, and record the try before anything can fail (so guessing is counted).
  select count(*) into v_recent from public.promo_attempts
   where user_id = v_user and tried_at > now() - interval '15 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait 15 minutes and try again.');
  end if;
  insert into public.promo_attempts (user_id) values (v_user);

  -- A plain check, not _need: _need raises, and a raise would undo the counted try above.
  if p_shop is null or not public.has_shop_role(p_shop, array['owner']) then
    return jsonb_build_object('ok', false, 'message', 'Only the shop owner can use a promo code.');
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'Type the promo code first.');
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid. Check the letters and numbers and try again.');
  end if;

  -- Lock the code row: two shops using the last use at the same moment queue up here.
  select * into v_promo from public.promo_codes where code = v_code for update;
  if not found or not v_promo.active then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid or has ended. Check it with BizGrow.');
  end if;
  if v_promo.expires_at is not null and v_promo.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That code has ended, so it cannot be used now.');
  end if;
  if exists (select 1 from public.promo_redemptions where promo_id = v_promo.id and shop_id = p_shop) then
    return jsonb_build_object('ok', false, 'message', 'Your shop has already used this code.');
  end if;
  if v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('ok', false, 'message', 'This code has been used up.');
  end if;

  perform public._sync_shop_plan(p_shop);
  select * into v_shop from public.shops where id = p_shop for update;
  select * into v_cur from public._plan_of(p_shop);
  select * into v_new from public.plans where code = v_promo.plan;
  -- A legacy or free shop ranks below every paid plan, so any code can apply to it.
  v_rank := case when v_shop.plan_source in ('legacy', 'free') then 0 else v_cur.sort_order end;

  if v_new.sort_order > v_rank then
    -- Upgrade. The plan to go back to when this code's days end: the current base if the shop is on a timed plan, else its plan now.
    if v_shop.plan_until is not null then
      v_base     := public._fallback_code(v_shop.plan_base, v_shop.plan_base_source);
      v_base_src := public._fallback_source(v_shop.plan_base_source);
    else
      v_base     := public._fallback_code(v_shop.plan, v_shop.plan_source);
      v_base_src := public._fallback_source(v_shop.plan_source);
    end if;
    v_until := case when v_promo.duration_days is null then null else now() + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan = v_promo.plan, plan_source = 'promo', plan_until = v_until,
                            plan_base = case when v_until is null then null else v_base end,
                            plan_base_source = case when v_until is null then null else v_base_src end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code for the ' || v_new.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_new.code, 'plan_name', v_new.name, 'plan_until', v_until,
      'days_left', case when v_until is null then null else public._days_left(v_until) end,
      'message', 'Done. Your shop is now on the ' || v_new.name || ' plan'
                 || case when v_until is null then ' for good.' else ' until ' || public._day_text(v_until) || '.' end);
  end if;

  if v_new.code = v_cur.code and v_shop.plan_source not in ('legacy', 'free') then
    -- The same paid plan the shop already has.
    if v_shop.plan_until is null then
      return jsonb_build_object('ok', false, 'message',
        'Your shop is already on the ' || v_cur.name || ' plan for good, so this code was not used.');
    end if;
    -- Days go on top of the current end date. A code with no end date makes the plan permanent.
    v_until := case when v_promo.duration_days is null then null
                    else greatest(v_shop.plan_until, now()) + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan_until = v_until,
                            plan_base = case when v_until is null then null else plan_base end,
                            plan_base_source = case when v_until is null then null else plan_base_source end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code to extend the ' || v_cur.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_cur.code, 'plan_name', v_cur.name, 'plan_until', v_until, 'extended', true,
      'days_left', case when v_until is null then null else public._days_left(v_until) end,
      'message', 'Done. Your ' || v_cur.name || ' plan now runs'
                 || case when v_until is null then ' for good.' else ' until ' || public._day_text(v_until) || '.' end);
  end if;

  -- A lower plan: refused, and the message says what the shop has now and until when.
  v_msg := 'Your shop is on the ' || v_cur.name || ' plan'
        || case when v_shop.plan_until is not null then ' until ' || public._day_text(v_shop.plan_until) else ' for good' end
        || '. This code gives the ' || v_new.name || ' plan, which is lower, so it was not used.';
  return jsonb_build_object('ok', false, 'message', v_msg);
end
$$;
revoke all on function public.redeem_promo_code(uuid, text) from public, anon;
grant execute on function public.redeem_promo_code(uuid, text) to authenticated;

-- ---------- 5. promo codes: the platform owner makes a code (every field checked, plain messages) ----------
create or replace function public.admin_create_promo(p_code text, p_plan text, p_duration_days int,
                                                    p_max_uses int, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := public._norm_code(p_code); v_plan text := lower(btrim(coalesce(p_plan, ''))); v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    raise exception 'The code must be 4 to 30 letters or numbers. A dash is allowed inside.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where code = v_plan and sort_order > 1) then
    raise exception 'Pick a paid plan for the code: Growth or All Features.' using errcode = '22023';
  end if;
  if p_duration_days is not null and (p_duration_days < 1 or p_duration_days > 3650) then
    raise exception 'Days must be between 1 and 3650, or left empty for good.' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 10000 then
    raise exception 'The number of uses must be between 1 and 10000.' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The last day to use the code must be in the future.' using errcode = '22023';
  end if;
  insert into public.promo_codes (code, plan, duration_days, max_uses, expires_at, created_by)
  values (v_code, v_plan, p_duration_days, p_max_uses, p_expires_at, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
exception when unique_violation then
  raise exception 'That code already exists. Pick another.' using errcode = '22023';
end
$$;

-- ---------- 6. the plan a shop has, with its end date (the app shows "ends in N days") ----------
create or replace function public.get_my_plan(p_shop uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.plans%rowtype;
  s public.shops%rowtype;
  v_back public.plans%rowtype;
  v_req record;
begin
  if auth.uid() is null then raise exception 'Please log in again.' using errcode = '28000'; end if;
  if public._my_role(p_shop) is null then raise exception 'You are not in this shop' using errcode = '42501'; end if;
  p := public._plan_of(p_shop);
  select * into s from public.shops where id = p_shop;
  select * into v_back from public.plans
   where code = case when s.plan_until is not null then public._fallback_code(s.plan_base, s.plan_base_source)
                     else public._fallback_code(s.plan, s.plan_source) end;
  select r.to_plan, r.created_at into v_req
    from public.plan_requests r where r.shop_id = p_shop and r.status = 'new'
   order by r.created_at desc limit 1;
  return public._plan_json(p) || jsonb_build_object(
    'plan_source', case when s.plan_until is not null and s.plan_until <= now() then public._fallback_source(s.plan_base_source) else s.plan_source end,
    'plan_until', case when s.plan_until is not null and s.plan_until > now() then s.plan_until else null end,
    'plan_until_text', case when s.plan_until is not null and s.plan_until > now() then public._day_text(s.plan_until) else null end,
    'days_left', case when s.plan_until is not null and s.plan_until > now() then public._days_left(s.plan_until) else null end,
    'back_to', v_back.code,
    'back_to_name', v_back.name,
    'usage', jsonb_build_object(
      'bills', public._bills_in_month(p_shop, public._ist_today()),
      'items', public._items_count(p_shop),
      'people', public._people_count(p_shop)),
    'requested', case when v_req.to_plan is null then null
                 else jsonb_build_object('to_plan', v_req.to_plan, 'at', v_req.created_at) end);
end
$$;
revoke all on function public.get_my_plan(uuid) from public, anon;
grant execute on function public.get_my_plan(uuid) to authenticated;

-- ---------- 7. online payment: a paid plan that ends goes back to Free (same as codes) ----------
create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount int, p_currency text,
                                                   p_source text, p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.plan_payments; s public.shops; v_base text; v_base_src text; v_until timestamptz;
        v_plan public.plans; v_cur public.plans; v_rank int;
begin
  if p_source not in ('verify', 'webhook') then raise exception 'Unknown source.' using errcode = '22023'; end if;
  select * into r from public.plan_payments where razorpay_order_id = p_order for update;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;

  if r.status = 'paid' then
    if r.razorpay_payment_id = p_payment then
      return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan);
    end if;
    raise exception 'This order was already paid.' using errcode = '22023';
  end if;

  if p_amount is distinct from r.amount_paise or upper(coalesce(p_currency, '')) <> r.currency then
    raise exception 'Amount does not match this plan.' using errcode = '22023';
  end if;
  if p_source = 'verify' and (p_user_id is null or not exists (
       select 1 from public.staff where shop_id = r.shop_id and auth_user_id = p_user_id and role = 'owner' and active)) then
    raise exception 'Only the shop owner can confirm this payment.' using errcode = '42501';
  end if;

  perform public._sync_shop_plan(r.shop_id);
  select * into s from public.shops where id = r.shop_id for update;
  select * into v_plan from public.plans where code = r.plan;
  select * into v_cur from public._plan_of(r.shop_id);
  v_rank := case when s.plan_source in ('legacy', 'free') then 0 else v_cur.sort_order end;
  if v_rank >= v_plan.sort_order then
    -- Never move a shop down: the money is recorded, the plan stays as it is, and the owner is told.
    update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
    perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id,
      'Online payment for the ' || v_plan.name || ' plan received; the shop already had a plan at or above it, so the plan was not changed');
    return jsonb_build_object('ok', true, 'status', 'paid', 'plan', v_cur.code, 'plan_changed', false);
  end if;
  -- The plan to go back to when this payment's 30 days end: Free, unless the shop's own base is a real plan.
  if s.plan_until is not null then
    v_base     := public._fallback_code(s.plan_base, s.plan_base_source);
    v_base_src := public._fallback_source(s.plan_base_source);
  else
    v_base     := public._fallback_code(s.plan, s.plan_source);
    v_base_src := public._fallback_source(s.plan_source);
  end if;
  -- Renewing the same plan while it still runs adds 30 days on top; any other case starts 30 days from now.
  v_until := case when s.plan_until is not null and s.plan_until > now() and s.plan = r.plan
                  then s.plan_until + interval '30 days' else now() + interval '30 days' end;

  update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan = r.plan, plan_source = 'paid', plan_base = v_base, plan_base_source = v_base_src,
                          plan_until = v_until
   where id = r.shop_id;
  perform set_config('bizgrow.plan_change', 'off', true);
  perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id, 'Paid for the ' || v_plan.name || ' plan online');
  return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan, 'plan_changed', true);
end
$$;

revoke all on function public.billing_mark_paid(text, text, int, text, text, uuid) from public, anon, authenticated;
grant execute on function public.billing_mark_paid(text, text, int, text, text, uuid) to service_role;
-- ==================== END patch-17.sql ====================

-- ==================== BEGIN patch-18.sql ====================
-- ==================== patch-18: promo and voice limits, internal functions locked (safe to run again) ====================
-- Run after patch-17. Run it through supabase/run-all-pending.sql, which includes it.
--   1. Promo redeem: failed tries are counted per code across every account (50 per code per hour) and across all
--      codes (300 per hour). Hitting either gives the same generic message as the per-person limit.
--      Adds promo_attempts.code and promo_attempts.failed (existing rows keep failed = false).
--   2. Voice: one shared count per signed-in person (20 per minute), read by every Worker instance.
--      New table voice_attempts (locked, nothing can read it directly) and function voice_take (signed-in users only).
--   3. Internal helper functions (names starting with an underscore) cannot be run by anon or the public role.
--      Signed-in users keep the ones the policies and their own functions need.

-- ---------- 1. promo: failed tries per code and in total ----------
alter table public.promo_attempts add column if not exists code text;
alter table public.promo_attempts add column if not exists failed boolean not null default false;
create index if not exists promo_attempts_code_idx on public.promo_attempts (code, tried_at) where failed;
create index if not exists promo_attempts_failed_idx on public.promo_attempts (tried_at) where failed;

create or replace function public.redeem_promo_code(p_shop uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_code     text := public._norm_code(p_code);
  v_promo    public.promo_codes;
  v_shop     public.shops;
  v_cur      public.plans;
  v_new      public.plans;
  v_rank     int;
  v_base     text;
  v_base_src text;
  v_until    timestamptz;
  v_recent   int;
  v_msg      text;
  v_fails    int;
  v_attempt  bigint;
begin
  if v_user is null then raise exception 'Please log in again.' using errcode = '42501'; end if;

  -- Limits first. Every try is recorded before anything can fail, so guessing is counted. A try counts as failed
  -- until it actually uses the code (then it is set back). Three caps, all with the same generic message:
  --   10 tries per person in 15 minutes (any code);
  --   50 failed tries per code in an hour, across every account (patch-18);
  --   300 failed tries across all codes in an hour, across every account (patch-18).
  select count(*) into v_recent from public.promo_attempts
   where user_id = v_user and tried_at > now() - interval '15 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait a while and try again.');
  end if;
  select count(*) into v_fails from public.promo_attempts
   where code = v_code and failed and tried_at > now() - interval '1 hour';
  if v_fails >= 50 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait a while and try again.');
  end if;
  select count(*) into v_fails from public.promo_attempts
   where failed and tried_at > now() - interval '1 hour';
  if v_fails >= 300 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait a while and try again.');
  end if;
  insert into public.promo_attempts (user_id, code, failed) values (v_user, v_code, true) returning id into v_attempt;

  -- A plain check, not _need: _need raises, and a raise would undo the counted try above.
  if p_shop is null or not public.has_shop_role(p_shop, array['owner']) then
    return jsonb_build_object('ok', false, 'message', 'Only the shop owner can use a promo code.');
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'Type the promo code first.');
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid. Check the letters and numbers and try again.');
  end if;

  -- Lock the code row: two shops using the last use at the same moment queue up here.
  select * into v_promo from public.promo_codes where code = v_code for update;
  if not found or not v_promo.active then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid or has ended. Check it with BizGrow.');
  end if;
  if v_promo.expires_at is not null and v_promo.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That code has ended, so it cannot be used now.');
  end if;
  if exists (select 1 from public.promo_redemptions where promo_id = v_promo.id and shop_id = p_shop) then
    return jsonb_build_object('ok', false, 'message', 'Your shop has already used this code.');
  end if;
  if v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('ok', false, 'message', 'This code has been used up.');
  end if;

  perform public._sync_shop_plan(p_shop);
  select * into v_shop from public.shops where id = p_shop for update;
  select * into v_cur from public._plan_of(p_shop);
  select * into v_new from public.plans where code = v_promo.plan;
  -- A legacy or free shop ranks below every paid plan, so any code can apply to it.
  v_rank := case when v_shop.plan_source in ('legacy', 'free') then 0 else v_cur.sort_order end;

  if v_new.sort_order > v_rank then
    -- Upgrade. The plan to go back to when this code's days end: the current base if the shop is on a timed plan, else its plan now.
    if v_shop.plan_until is not null then
      v_base     := public._fallback_code(v_shop.plan_base, v_shop.plan_base_source);
      v_base_src := public._fallback_source(v_shop.plan_base_source);
    else
      v_base     := public._fallback_code(v_shop.plan, v_shop.plan_source);
      v_base_src := public._fallback_source(v_shop.plan_source);
    end if;
    v_until := case when v_promo.duration_days is null then null else now() + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    update public.promo_attempts set failed = false where id = v_attempt;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan = v_promo.plan, plan_source = 'promo', plan_until = v_until,
                            plan_base = case when v_until is null then null else v_base end,
                            plan_base_source = case when v_until is null then null else v_base_src end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code for the ' || v_new.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_new.code, 'plan_name', v_new.name, 'plan_until', v_until,
      'days_left', case when v_until is null then null else public._days_left(v_until) end,
      'message', 'Done. Your shop is now on the ' || v_new.name || ' plan'
                 || case when v_until is null then ' for good.' else ' until ' || public._day_text(v_until) || '.' end);
  end if;

  if v_new.code = v_cur.code and v_shop.plan_source not in ('legacy', 'free') then
    -- The same paid plan the shop already has.
    if v_shop.plan_until is null then
      return jsonb_build_object('ok', false, 'message',
        'Your shop is already on the ' || v_cur.name || ' plan for good, so this code was not used.');
    end if;
    -- Days go on top of the current end date. A code with no end date makes the plan permanent.
    v_until := case when v_promo.duration_days is null then null
                    else greatest(v_shop.plan_until, now()) + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    update public.promo_attempts set failed = false where id = v_attempt;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan_until = v_until,
                            plan_base = case when v_until is null then null else plan_base end,
                            plan_base_source = case when v_until is null then null else plan_base_source end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code to extend the ' || v_cur.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_cur.code, 'plan_name', v_cur.name, 'plan_until', v_until, 'extended', true,
      'days_left', case when v_until is null then null else public._days_left(v_until) end,
      'message', 'Done. Your ' || v_cur.name || ' plan now runs'
                 || case when v_until is null then ' for good.' else ' until ' || public._day_text(v_until) || '.' end);
  end if;

  -- A lower plan: refused, and the message says what the shop has now and until when.
  v_msg := 'Your shop is on the ' || v_cur.name || ' plan'
        || case when v_shop.plan_until is not null then ' until ' || public._day_text(v_shop.plan_until) else ' for good' end
        || '. This code gives the ' || v_new.name || ' plan, which is lower, so it was not used.';
  return jsonb_build_object('ok', false, 'message', v_msg);
end
$$;

revoke all on function public.redeem_promo_code(uuid, text) from public, anon;
grant execute on function public.redeem_promo_code(uuid, text) to authenticated;

-- ---------- 2. voice: one shared count per signed-in person ----------
create table if not exists public.voice_attempts (
  id        bigint generated always as identity primary key,
  user_id   uuid not null,
  tried_at  timestamptz not null default now()
);
create index if not exists voice_attempts_user_idx on public.voice_attempts (user_id, tried_at);
create index if not exists voice_attempts_time_idx on public.voice_attempts (tried_at);
alter table public.voice_attempts enable row level security;
revoke all on public.voice_attempts from public, anon, authenticated;

create or replace function public.voice_take(p_max int, p_window_seconds int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_recent int;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'code', 'login'); end if;
  -- One at a time per person, so two requests at the same moment cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('voice:' || v_user::text, 0));
  select count(*) into v_recent from public.voice_attempts
   where user_id = v_user and tried_at > now() - make_interval(secs => p_window_seconds);
  if v_recent >= p_max then return jsonb_build_object('ok', false, 'code', 'limited'); end if;
  insert into public.voice_attempts (user_id) values (v_user);
  delete from public.voice_attempts where tried_at < now() - interval '1 day';
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.voice_take(int, int) from public, anon;
grant execute on function public.voice_take(int, int) to authenticated;

-- ---------- 3. internal helpers: not callable by anon or the public role ----------
-- Functions the front end calls are not underscore names, so nothing a signed-in user uses is changed.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '\_%'
  loop
    execute 'revoke all on function ' || r.sig || ' from public, anon';
  end loop;
end
$$;
-- ==================== END patch-18.sql ====================
