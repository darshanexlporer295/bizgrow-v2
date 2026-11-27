-- patch-13 checks: tighter per-visitor limits, the connection code required, and no default public rights (stage 11).
-- SCRATCH DATABASE ONLY. Run by supabase/tests/run-checks.cjs after client-limit-checks.sql.
-- Each row: id, ok (true = passed), detail. Visitor codes here start with "p13-" (test codes, not real ones).
-- Phones used here start with 940000 (test numbers).

create temp table if not exists p13_results (id text primary key, ok boolean, detail text);

-- ---------- P01: one visitor gets 10 saved orders an hour from a shop; the 11th is refused and not saved ----------
do $$
declare i int; v_ok int := 0; v_msg text := 'no error'; v_log int; v_saved int;
begin
  for i in 1..10 loop
    perform public.place_store_order_for_client('test-shop-1', 'Visitor X', '940000' || lpad(i::text, 4, '0'), null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), 'p13-x');
    v_ok := v_ok + 1;
  end loop;
  begin
    perform public.place_store_order_for_client('test-shop-1', 'Visitor X', '9400009011', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), 'p13-x');
  exception when others then v_msg := sqlerrm;
  end;
  select count(*) into v_log from public.store_client_log where client_key = 'p13-x' and kind = 'order';
  select count(*) into v_saved from public.store_orders where customer_phone = '9400009011';
  insert into p13_results values ('P01',
    v_ok = 10 and v_msg like 'Too many orders from you%' and v_log = 10 and v_saved = 0,
    'placed ' || v_ok || '; 11th: ' || v_msg || '; counted: ' || v_log || '; 11th saved: ' || v_saved);
end $$;

-- ---------- P02: the same visitor's limit does not hold back another visitor in the same shop ----------
insert into p13_results
select 'P02', (public.place_store_order_for_client('test-shop-1', 'Visitor Y', '9400009021', null,
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), 'p13-y')->>'ok') = 'true',
  'a second visitor can still order after the first one hit the limit';

-- ---------- P03: one visitor cannot use up the whole shop's cap; the 300-an-hour cap is still in place ----------
insert into p13_results
select 'P03',
  (select count(*) from public.store_client_log where client_key = 'p13-x' and kind = 'order' and tried_at > now() - interval '1 hour') = 10
  and (select count(*) from public.store_orders o join public.shops s on s.id = o.shop_id
        where s.store_slug = 'test-shop-1' and o.created_at > now() - interval '1 hour') < 300
  and pg_get_functiondef('public.place_store_order(text,text,text,text,jsonb)'::regprocedure) like '%v_recent >= 300%',
  'one visitor used 10 of the shop''s hourly orders; the shop-wide 300 cap is still in the database function';

-- ---------- P04: tracking: 10 tries in 15 minutes, the 11th is refused; every try counts ----------
do $$
declare i int; v_limited int := 0; v_last jsonb; v_log int;
begin
  for i in 1..10 loop
    v_last := public.track_store_order_for_client('test-shop-1', 'ZZZZZZ', '940000' || lpad(i::text, 4, '0'), 'p13-t');
    if coalesce((v_last->>'limited')::boolean, false) then v_limited := v_limited + 1; end if;
  end loop;
  v_last := public.track_store_order_for_client('test-shop-1', 'ZZZZZZ', '9400009041', 'p13-t');
  select count(*) into v_log from public.store_client_log where client_key = 'p13-t' and kind = 'track';
  insert into p13_results values ('P04',
    v_limited = 0 and (v_last->>'limited')::boolean = true and v_log = 11,
    'tries 1 to 10 not limited (' || v_limited || ' limited); try 11: ' || coalesce(v_last->>'message', 'no message') || '; counted tries: ' || v_log);
end $$;

-- ---------- P05: tracking still works for another visitor who has the right reference and phone ----------
insert into p13_results
select 'P05', (public.track_store_order_for_client('test-shop-1',
    (select upper(substr(md5(o.id::text), 1, 6)) from public.store_orders o where o.customer_phone = '9400009021' limit 1),
    '9400009021', 'p13-z')->>'ok') = 'true',
  'another visitor with the right reference and phone still sees the order';

-- ---------- P06: no connection code is refused for orders and for tracking; nothing is counted ----------
do $$
declare v_o text := 'no error'; v_t text := 'no error'; v_saved int; v_logged int;
begin
  begin
    perform public.place_store_order_for_client('test-shop-1', 'No Code', '9400009051', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), '   ');
  exception when others then v_o := sqlerrm;
  end;
  begin
    perform public.track_store_order_for_client('test-shop-1', 'ZZZZZZ', '9400009051', null);
  exception when others then v_t := sqlerrm;
  end;
  select count(*) into v_saved from public.store_orders where customer_phone = '9400009051';
  select count(*) into v_logged from public.store_client_log where client_key is null or client_key = '';
  insert into p13_results values ('P06',
    v_o = 'Please try again in a moment.' and v_t = 'Please try again in a moment.' and v_saved = 0 and v_logged = 0,
    'order: ' || v_o || '; track: ' || v_t || '; saved: ' || v_saved || '; empty-code log rows: ' || v_logged);
end $$;

-- ---------- P07: the limit is per shop: the same visitor can still order from another open shop ----------
do $$
declare v_pid uuid; v_res text := 'no shop';
begin
  select p.id into v_pid from public.products p join public.shops s on s.id = p.shop_id
   where s.store_slug = 'stock-shop-2' and p.id is not null order by p.name limit 1;
  if v_pid is null then
    insert into p13_results values ('P07', false, 'no product in the second shop to test with');
  else
    begin
      v_res := (public.place_store_order_for_client('stock-shop-2', 'Visitor X', '9400009061', null,
        jsonb_build_array(jsonb_build_object('product_id', v_pid, 'qty', '1')), 'p13-x'))->>'ok';
    exception when others then v_res := sqlerrm;
    end;
    insert into p13_results values ('P07', v_res = 'true',
      'visitor X, blocked at test-shop-1, ordering from stock-shop-2: ' || v_res);
  end if;
end $$;

-- ---------- P08: default rights: a new table or function is not open to the public (anon) role ----------
create table public.zz_p13_probe (id int);
create function public.zz_p13_fn() returns int language sql as $$ select 1 $$;
insert into p13_results
select 'P08',
  not has_table_privilege('anon', 'public.zz_p13_probe', 'select')
  and not has_table_privilege('anon', 'public.zz_p13_probe', 'insert')
  and not has_function_privilege('anon', 'public.zz_p13_fn()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'public.zz_p13_fn()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   where c.oid = 'public.zz_p13_probe'::regclass and a.grantee = 0),
  'a new table and function in public are closed to anon and to the PUBLIC group';
drop function public.zz_p13_fn();
drop table public.zz_p13_probe;

-- ---------- P09: the new limits are the ones the page describes (10 orders, 10 tries) ----------
insert into p13_results
select 'P09',
  pg_get_functiondef('public.place_store_order_for_client(text,text,text,text,jsonb,text)'::regprocedure) like '%v_recent >= 10%'
  and pg_get_functiondef('public.track_store_order_for_client(text,text,text,text)'::regprocedure) like '%v_recent >= 10%',
  'both functions use the new limit of 10';

select id, ok, detail from p13_results order by id;
