-- Plan checks (stage 11, patch-14). SCRATCH DATABASE ONLY: creates test users and shops.
-- Run by supabase/tests/run-checks.cjs after patch-14.sql. Uses its own shops: ...f2 (Free, the default) and ...f3 (Growth).
-- Each row: id, ok (true = passed), detail.

create temp table if not exists plan_check_results (id text primary key, ok boolean, detail text);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'plan-owner@test.local'),
  ('00000000-0000-0000-0000-0000000000f5', 'plan-cashier@test.local')
on conflict (id) do nothing;

insert into public.shops (id, name, phone, city, lang) values
  ('00000000-0000-0000-0000-0000000000f2', 'Free Shop', '9840000002', 'Jaipur', 'en')
on conflict (id) do nothing;

insert into public.shops (id, name, phone, city, lang, plan, store_enabled, store_slug) values
  ('00000000-0000-0000-0000-0000000000f3', 'Growth Shop', '9840000003', 'Jaipur', 'en', 'growth', true, 'plan-growth-shop')
on conflict (id) do nothing;

insert into public.staff (shop_id, auth_user_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'Owner', 'plan-owner@test.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f5', 'Cashier', 'plan-cashier@test.local', 'cashier');

-- ---------- P01: the three plans have the agreed limits ----------
insert into plan_check_results
select 'P01',
  (select bills_per_month = 30 and max_items = 50 and max_people = 2 and not online_store and not suppliers
          and not udhar_reminders and not voice and not full_reports from public.plans where code = 'free')
  and (select bills_per_month = 300 and max_items = 500 and max_people = 5 and online_store and suppliers
          and udhar_reminders and not voice and full_reports from public.plans where code = 'growth')
  and (select bills_per_month is null and max_items is null and max_people is null and online_store and suppliers
          and udhar_reminders and voice and full_reports from public.plans where code = 'all'),
  'Free, Growth and All Features have the agreed limits';

-- ---------- P02: every shop has a valid plan, and new shops default to Free ----------
insert into plan_check_results
select 'P02',
  (select count(*) from public.shops s where s.plan not in (select code from public.plans)) = 0
  and (select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'shops' and column_name = 'plan') like '%free%',
  'every shop has a known plan; the default for new shops is free';

-- ---------- P03: the 30th bill of the month is saved (29 saved directly, then one through the normal sale) ----------
insert into public.products (shop_id, name, sell_price, buy_price, stock_qty) values
  ('00000000-0000-0000-0000-0000000000f2', 'Test Atta', 40, 30, 1000);

insert into public.bills (shop_id, bill_no, total, payment_mode)
select '00000000-0000-0000-0000-0000000000f2', g, 40, 'cash' from generate_series(1, 29) g;

do $$
declare v_msg text := 'no error';
        v_pid uuid;
begin
  select id into v_pid from public.products where shop_id = '00000000-0000-0000-0000-0000000000f2' and name = 'Test Atta';
  perform set_config('test.plan_pid', v_pid::text, false);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
  begin
    perform public.create_sale('00000000-0000-0000-0000-0000000000f2',
      jsonb_build_array(jsonb_build_object('product_id', v_pid, 'name', 'Test Atta', 'price', 40, 'qty', 1)),
      0, 'cash', null, 40, null, null, false);
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P03',
    v_msg = 'no error' and public._bills_in_month('00000000-0000-0000-0000-0000000000f2', public._ist_today()) = 30,
    'the 30th bill of the month is saved: ' || v_msg);
end $$;

-- ---------- P04: the 31st bill of the month is refused ----------
do $$
declare v_msg text := 'no error';
        v_pid uuid := current_setting('test.plan_pid')::uuid;
begin
  begin
    perform public.create_sale('00000000-0000-0000-0000-0000000000f2',
      jsonb_build_array(jsonb_build_object('product_id', v_pid, 'name', 'Test Atta', 'price', 40, 'qty', 1)),
      0, 'cash', null, 40, null, null, false);
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P04', v_msg like '%used up%', 'the 31st bill is refused: ' || v_msg);
end $$;

-- ---------- P05: a deleted bill does not count, so one more sale fits again ----------
do $$
declare v_msg text := 'no error';
        v_pid uuid := current_setting('test.plan_pid')::uuid;
        v_before int;
begin
  update public.bills set deleted_at = now()
   where shop_id = '00000000-0000-0000-0000-0000000000f2' and bill_no = 1;
  v_before := public._bills_in_month('00000000-0000-0000-0000-0000000000f2', public._ist_today());
  begin
    perform public.create_sale('00000000-0000-0000-0000-0000000000f2',
      jsonb_build_array(jsonb_build_object('product_id', v_pid, 'name', 'Test Atta', 'price', 40, 'qty', 1)),
      0, 'cash', null, 40, null, null, false);
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P05',
    v_before = 29 and v_msg = 'no error',
    'a deleted bill is not counted (count ' || v_before || '), and a sale after it is saved: ' || v_msg);
end $$;

-- ---------- P06: the item limit (50 on Free) ----------
insert into public.products (shop_id, name, sell_price, buy_price, stock_qty)
select '00000000-0000-0000-0000-0000000000f2', 'Item ' || g, 10, 5, 10 from generate_series(1, 49) g;

do $$
declare v_msg text := 'no error';
begin
  begin
    insert into public.products (shop_id, name, sell_price, buy_price, stock_qty)
      values ('00000000-0000-0000-0000-0000000000f2', 'One Too Many', 10, 5, 10);
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P06', v_msg like '%allows 50 items%',
    'the 51st item is refused on Free: ' || v_msg);
end $$;

-- ---------- P07: the people limit (2 on Free, the owner and one cashier are already in) ----------
do $$
declare v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
  begin
    perform public.invite_staff('00000000-0000-0000-0000-0000000000f2', 'New Helper', 'helper@test.local', 'cashier');
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P07', v_msg like '%allows 2 people%',
    'a third person is refused on Free: ' || v_msg);
end $$;

-- ---------- P08: the online store is refused on Free ----------
do $$
declare v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
  begin
    update public.shops set store_enabled = true, store_slug = 'free-shop-test'
     where id = '00000000-0000-0000-0000-0000000000f2';
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P08', v_msg like '%not on your plan%',
    'the online store is refused on Free: ' || v_msg);
end $$;

-- ---------- P09: suppliers are refused on Free, and allowed on Growth ----------
do $$
declare v_msg text := 'no error';
begin
  begin
    insert into public.suppliers (shop_id, name) values ('00000000-0000-0000-0000-0000000000f2', 'Ram Traders');
  exception when others then v_msg := sqlerrm;
  end;
  insert into public.suppliers (shop_id, name) values ('00000000-0000-0000-0000-0000000000f3', 'Growth Supplier');
  insert into plan_check_results values ('P09',
    v_msg like '%Suppliers are not on your%'
      and exists (select 1 from public.suppliers where shop_id = '00000000-0000-0000-0000-0000000000f3' and name = 'Growth Supplier'),
    'suppliers are refused on Free and saved on Growth: ' || v_msg);
end $$;

-- ---------- P10: the owner cannot change the plan through the app ----------
do $$
declare v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
  begin
    update public.shops set plan = 'all' where id = '00000000-0000-0000-0000-0000000000f2';
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P10',
    v_msg like 'Only BizGrow can change the plan%'
      and (select plan from public.shops where id = '00000000-0000-0000-0000-0000000000f2') = 'free',
    'the owner cannot change the plan: ' || v_msg);
end $$;

-- ---------- P11: asking for an upgrade is owner-only and repeat asks do not pile up ----------
do $$
declare v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
  perform public.request_plan_upgrade('00000000-0000-0000-0000-0000000000f2', 'growth');
  perform public.request_plan_upgrade('00000000-0000-0000-0000-0000000000f2', 'growth');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f5', false);
  begin
    perform public.request_plan_upgrade('00000000-0000-0000-0000-0000000000f2', 'all');
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P11',
    (select count(*) from public.plan_requests
      where shop_id = '00000000-0000-0000-0000-0000000000f2' and status = 'new' and to_plan = 'growth') = 1
    and v_msg like 'Only the owner%',
    'owner ask recorded once; cashier refused: ' || v_msg);
end $$;

-- ---------- P12: asking for the plan you already have is refused, and the plan did not change ----------
do $$
declare v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
  begin
    perform public.request_plan_upgrade('00000000-0000-0000-0000-0000000000f2', 'free');
  exception when others then v_msg := sqlerrm;
  end;
  insert into plan_check_results values ('P12',
    v_msg like 'That is already your plan%'
      and (select plan from public.shops where id = '00000000-0000-0000-0000-0000000000f2') = 'free',
    'same-plan ask is refused and the plan is still free: ' || v_msg);
end $$;

-- ---------- P13: the Plans screen data for the owner ----------
do $$
declare v jsonb;
        v_plans jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
  v := public.get_my_plan('00000000-0000-0000-0000-0000000000f2');
  v_plans := public.get_plans();
  insert into plan_check_results values ('P13',
    v->>'code' = 'free'
      and (v->'usage'->>'bills')::int = 30
      and (v->'usage'->>'items')::int = 50
      and (v->'usage'->>'people')::int = 2
      and v->'requested'->>'to_plan' = 'growth'
      and jsonb_array_length(v_plans) = 3
      and v_plans->0->>'code' = 'free' and v_plans->2->>'code' = 'all',
    'my plan shows usage (30 bills, 50 items, 2 people), the open request, and all three plans');
end $$;

-- ---------- P14: anon cannot run the plan functions; signed-in users can; requests cannot be written directly ----------
insert into plan_check_results
select 'P14',
  not has_function_privilege('anon', 'public.get_plans()', 'execute')
  and not has_function_privilege('anon', 'public.get_my_plan(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.request_plan_upgrade(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_plans()', 'execute')
  and has_function_privilege('authenticated', 'public.get_my_plan(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.request_plan_upgrade(uuid,text)', 'execute')
  and not has_table_privilege('authenticated', 'public.plan_requests', 'insert')
  and not has_table_privilege('anon', 'public.plan_requests', 'select'),
  'anon cannot run the plan functions; signed-in users can; requests are read-only for them';

-- ---------- P15: the Growth shop can use the online store (set on insert) ----------
insert into plan_check_results
select 'P15',
  (select store_enabled from public.shops where id = '00000000-0000-0000-0000-0000000000f3')
  and (select plan from public.shops where id = '00000000-0000-0000-0000-0000000000f3') = 'growth',
  'a Growth shop can have the online store on';

select id, ok, detail from plan_check_results order by id;
