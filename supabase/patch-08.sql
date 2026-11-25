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
