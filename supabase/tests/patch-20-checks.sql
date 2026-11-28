-- patch-20 checks: the whole-shop caps are gone; the per phone and per connection limits still hold (stage 12).
-- SCRATCH DATABASE ONLY. Run by supabase/tests/run-checks.cjs as the last step.
-- Each row: id, ok (true = passed), detail. Phones used here start with 9500 (test numbers).
-- The filler orders and tracking rows are test data; they are removed at the end where possible.

create temp table if not exists p20_results (id text primary key, ok boolean, detail text);

-- ---------- C01: the function text has no whole-shop cap ----------
insert into p20_results
select 'C01',
  pg_get_functiondef('public.place_store_order(text,text,text,text,jsonb)'::regprocedure) not like '%busy%'
  and pg_get_functiondef('public.place_store_order(text,text,text,text,jsonb)'::regprocedure) not like '%>= 300%',
  'place_store_order has no whole-shop 300 cap or busy message';

-- ---------- C02: the tracking function has no whole-shop cap but keeps the per phone limit ----------
insert into p20_results
select 'C02',
  pg_get_functiondef('public.track_store_order(text,text,text)'::regprocedure) not like '%v_by_shop%'
  and pg_get_functiondef('public.track_store_order(text,text,text)'::regprocedure) like '%v_by_phone > 10%',
  'track_store_order has no whole-shop count and keeps the 10-per-phone limit';

-- ---------- C03: with 300 orders already in the hour, a new customer order is still saved ----------
do $$
declare v_res jsonb; v_msg text := 'no error'; v_saved int := 0; v_stock numeric;
begin
  insert into public.store_orders (shop_id, customer_name, customer_phone, note)
  select s.id, 'P20 filler', '9500' || lpad(g::text, 6, '0'), 'p20-filler'
    from public.shops s, generate_series(1, 300) g
   where s.store_slug = 'test-shop-1';
  select stock_qty into v_stock from public.products where id = '00000000-0000-0000-0000-0000000000c2';
  update public.products set stock_qty = 100 where id = '00000000-0000-0000-0000-0000000000c2';
  begin
    v_res := public.place_store_order('test-shop-1', 'P20 Visitor', '9500999001', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
  exception when others then
    v_msg := sqlerrm;
  end;
  select count(*) into v_saved from public.store_orders where customer_phone = '9500999001';
  insert into p20_results values ('C03', v_msg = 'no error' and v_saved = 1,
    'with 300 orders already in the hour, a new customer order is still saved (' || v_msg || ')');
  -- restore the stock the test set, and remove the test order and its items
  update public.products set stock_qty = coalesce(v_stock, 0) where id = '00000000-0000-0000-0000-0000000000c2';
  delete from public.store_order_items where order_id in (select id from public.store_orders where customer_phone = '9500999001');
  delete from public.store_orders where customer_phone = '9500999001';
end $$;

-- ---------- C04: with 300 tracking tries already in the hour, a new phone is not refused as "limited" ----------
do $$
declare v_res jsonb;
begin
  insert into public.store_track_log (shop_id, phone_key)
  select s.id, md5('p20-' || g::text)
    from public.shops s, generate_series(1, 300) g
   where s.store_slug = 'test-shop-1';
  v_res := public.track_store_order('test-shop-1', 'ZZZZZZ', '9500999002');
  insert into p20_results values ('C04', coalesce((v_res->>'limited')::boolean, false) = false,
    'a new phone is not refused when the shop had 300 tracking tries in the hour');
end $$;

-- ---------- C05: the per phone tracking limit still works: the 11th try from one phone is refused ----------
do $$
declare i int; v_limited int := 0; v_last jsonb;
begin
  for i in 1..11 loop
    v_last := public.track_store_order('test-shop-1', 'ZZZZZZ', '9500999003');
    if coalesce((v_last->>'limited')::boolean, false) then v_limited := v_limited + 1; end if;
  end loop;
  insert into p20_results values ('C05', v_limited = 1,
    'the 11th tracking try from one phone is refused (refused tries: ' || v_limited || ')');
end $$;

-- ---------- C06: the per connection limits from patch-12 and patch-13 are untouched ----------
insert into p20_results
select 'C06',
  pg_get_functiondef('public.place_store_order_for_client(text,text,text,text,jsonb,text)'::regprocedure) like '%v_recent >= 10%'
  and pg_get_functiondef('public.track_store_order_for_client(text,text,text,text)'::regprocedure) like '%v_recent >= 10%',
  'the per connection order and tracking limits still read 10 in the database';

-- ---------- cleanup of the filler rows ----------
delete from public.store_orders where note = 'p20-filler';
delete from public.store_track_log where tried_at > now() - interval '1 hour'
   and shop_id = (select id from public.shops where store_slug = 'test-shop-1');

select id, ok, detail from p20_results order by id;
