-- patch-07: online store hardening (stage 4).
-- Run once in the Supabase SQL Editor after patch-06. Safe to run more than once.
-- What changes:
--   * An order is refused when an item's quantity is more than the stock left,
--     and the message names the item and the amount left.
--   * place_store_order returns the saved lines and total, so the WhatsApp message
--     uses the saved values.
--   * Stricter limit on orders per phone. Phones the shop has not seen get a lower cap.
--   * Status changes follow the rules: new -> accepted -> packed -> delivered, and
--     cancel from any open state. Anything else (reopen, skip a step) is owner only.
--     The audit line records the old and the new status.
--   * Owner only: cancel all new orders in one go (for junk orders).
--   * Orders list: newest first, can hide cancelled orders, and can load older ones.
--   * The public catalogue returns a capped max_qty per item, not the exact stock.

-- ---------- public: catalogue with a capped max quantity ----------

create or replace function public.public_store_catalogue(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.shops%rowtype;
  v_items jsonb;
begin
  select * into v_s from public.shops
   where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'name', q.name, 'category', q.category, 'unit', q.unit,
           'price', q.price, 'max_qty', q.max_qty)
           order by q.name), '[]'::jsonb)
    into v_items
    from (
      select p.id, p.name, p.category, p.unit, p.sell_price as price,
             least(p.stock_qty, 999) as max_qty
        from public.products p
       where p.shop_id = v_s.id and p.deleted_at is null and p.stock_qty > 0
       order by p.name
       limit 300
    ) q;
  return jsonb_build_object(
    'found', true,
    'shop', jsonb_build_object('name', v_s.name, 'phone', v_s.phone, 'city', v_s.city, 'lang', v_s.lang),
    'items', v_items);
end
$$;

-- ---------- public: place an order ----------

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

-- ---------- staff: orders list ----------

-- The old one-argument list is removed so only the new version remains.
drop function if exists public.list_store_orders(uuid, text);

-- Owner, manager or cashier: the shop's orders, newest first, 50 at a time.
-- p_before: pass the created_at of the last order shown to load older ones.
-- p_hide_cancelled: leave out cancelled orders.
create or replace function public.list_store_orders(
  p_shop uuid, p_status text default null, p_before timestamptz default null,
  p_hide_cancelled boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_new int;
  v_more boolean;
begin
  perform public._need(p_shop, array['owner', 'manager', 'cashier'], 'Only the owner, manager or cashier can see orders');
  if p_status is not null and p_status not in ('new', 'accepted', 'packed', 'delivered', 'cancelled') then
    raise exception 'Unknown order status';
  end if;
  select count(*) into v_new from public.store_orders where shop_id = p_shop and status = 'new';
  select count(*) > 50 into v_more
    from (
      select 1 from public.store_orders o
       where o.shop_id = p_shop
         and (p_status is null or o.status = p_status)
         and (not coalesce(p_hide_cancelled, false) or o.status <> 'cancelled')
         and (p_before is null or o.created_at < p_before)
       limit 51
    ) m;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'ref', upper(substr(md5(q.id::text), 1, 6)),
           'name', q.customer_name,
           'phone', q.customer_phone,
           'note', q.note,
           'status', q.status,
           'item_count', q.item_count,
           'total', q.total,
           'created_at', q.created_at,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                       'name', i.name, 'unit', i.unit, 'price', i.price,
                       'qty', i.qty, 'line_total', i.line_total) order by i.name), '[]'::jsonb)
                       from public.store_order_items i where i.order_id = q.id))
           order by q.created_at desc), '[]'::jsonb)
    into v_items
    from (
      select o.* from public.store_orders o
       where o.shop_id = p_shop
         and (p_status is null or o.status = p_status)
         and (not coalesce(p_hide_cancelled, false) or o.status <> 'cancelled')
         and (p_before is null or o.created_at < p_before)
       order by o.created_at desc
       limit 50
    ) q;
  return jsonb_build_object('items', v_items, 'new_count', v_new, 'has_more', v_more);
end
$$;

-- ---------- staff: change one order's status ----------

-- Moves allowed for owner, manager and cashier:
--   new -> accepted -> packed -> delivered, and cancel from new, accepted or packed.
-- Anything else (reopen from delivered or cancelled, skip a step) is owner only.
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
  update public.store_orders set status = p_status, updated_at = now() where id = p_order;
  v_ref := upper(substr(md5(p_order::text), 1, 6));
  perform public._audit(v_o.shop_id, 'edit', 'store_orders', p_order,
    'Order ' || v_ref || ' changed from ' || v_o.status || ' to ' || p_status);
  return jsonb_build_object('ok', true, 'status', p_status, 'from', v_o.status, 'changed', true);
end
$$;

-- ---------- owner only: cancel new (junk) orders in one go ----------

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
     for update
  loop
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

revoke all on function public.public_store_catalogue(text) from public;
grant execute on function public.public_store_catalogue(text) to anon, authenticated;

revoke all on function public.place_store_order(text, text, text, text, jsonb) from public;
grant execute on function public.place_store_order(text, text, text, text, jsonb) to anon, authenticated;

revoke all on function public.list_store_orders(uuid, text, timestamptz, boolean) from public, anon;
grant execute on function public.list_store_orders(uuid, text, timestamptz, boolean) to authenticated;

revoke all on function public.set_store_order_status(uuid, text) from public, anon;
grant execute on function public.set_store_order_status(uuid, text) to authenticated;

revoke all on function public.cancel_new_store_orders(uuid, uuid[]) from public, anon;
grant execute on function public.cancel_new_store_orders(uuid, uuid[]) to authenticated;
