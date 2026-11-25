-- patch-06: online store for the shop's own buyers.
-- The owner turns the store on. Anyone with the store link sees the in-stock
-- items (selling prices only) and can send an order with a name and phone.
-- Orders are read and changed only by the shop's owner, manager or cashier.
-- Nothing here takes payment. Run once in the Supabase SQL Editor.
-- Safe to run more than once.

alter table public.shops add column if not exists store_enabled boolean not null default false;
alter table public.shops add column if not exists store_slug text;
create unique index if not exists shops_store_slug_key on public.shops (store_slug);

create table if not exists public.store_orders (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id) on delete cascade,
  customer_name  text not null,
  customer_phone text not null,
  note           text,
  status         text not null default 'new'
                 check (status in ('new', 'accepted', 'packed', 'delivered', 'cancelled')),
  item_count     int not null default 0,
  total          numeric(12,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists store_orders_shop_idx on public.store_orders (shop_id, created_at desc);

create table if not exists public.store_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.store_orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  unit        text,
  price       numeric(12,2) not null default 0,
  qty         numeric(12,3) not null default 0,
  line_total  numeric(12,2) not null default 0
);
create index if not exists store_order_items_order_idx on public.store_order_items (order_id);

-- No policies: the tables are reached only through the functions below.
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;
revoke all on public.store_orders, public.store_order_items from anon, authenticated;

-- A short, unique store link name, for example "rajesh-textiles-4f9a2c".
create or replace function public._store_slug(p_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(
           nullif(trim(both '-' from left(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), 30)), ''),
           'shop')
         || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
$$;

-- Anonymous: the public store. Only for shops that turned the store on.
-- Returns selling prices and in-stock items. Never cost prices, never customers.
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
           'id', q.id, 'name', q.name, 'category', q.category, 'unit', q.unit, 'price', q.price)
           order by q.name), '[]'::jsonb)
    into v_items
    from (
      select p.id, p.name, p.category, p.unit, p.sell_price as price
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

-- Anonymous: place an order from the public store. Checks the input and limits
-- how often one number and one shop can send orders. Prices come from the shop's
-- own product list, never from the browser.
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
  v_count int := 0;
  v_total numeric := 0;
  v_recent int;
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

  select count(*) into v_recent from public.store_orders
   where shop_id = v_s.id and customer_phone = v_phone and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'Too many orders from this number. Please wait a few minutes.';
  end if;
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
       and shop_id = v_s.id and deleted_at is null and stock_qty > 0;
    if not found then
      raise exception 'Some items are no longer in stock. Please refresh the store and try again.';
    end if;
    v_line := round(v_p.sell_price * v_qty, 2);
    insert into public.store_order_items (order_id, product_id, name, unit, price, qty, line_total)
    values (v_order, v_p.id, v_p.name, v_p.unit, v_p.sell_price, v_qty, v_line);
    v_count := v_count + 1;
    v_total := v_total + v_line;
  end loop;

  update public.store_orders set item_count = v_count, total = v_total where id = v_order;
  return jsonb_build_object(
    'ok', true,
    'ref', upper(substr(md5(v_order::text), 1, 6)),
    'item_count', v_count,
    'total', v_total);
end
$$;

-- Owner, manager or cashier: the shop's orders, newest first, with the count of new ones.
create or replace function public.list_store_orders(p_shop uuid, p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_new int;
begin
  perform public._need(p_shop, array['owner', 'manager', 'cashier'], 'Only the owner, manager or cashier can see orders');
  if p_status is not null and p_status not in ('new', 'accepted', 'packed', 'delivered', 'cancelled') then
    raise exception 'Unknown order status';
  end if;
  select count(*) into v_new from public.store_orders where shop_id = p_shop and status = 'new';
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
       where o.shop_id = p_shop and (p_status is null or o.status = p_status)
       order by o.created_at desc
       limit 200
    ) q;
  return jsonb_build_object('items', v_items, 'new_count', v_new);
end
$$;

-- Owner, manager or cashier: move an order to a new status.
create or replace function public.set_store_order_status(p_order uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.store_orders%rowtype;
begin
  select * into v_o from public.store_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  perform public._need(v_o.shop_id, array['owner', 'manager', 'cashier'], 'Only the owner, manager or cashier can change orders');
  if p_status not in ('new', 'accepted', 'packed', 'delivered', 'cancelled') then
    raise exception 'Unknown order status';
  end if;
  update public.store_orders set status = p_status, updated_at = now() where id = p_order;
  perform public._audit(v_o.shop_id, 'edit', 'store_orders', p_order,
    'Order ' || upper(substr(md5(p_order::text), 1, 6)) || ' marked ' || p_status);
  return jsonb_build_object('ok', true, 'status', p_status);
end
$$;

-- Owner only: turn the online store on or off. The link name is made once and kept.
create or replace function public.set_store_enabled(p_shop uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_on boolean := coalesce(p_enabled, false);
begin
  perform public._need(p_shop, array['owner'], 'Only the owner can turn the online store on or off');
  update public.shops
     set store_enabled = v_on,
         store_slug = coalesce(store_slug, public._store_slug(name))
   where id = p_shop
   returning store_slug into v_slug;
  if not found then
    raise exception 'Shop not found';
  end if;
  perform public._audit(p_shop, 'edit', 'shops', p_shop,
    case when v_on then 'Online store turned on' else 'Online store turned off' end);
  return jsonb_build_object('ok', true, 'store_enabled', v_on, 'store_slug', v_slug);
end
$$;

-- Grants: anonymous visitors may only read the public store and place an order.
grant usage on schema public to anon;
revoke all on function public._store_slug(text) from public, anon, authenticated;

revoke all on function public.public_store_catalogue(text) from public;
grant execute on function public.public_store_catalogue(text) to anon, authenticated;

revoke all on function public.place_store_order(text, text, text, text, jsonb) from public;
grant execute on function public.place_store_order(text, text, text, text, jsonb) to anon, authenticated;

revoke all on function public.list_store_orders(uuid, text) from public, anon;
grant execute on function public.list_store_orders(uuid, text) to authenticated;

revoke all on function public.set_store_order_status(uuid, text) from public, anon;
grant execute on function public.set_store_order_status(uuid, text) to authenticated;

revoke all on function public.set_store_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_store_enabled(uuid, boolean) to authenticated;
