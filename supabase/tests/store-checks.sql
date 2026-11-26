-- Online store checks (stage 4 and 5). Each check has an id that matches docs/specs/online-store.md.
-- SCRATCH DATABASE ONLY: this file creates test users, a test shop and test orders.
-- Do not run it on the live Supabase project. Run it with supabase/tests/run-checks.cjs,
-- which loads schema.sql, patch-07.sql, patch-08.sql and patch-09.sql into an empty scratch database first.
-- The last result lists one row per check: ok = true means the check passed.

create temp table if not exists store_check_results (id text primary key, ok boolean, detail text);
create temp table if not exists store_check_ids (name text primary key, id uuid);

-- ---------- setup ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'cashier@test.local'),
  ('00000000-0000-0000-0000-0000000000a9', 'nobody@test.local');

insert into public.shops (id, name, phone, city, lang, store_enabled, store_slug) values
  ('00000000-0000-0000-0000-0000000000b1', 'Test Shop', '9811111111', 'Jaipur', 'en', true, 'test-shop-1');

insert into public.staff (shop_id, auth_user_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Owner', 'owner@test.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'Manager', 'manager@test.local', 'manager'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'Cashier', 'cashier@test.local', 'cashier');

insert into public.products (id, shop_id, name, category, unit, buy_price, sell_price, stock_qty) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Cotton Thread', 'thread', 'kg', 40, 60, 5),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'Bulk Item', 'misc', 'pcs', 10, 15, 2000),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1', 'Zero Item', 'misc', 'pcs', 10, 20, 0);

-- A customer the shop already knows, written with spaces and a country code.
insert into public.customers (shop_id, name, phone) values
  ('00000000-0000-0000-0000-0000000000b1', 'Known Buyer', '+91 90000 00003');

-- ---------- C01 to C03: who may reach what ----------
insert into store_check_results
select 'C01', not has_table_privilege('anon', 'public.store_orders', 'select')
              and not has_table_privilege('authenticated', 'public.store_orders', 'select')
              and not has_table_privilege('anon', 'public.store_order_items', 'select'),
       'anon and signed-in users cannot read the order tables directly';

insert into store_check_results
select 'C02', not has_function_privilege('anon', 'public.list_store_orders(uuid,text,timestamptz,boolean)', 'execute')
              and not has_function_privilege('anon', 'public.set_store_order_status(uuid,text)', 'execute')
              and not has_function_privilege('anon', 'public.cancel_new_store_orders(uuid,uuid[])', 'execute')
              and not has_function_privilege('anon', 'public.set_store_enabled(uuid,boolean)', 'execute'),
       'anonymous visitors cannot run staff or owner functions';

insert into store_check_results
select 'C03', has_function_privilege('anon', 'public.public_store_catalogue(text)', 'execute')
              and has_function_privilege('anon', 'public.place_store_order(text,text,text,text,jsonb)', 'execute'),
       'anonymous visitors can read the public store and place an order';

-- ---------- C04 to C05: the public store ----------
insert into store_check_results
select 'C04', (public.public_store_catalogue('test-shop-1')::text not like '%buy_price%')
              and (public.public_store_catalogue('test-shop-1')::text not like '%"cost%')
              and (public.public_store_catalogue('test-shop-1')::text like '%Cotton Thread%')
              and (public.public_store_catalogue('test-shop-1')::text not like '%Zero Item%'),
       'no cost prices in the public store; out-of-stock items are left out';

insert into store_check_results
select 'C05', (select (i->>'max_qty')::numeric from jsonb_array_elements(public.public_store_catalogue('test-shop-1')->'items') i where i->>'name' = 'Cotton Thread') = 5
              and (select (i->>'max_qty')::numeric from jsonb_array_elements(public.public_store_catalogue('test-shop-1')->'items') i where i->>'name' = 'Bulk Item') = 999,
       'max_qty is the stock left, capped at 999';

-- ---------- C06 to C08: stock check when placing an order ----------
do $$
declare v text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '', false);
  begin
    perform public.place_store_order('test-shop-1', 'Test Buyer', '9000000010', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c1', 'qty', '6')));
  exception when others then v := sqlerrm;
  end;
  insert into store_check_results values ('C06', v = 'Only 5 kg of Cotton Thread is left. Please lower the quantity.', v);
end $$;

do $$
declare v text := 'no error';
begin
  begin
    perform public.place_store_order('test-shop-1', 'Test Buyer', '9000000011', null,
      jsonb_build_array(
        jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c1', 'qty', '3'),
        jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c1', 'qty', '3')));
  exception when others then v := sqlerrm;
  end;
  insert into store_check_results values ('C07', v = 'Only 2 kg of Cotton Thread is left. Please lower the quantity.', v);
end $$;

insert into store_check_results
select 'C08', (select count(*) from public.store_orders where customer_phone in ('9000000010', '9000000011')) = 0,
       'a refused order leaves nothing behind';

-- ---------- C09: the reply carries the saved lines and total ----------
do $$
declare r jsonb; saved numeric; line_sum numeric;
begin
  r := public.place_store_order('test-shop-1', 'Test Buyer', '9000000012', 'please pack well',
    jsonb_build_array(
      jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c1', 'qty', '2'),
      jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '4')));
  select total into saved from public.store_orders where id = (select id from public.store_orders where customer_phone = '9000000012');
  select sum((l->>'line_total')::numeric) into line_sum from jsonb_array_elements(r->'lines') l;
  insert into store_check_results values ('C09',
    (r->>'total')::numeric = 180 and saved = 180 and line_sum = 180 and jsonb_array_length(r->'lines') = 2,
    'total ' || (r->>'total') || ', saved ' || saved || ', lines add to ' || line_sum);
end $$;

-- ---------- C10 to C11: how many orders one number may send ----------
do $$
declare ok_count int := 0; v text := '';
begin
  for i in 1..3 loop
    begin
      perform public.place_store_order('test-shop-1', 'Test Buyer', '9000000020', null,
        jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
      ok_count := ok_count + 1;
    exception when others then v := sqlerrm;
    end;
  end loop;
  insert into store_check_results values ('C10', ok_count = 2 and v like 'Too many orders from this number%',
    'accepted ' || ok_count || ' of 3 from a number the shop has not seen');
end $$;

do $$
declare ok_count int := 0; v text := '';
begin
  for i in 1..4 loop
    begin
      perform public.place_store_order('test-shop-1', 'Known Buyer', '9000000003', null,
        jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
      ok_count := ok_count + 1;
    exception when others then v := sqlerrm;
    end;
  end loop;
  insert into store_check_results values ('C11', ok_count = 3 and v like 'Too many orders from this number%',
    'accepted ' || ok_count || ' of 4 from a known customer (their number is saved with spaces)');
end $$;

-- ---------- staff: status moves (C12 to C19) ----------
-- Order for the status tests, from a number the shop has not seen.
do $$
declare r jsonb;
begin
  r := public.place_store_order('test-shop-1', 'Status Buyer', '9000000040', null,
    jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
  insert into store_check_ids select 'status', id from public.store_orders where customer_phone = '9000000040';
end $$;

-- C12: cashier may accept a new order.
do $$
declare v text := 'no error'; st text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
  begin
    perform public.set_store_order_status((select id from store_check_ids where name = 'status'), 'accepted');
  exception when others then v := sqlerrm;
  end;
  select status into st from public.store_orders where id = (select id from store_check_ids where name = 'status');
  insert into store_check_results values ('C12', v = 'no error' and st = 'accepted', v || ' / ' || st);
end $$;

-- C13: manager cannot reopen an accepted order back to new.
do $$
declare v text := 'no error'; st text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
  begin
    perform public.set_store_order_status((select id from store_check_ids where name = 'status'), 'new');
  exception when others then v := sqlerrm;
  end;
  select status into st from public.store_orders where id = (select id from store_check_ids where name = 'status');
  insert into store_check_results values ('C13', v like 'Only the owner can reopen%' and st = 'accepted', v);
end $$;

-- C14: manager cannot skip from accepted straight to delivered.
do $$
declare v text := 'no error'; st text;
begin
  begin
    perform public.set_store_order_status((select id from store_check_ids where name = 'status'), 'delivered');
  exception when others then v := sqlerrm;
  end;
  select status into st from public.store_orders where id = (select id from store_check_ids where name = 'status');
  insert into store_check_results values ('C14', v like 'Only the owner can reopen%' and st = 'accepted', v);
end $$;

-- C15: manager follows the normal steps to delivered.
do $$
declare v text := 'no error'; st text;
begin
  begin
    perform public.set_store_order_status((select id from store_check_ids where name = 'status'), 'packed');
    perform public.set_store_order_status((select id from store_check_ids where name = 'status'), 'delivered');
  exception when others then v := sqlerrm;
  end;
  select status into st from public.store_orders where id = (select id from store_check_ids where name = 'status');
  insert into store_check_results values ('C15', v = 'no error' and st = 'delivered', v || ' / ' || st);
end $$;

-- C16: manager cannot reopen a delivered order.
do $$
declare v text := 'no error'; st text;
begin
  begin
    perform public.set_store_order_status((select id from store_check_ids where name = 'status'), 'accepted');
  exception when others then v := sqlerrm;
  end;
  select status into st from public.store_orders where id = (select id from store_check_ids where name = 'status');
  insert into store_check_results values ('C16', v like 'Only the owner can reopen%' and st = 'delivered', v);
end $$;

-- C17: owner may reopen a delivered order.
do $$
declare v text := 'no error'; st text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
  begin
    perform public.set_store_order_status((select id from store_check_ids where name = 'status'), 'accepted');
  exception when others then v := sqlerrm;
  end;
  select status into st from public.store_orders where id = (select id from store_check_ids where name = 'status');
  insert into store_check_results values ('C17', v = 'no error' and st = 'accepted', v || ' / ' || st);
end $$;

-- C18: the audit line records the old and the new status.
insert into store_check_results
select 'C18', exists (
  select 1 from public.audit_log a
   where a.row_id = (select id from store_check_ids where name = 'status')
     and a.summary like '%changed from delivered to accepted%'),
  'audit line shows old and new status';

-- C19: cancel from an open state is allowed for staff; a cancelled order cannot be moved by staff.
do $$
declare r jsonb; v text := 'no error'; st text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
  r := public.place_store_order('test-shop-1', 'Cancel Buyer', '9000000041', null,
    jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
  insert into store_check_ids select 'cancel', id from public.store_orders where customer_phone = '9000000041';
  perform public.set_store_order_status((select id from store_check_ids where name = 'cancel'), 'cancelled');
  begin
    perform public.set_store_order_status((select id from store_check_ids where name = 'cancel'), 'new');
  exception when others then v := sqlerrm;
  end;
  select status into st from public.store_orders where id = (select id from store_check_ids where name = 'cancel');
  insert into store_check_results values ('C19', st = 'cancelled' and v like 'Only the owner can reopen%', v || ' / ' || st);
end $$;

-- ---------- C20 to C22: owner bulk cancel of junk orders ----------
do $$
declare v text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
  begin
    perform public.cancel_new_store_orders('00000000-0000-0000-0000-0000000000b1', null);
  exception when others then v := sqlerrm;
  end;
  insert into store_check_results values ('C20', v = 'Only the owner can cancel orders in bulk', v);
end $$;

do $$
declare n_new int; r jsonb; still_accepted text;
begin
  perform set_config('request.jwt.claim.sub', '', false);
  for i in 50..52 loop
    perform public.place_store_order('test-shop-1', 'Junk Sender', '90000000' || i, null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
  end loop;
  select count(*) into n_new from public.store_orders where shop_id = '00000000-0000-0000-0000-0000000000b1' and status = 'new';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
  r := public.cancel_new_store_orders('00000000-0000-0000-0000-0000000000b1', null);
  select status into still_accepted from public.store_orders where id = (select id from store_check_ids where name = 'status');
  insert into store_check_results values ('C21',
    (r->>'cancelled')::int = n_new and n_new >= 3
    and not exists (select 1 from public.store_orders where shop_id = '00000000-0000-0000-0000-0000000000b1' and status = 'new')
    and still_accepted = 'accepted',
    'cancelled ' || (r->>'cancelled') || ' of ' || n_new || ' new orders; the accepted order is kept');
end $$;

insert into store_check_results
select 'C22', exists (
  select 1 from public.audit_log a
   where a.summary like '%changed from new to cancelled (bulk cancel)%'),
  'bulk cancel writes an audit line with old and new status';

-- ---------- C23 to C25: the orders list ----------
insert into public.store_orders (shop_id, customer_name, customer_phone, status, item_count, total, created_at)
select '00000000-0000-0000-0000-0000000000b1', 'List Buyer', '9000000100', 'accepted', 1, 60,
       now() - (g || ' minutes')::interval
  from generate_series(1, 55) g;

do $$
declare p1 jsonb; p2 jsonb; total int; n1 int; n2 int; more1 boolean; more2 boolean; distinct_ids int; hidden_cancel int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
  select count(*) into total from public.store_orders where shop_id = '00000000-0000-0000-0000-0000000000b1';
  p1 := public.list_store_orders('00000000-0000-0000-0000-0000000000b1', null, null, false);
  n1 := jsonb_array_length(p1->'items');
  more1 := (p1->>'has_more')::boolean;
  p2 := public.list_store_orders('00000000-0000-0000-0000-0000000000b1', null, (p1->'items'->-1->>'created_at')::timestamptz, false);
  n2 := jsonb_array_length(p2->'items');
  more2 := (p2->>'has_more')::boolean;
  select count(distinct x->>'id') into distinct_ids
    from (select jsonb_array_elements(p1->'items') x union all select jsonb_array_elements(p2->'items')) q;
  insert into store_check_results values ('C23', n1 = 50 and more1 and n2 = total - 50 and not more2 and distinct_ids = total,
    'page 1: ' || n1 || ' (more: ' || more1 || '); page 2: ' || n2 || '; all ' || total || ' orders seen once');
  -- C24: newest first
  insert into store_check_results values ('C24',
    (select bool_and((p1->'items'->(i)->>'created_at')::timestamptz >= (p1->'items'->(i+1)->>'created_at')::timestamptz)
       from generate_series(0, n1 - 2) i),
    'orders on a page run newest first');
  -- C25: hide cancelled
  p1 := public.list_store_orders('00000000-0000-0000-0000-0000000000b1', null, null, true);
  select count(*) into hidden_cancel from jsonb_array_elements(p1->'items') x where x->>'status' = 'cancelled';
  insert into store_check_results values ('C25', hidden_cancel = 0, 'cancelled orders hidden: ' || hidden_cancel || ' shown');
end $$;

-- C26: a person with no role in the shop cannot see orders.
do $$
declare v text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', false);
  begin
    perform public.list_store_orders('00000000-0000-0000-0000-0000000000b1', null, null, false);
  exception when others then v := sqlerrm;
  end;
  insert into store_check_results values ('C26', v like 'Only the owner, manager or cashier%', v);
end $$;

-- ---------- C27 to C38: orders move stock (stage 5) ----------
-- A second shop, so these checks do not share the order limits of the shop above.
insert into public.shops (id, name, phone, city, lang, store_enabled, store_slug) values
  ('00000000-0000-0000-0000-0000000000b2', 'Stock Shop', '9822222222', 'Jaipur', 'en', true, 'stock-shop-2');
insert into public.staff (shop_id, auth_user_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Owner', 'owner@test.local', 'owner');
insert into public.products (id, shop_id, name, category, unit, buy_price, sell_price, stock_qty) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'Stock Item', 'misc', 'kg', 5, 10, 10);

-- Small helpers for the checks below (temporary, gone when the session ends).
create or replace function pg_temp.try_place(p_qty numeric, p_phone text)
returns text language plpgsql as $$
begin
  perform public.place_store_order('stock-shop-2', 'Stock Buyer', p_phone, null,
    jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000d1', 'qty', p_qty)));
  return 'ok';
exception when others then
  return sqlerrm;
end
$$;
create or replace function pg_temp.order_id(p_phone text)
returns uuid language sql as $$
  select o.id from public.store_orders o
   where o.customer_phone = p_phone and o.shop_id = '00000000-0000-0000-0000-0000000000b2'
$$;
create or replace function pg_temp.stock()
returns numeric language sql as $$
  select p.stock_qty from public.products p where p.id = '00000000-0000-0000-0000-0000000000d1'
$$;
create or replace function pg_temp.set_status(p_id uuid, p_status text)
returns text language plpgsql as $$
begin
  perform public.set_store_order_status(p_id, p_status);
  return 'ok';
exception when others then
  return sqlerrm;
end
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

do $$
declare
  v text; v2 text; s text; r jsonb;
  a uuid; c uuid; e uuid; h uuid;
  shop uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  -- C27: an order of 2 takes 2 out of stock, and the order is marked as holding it
  v := pg_temp.try_place(2, '9800000001');
  a := pg_temp.order_id('9800000001');
  insert into store_check_results values ('C27',
    v = 'ok' and pg_temp.stock() = 8 and (select o.stock_taken from public.store_orders o where o.id = a),
    'order of 2 kg: result ' || v || ', stock now ' || pg_temp.stock());

  -- C28: more than the stock left is refused, nothing is saved and stock does not change
  v := pg_temp.try_place(9, '9800000002');
  insert into store_check_results values ('C28',
    v = 'Only 8 kg of Stock Item is left. Please lower the quantity.' and pg_temp.stock() = 8
      and pg_temp.order_id('9800000002') is null,
    'refused: ' || v || '; stock ' || pg_temp.stock());

  -- C29: taking the last of the stock works, and the next order is refused (stock never below zero)
  v := pg_temp.try_place(8, '9800000003');
  c := pg_temp.order_id('9800000003');
  s := pg_temp.try_place(1, '9800000004');
  insert into store_check_results values ('C29',
    v = 'ok' and pg_temp.stock() = 0 and s = 'Stock Item is out of stock. Please remove it from your order.'
      and pg_temp.order_id('9800000004') is null,
    'stock ' || pg_temp.stock() || '; next order: ' || s);

  -- C30: the owner cancels order A, and its 2 kg go back
  v := pg_temp.set_status(a, 'cancelled');
  insert into store_check_results values ('C30',
    v = 'ok' and pg_temp.stock() = 2 and not (select o.stock_taken from public.store_orders o where o.id = a),
    'cancel result ' || v || '; stock now ' || pg_temp.stock());

  -- C31: cancelling again, or putting back again, does not add stock twice
  v := pg_temp.set_status(a, 'cancelled');
  perform public._store_put_back(a);
  insert into store_check_results values ('C31', v = 'ok' and pg_temp.stock() = 2,
    'stock after repeat cancel and put-back: ' || pg_temp.stock());

  -- C32: a reopen is refused while the stock is not there, and the order stays cancelled
  e := null;
  v := pg_temp.try_place(2, '9800000005');
  e := pg_temp.order_id('9800000005');
  s := pg_temp.set_status(a, 'new');
  insert into store_check_results values ('C32',
    v = 'ok' and s = 'Stock Item is out of stock. Please remove it from your order.'
      and pg_temp.stock() = 0 and (select o.status from public.store_orders o where o.id = a) = 'cancelled',
    'reopen refused: ' || s || '; stock ' || pg_temp.stock());

  -- C33: cancel the other order (its 2 kg go back), then reopen A, which takes its 2 kg again
  v := pg_temp.set_status(e, 'cancelled');
  v2 := pg_temp.set_status(a, 'new');
  insert into store_check_results values ('C33',
    v = 'ok' and v2 = 'ok' and pg_temp.stock() = 0 and (select o.stock_taken from public.store_orders o where o.id = a),
    'reopen result ' || v2 || '; stock now ' || pg_temp.stock());

  -- C34: taking again for an order that already holds its stock does nothing
  perform public._store_take(a);
  insert into store_check_results values ('C34', pg_temp.stock() = 0,
    'stock after repeat take: ' || pg_temp.stock());

  -- C35: the owner cancels a delivered order, and its stock comes back
  s := pg_temp.set_status(a, 'accepted');
  s := pg_temp.set_status(a, 'packed');
  s := pg_temp.set_status(a, 'delivered');
  v := pg_temp.set_status(a, 'cancelled');
  insert into store_check_results values ('C35', v = 'ok' and pg_temp.stock() = 2,
    'cancel from delivered: ' || v || '; stock now ' || pg_temp.stock());

  -- C36: owner bulk cancel of the new orders puts all their stock back
  v := pg_temp.try_place(1, '9800000006');
  v2 := pg_temp.try_place(1, '9800000007');
  r := public.cancel_new_store_orders(shop);
  insert into store_check_results values ('C36',
    v = 'ok' and v2 = 'ok' and (r->>'cancelled')::int = 3 and pg_temp.stock() = 10,
    'bulk cancelled ' || (r->>'cancelled') || '; stock now ' || pg_temp.stock());

  -- C37: stock = starting stock less what open orders hold, every order's flag matches its status, and no negatives
  insert into store_check_results values ('C37',
    pg_temp.stock() = 10 - coalesce((select sum(i.qty) from public.store_order_items i
                                       join public.store_orders o on o.id = i.order_id
                                      where o.shop_id = shop and o.status <> 'cancelled'), 0)
    and (select bool_and(o.stock_taken = (o.status <> 'cancelled')) from public.store_orders o where o.shop_id = shop)
    and pg_temp.stock() >= 0,
    'stock ' || pg_temp.stock() || ' matches open orders; flags match statuses');

  -- C38: backstop: an order saved with more than the stock left is refused when its stock is taken
  insert into public.store_orders (shop_id, customer_name, customer_phone, status, item_count, total)
    values (shop, 'Forced Buyer', '9800000099', 'new', 1, 120) returning id into h;
  insert into public.store_order_items (order_id, product_id, name, unit, price, qty, line_total)
    values (h, '00000000-0000-0000-0000-0000000000d1', 'Stock Item', 'kg', 10, 12, 120);
  s := 'no error';
  begin
    perform public._store_take(h);
  exception when others then
    s := sqlerrm;
  end;
  insert into store_check_results values ('C38',
    s = 'Only 10 kg of Stock Item is left. Please lower the quantity.' and pg_temp.stock() = 10
      and not (select o.stock_taken from public.store_orders o where o.id = h),
    'backstop: ' || s || '; stock ' || pg_temp.stock());
end $$;

-- ---------- C39 to C46: customers track an order (stage 7) ----------
-- Uses the order placed in C09 (Test Shop, phone 9000000012). The rate-limit check (C46) runs last.
insert into store_check_results
select 'C39',
  has_function_privilege('anon', 'public.track_store_order(text,text,text)', 'execute')
    and not has_table_privilege('anon', 'public.store_track_log', 'select')
    and not has_table_privilege('authenticated', 'public.store_track_log', 'select')
    and (select c.relrowsecurity from pg_class c where c.oid = 'public.store_track_log'::regclass),
  'anon can run the tracking function; the try log is closed to the API';

do $$
declare
  shop_b1 constant uuid := '00000000-0000-0000-0000-0000000000b1';
  ref12 text; orig text;
  rok jsonb; r jsonb; r2 jsonb; r3 jsonb;
  k text[];
  n_ok int := 0; n_lim int := 0; other int := 0; bad int := 0; i int;
begin
  select upper(substr(md5(o.id::text), 1, 6)) into ref12
    from public.store_orders o where o.shop_id = shop_b1 and o.customer_phone = '9000000012';

  select o.status into orig from public.store_orders o where o.shop_id = shop_b1 and o.customer_phone = '9000000012';

  -- C40: the right reference and phone give the status the order really has
  rok := public.track_store_order('test-shop-1', ref12, '+91 90000 00012');
  insert into store_check_results values ('C40',
    rok->>'ok' = 'true' and rok->>'status' = orig and rok->>'ref' = ref12,
    'right ref and phone: ' || rok::text || ' (saved status ' || orig || ')');

  -- C41: a wrong phone, a wrong ref and an unknown store all get the same plain no
  r  := public.track_store_order('test-shop-1', ref12, '9000000099');
  r2 := public.track_store_order('test-shop-1', 'ZZZZZZ', '9000000012');
  r3 := public.track_store_order('no-such-shop', ref12, '9000000012');
  insert into store_check_results values ('C41',
    r = '{"ok": false}'::jsonb and r2 = '{"ok": false}'::jsonb and r3 = '{"ok": false}'::jsonb,
    'wrong phone: ' || r::text || '; wrong ref: ' || r2::text || '; unknown store: ' || r3::text);

  -- C42: a match returns only the reference and the status, no name, phone, items or total
  select array_agg(x order by x) into k from jsonb_object_keys(rok) x;
  insert into store_check_results values ('C42',
    k = array['ok', 'ref', 'status'] and rok::text not like '%Test Buyer%' and rok::text not like '%9000000012%',
    'keys: ' || array_to_string(k, ', '));

  -- C43: the try log keeps only hashed phone keys, never the number
  insert into store_check_results values ('C43',
    (select count(*) from public.store_track_log) > 0
      and (select bool_and(length(phone_key) = 32 and phone_key ~ '^[0-9a-f]+$') from public.store_track_log),
    'log rows are hashed phone keys');

  -- C44: a closed store gives the same plain no, and is open again afterwards
  update public.shops set store_enabled = false where id = shop_b1;
  r := public.track_store_order('test-shop-1', ref12, '9000000012');
  update public.shops set store_enabled = true where id = shop_b1;
  insert into store_check_results values ('C44',
    r = '{"ok": false}'::jsonb and (select store_enabled from public.shops where id = shop_b1),
    'closed store: ' || r::text);

  -- C45: a status change shows up in the tracking reply
  update public.store_orders set status = 'packed' where shop_id = shop_b1 and customer_phone = '9000000012';
  r := public.track_store_order('test-shop-1', ref12, '9000000012');
  insert into store_check_results values ('C45', r->>'status' = 'packed', 'after packing: ' || coalesce(r->>'status', 'none'));
  update public.store_orders set status = orig where shop_id = shop_b1 and customer_phone = '9000000012';

  -- C46: more than 10 tries from one phone in 15 minutes are refused, and a refusal shows no status
  for i in 1..15 loop
    r := public.track_store_order('test-shop-1', ref12, '9000000012');
    if r->>'limited' = 'true' then
      n_lim := n_lim + 1;
      if r->>'status' is not null then bad := bad + 1; end if;
    elsif r->>'ok' = 'true' then
      n_ok := n_ok + 1;
    else
      other := other + 1;
    end if;
  end loop;
  insert into store_check_results values ('C46',
    n_lim >= 1 and n_ok <= 10 and other = 0 and bad = 0 and n_ok + n_lim = 15,
    'matched ' || n_ok || ', refused ' || n_lim || ', other ' || other || ', refusals showing a status ' || bad);
end $$;

select id, ok, detail from store_check_results order by id;
