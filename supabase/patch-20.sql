-- patch-20: the whole-shop caps are removed from the public order and tracking functions (stage 12).
-- Run once in the Supabase SQL Editor after patch-19 (or use supabase/run-all-pending.sql). Safe to run more than once.
-- What changes:
--   * place_store_order no longer stops every order for a whole store after 300 in an hour.
--     Anyone on the public web could use up that shared count and block a shop for everyone.
--   * track_store_order no longer stops every tracking try for a whole store after 300 in an hour.
--   * What stays: per phone number limits (3 orders in 10 minutes for a known phone, 2 an hour for a new one;
--     10 tracking tries in 15 minutes), and the per connection limits from patch-12 and patch-13
--     (10 orders an hour, 10 tracking tries in 15 minutes). The Cloudflare rate-limit rule on the public
--     routes is the outer guard and is set in the dashboard.
-- Nothing is deleted. No order, product, customer or stock count changes.
-- Privileges are kept: create or replace does not change grants.

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
  if v_by_phone > 10 then
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
