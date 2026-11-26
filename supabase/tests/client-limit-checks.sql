-- Per-connection limit and default-privilege checks (stage 10, patch-12). SCRATCH DATABASE ONLY.
-- Run by supabase/tests/run-checks.cjs after store-checks.sql, on the test shop 'test-shop-1'.
-- Each row: id, ok (true = passed), detail. Phones used here start with 920000 and 930000 (test numbers).

create temp table if not exists client_check_results (id text primary key, ok boolean, detail text);

-- ---------- K01: the public role has no rights on the new functions or the log ----------
insert into client_check_results
select 'K01',
  not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = to_regprocedure('public.place_store_order_for_client(text,text,text,text,jsonb,text)')
                 and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where p.oid = to_regprocedure('public.track_store_order_for_client(text,text,text,text)')
                 and a.grantee = 0 and a.privilege_type = 'EXECUTE')
  and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
               where c.oid = 'public.store_client_log'::regclass and a.grantee = 0),
  'the public role cannot run the new functions or read the log';

-- ---------- K02: the new functions exist and have the right rights; the log is closed ----------
insert into client_check_results
select 'K02',
  to_regprocedure('public.place_store_order_for_client(text,text,text,text,jsonb,text)') is not null
  and to_regprocedure('public.track_store_order_for_client(text,text,text,text)') is not null
  and has_function_privilege('anon', 'public.place_store_order_for_client(text,text,text,text,jsonb,text)', 'execute')
  and has_function_privilege('anon', 'public.track_store_order_for_client(text,text,text,text)', 'execute')
  and not has_table_privilege('anon', 'public.store_client_log', 'select')
  and not has_table_privilege('authenticated', 'public.store_client_log', 'select')
  and (select relrowsecurity from pg_class where oid = 'public.store_client_log'::regclass),
  'new functions exist; anon can run them; the limit log is closed to the API';

-- ---------- K03: 25 orders from one connection go through; the 26th is refused ----------
do $$
declare i int; v_ok int := 0; v_msg text := 'no error'; v_before int; v_after int;
begin
  for i in 1..25 loop
    perform public.place_store_order_for_client('test-shop-1', 'Key Buyer', '920000' || lpad(i::text, 4, '0'), null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), 'key-a');
    v_ok := v_ok + 1;
  end loop;
  select count(*) into v_before from public.store_orders where customer_phone = '9200000026';
  begin
    perform public.place_store_order_for_client('test-shop-1', 'Key Buyer', '9200000026', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), 'key-a');
  exception when others then v_msg := sqlerrm;
  end;
  select count(*) into v_after from public.store_orders where customer_phone = '9200000026';
  insert into client_check_results values ('K03',
    v_ok = 25 and v_msg like 'Too many orders from this connection%' and v_before = 0 and v_after = 0,
    'placed ' || v_ok || '; 26th: ' || v_msg || '; refused order saved: ' || v_after);
end $$;

-- ---------- K04: another connection is not held back by the first one ----------
insert into client_check_results
select 'K04', (public.place_store_order_for_client('test-shop-1', 'Other Connection', '9200009001', null,
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), 'key-b')->>'ok') = 'true',
  'a different connection can still place an order';

-- ---------- K05: no connection code means the order is not counted against any connection ----------
insert into client_check_results
select 'K05', (public.place_store_order_for_client('test-shop-1', 'No Code', '9200009002', null,
  jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), null)->>'ok') = 'true',
  'an order with no connection code still goes through';

-- ---------- K06: an unknown store gets the same answer as the old function ----------
do $$
declare v_old text := 'no error'; v_new text := 'no error';
begin
  begin
    perform public.place_store_order('no-such-store', 'X', '9200009003', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
  exception when others then v_old := sqlerrm;
  end;
  begin
    perform public.place_store_order_for_client('no-such-store', 'X', '9200009003', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')), 'key-c');
  exception when others then v_new := sqlerrm;
  end;
  insert into client_check_results values ('K06', v_old = v_new and v_old <> 'no error',
    'unknown store: same answer as before (' || v_new || ')');
end $$;

-- ---------- K07: tracking allows 30 tries from one connection, then says wait ----------
do $$
declare i int; v_limited_before int := 0; v_last jsonb; v_refusal_text text;
begin
  for i in 1..30 loop
    v_last := public.track_store_order_for_client('test-shop-1', 'ZZZZZZ', '930000' || lpad(i::text, 4, '0'), 'track-a');
    if coalesce((v_last->>'limited')::boolean, false) then v_limited_before := v_limited_before + 1; end if;
  end loop;
  v_last := public.track_store_order_for_client('test-shop-1', 'ZZZZZZ', '9300009031', 'track-a');
  v_refusal_text := v_last->>'message';
  insert into client_check_results values ('K07',
    v_limited_before = 0 and (v_last->>'limited')::boolean = true and v_refusal_text like 'Too many tries%',
    'tries 1 to 30 not limited; try 31 refused: ' || coalesce(v_refusal_text, 'no message'));
end $$;

-- ---------- K08: tracking with the right reference and phone still answers, for another connection ----------
insert into client_check_results
select 'K08', (public.track_store_order_for_client('test-shop-1',
    (select upper(substr(md5(o.id::text), 1, 6)) from public.store_orders o where o.customer_phone = '9200000001' limit 1),
    '9200000001', 'track-b')->>'ok') = 'true'
  and (public.track_store_order_for_client('test-shop-1', 'ZZZZZZ', '9200000001', 'track-b')->>'status') is null,
  'a right reference and phone still shows the status for another connection; a wrong one shows nothing';

-- ---------- K09: the old tracking function still works (used as the fallback) ----------
insert into client_check_results
select 'K09', (public.track_store_order('test-shop-1', 'ZZZZZZ', '9200000001')->>'ok') = 'false'
  and not coalesce((public.track_store_order('test-shop-1', 'ZZZZZZ', '9200000001')->>'limited')::boolean, false),
  'the old tracking function still answers';

select id, ok, detail from client_check_results order by id;
