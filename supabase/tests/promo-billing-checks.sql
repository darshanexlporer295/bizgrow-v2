-- promo codes, platform owner, and plan payments checks (patch-15). SCRATCH DATABASE ONLY.
-- Run by supabase/tests/run-promo-billing.cjs after patch-14.sql and patch-15.sql.
-- Each row: id, ok (true = passed), detail. Test ids and codes here start with "P15" (not real ones).

create temp table if not exists p15_results (id text primary key, ok boolean, detail text);
grant all on p15_results to authenticated;  -- the app-role tests write their result rows too

-- Test people and shops (fixed test ids).
insert into auth.users (id, email) values
  ('15000000-0000-0000-0000-000000000001', 'owner1@test.local'),
  ('15000000-0000-0000-0000-000000000002', 'owner2@test.local'),
  ('15000000-0000-0000-0000-000000000003', 'manager1@test.local'),
  ('15000000-0000-0000-0000-000000000004', 'platform@test.local')
on conflict (id) do nothing;
insert into public.shops (id, name) values
  ('15100000-0000-0000-0000-000000000001', 'P15 Shop One'),
  ('15100000-0000-0000-0000-000000000002', 'P15 Shop Two'),
  ('15100000-0000-0000-0000-000000000003', 'P15 Shop Three'),
  ('15100000-0000-0000-0000-000000000004', 'P15 Shop Four')
on conflict (id) do nothing;
insert into public.staff (shop_id, auth_user_id, name, role, active) values
  ('15100000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'Owner One', 'owner', true),
  ('15100000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000002', 'Owner Two', 'owner', true),
  ('15100000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000003', 'Manager One', 'manager', true),
  ('15100000-0000-0000-0000-000000000004', '15000000-0000-0000-0000-000000000001', 'Owner One', 'owner', true),
  ('15100000-0000-0000-0000-000000000003', '15000000-0000-0000-0000-000000000002', 'Owner Two', 'owner', true)
on conflict (shop_id, auth_user_id) do nothing;
insert into public.platform_admins (user_id) values ('15000000-0000-0000-0000-000000000004') on conflict do nothing;
-- Shop three starts on the top plan, so it cannot take a lower promo.
update public.shops set plan = 'all', plan_source = 'manual' where id = '15100000-0000-0000-0000-000000000003';

-- Promo codes made directly (as the database owner, like the SQL Editor).
insert into public.promo_codes (code, plan, duration_days, max_uses, active) values
  ('P15-FOREVER', 'growth', null, 3, true),
  ('P15-ONEUSE',  'growth', 30,   1, true),
  ('P15-OFF',     'growth', null, 5, false),
  ('P15-OLD',     'growth', null, 5, true);
update public.promo_codes set expires_at = now() - interval '1 day' where code = 'P15-OLD';

-- ---------- P01: a shop owner uses a permanent code; the plan changes and the count goes up ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', false);
do $$
declare r jsonb;
begin
  r := public.redeem_promo_code('15100000-0000-0000-0000-000000000001', 'P15-FOREVER');
  insert into p15_results values ('P01',
    (r->>'ok')::boolean and (select plan from public.shops where id = '15100000-0000-0000-0000-000000000001') = 'growth'
      and (select used_count from public.promo_codes where code = 'P15-FOREVER') = 1,
    'reply: ' || r::text);
end $$;

-- ---------- P02: the same shop cannot use the same code twice ----------
do $$
declare r jsonb;
begin
  r := public.redeem_promo_code('15100000-0000-0000-0000-000000000001', 'P15-FOREVER');
  insert into p15_results values ('P02', (r->>'ok')::boolean = false and (select used_count from public.promo_codes where code = 'P15-FOREVER') = 1,
    'reply: ' || r::text);
end $$;

-- ---------- P03: codes ignore capitals (typed in lower case, shop two uses it) ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', false);
do $$
declare r jsonb;
begin
  r := public.redeem_promo_code('15100000-0000-0000-0000-000000000002', ' p15-forever ');
  insert into p15_results values ('P03', (r->>'ok')::boolean = true and (select used_count from public.promo_codes where code = 'P15-FOREVER') = 2,
    'reply: ' || r::text);
end $$;

-- ---------- P04: the limit holds: a code with 1 use left is used up for the next shop ----------
-- Shop four is on the Free plan; shop one is already on Growth from P01.
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', false);
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := public.redeem_promo_code('15100000-0000-0000-0000-000000000004', 'P15-ONEUSE');
  r2 := public.redeem_promo_code('15100000-0000-0000-0000-000000000001', 'P15-ONEUSE');
  insert into p15_results values ('P04', (r1->>'ok')::boolean and (r2->>'ok')::boolean = false
      and (select used_count from public.promo_codes where code = 'P15-ONEUSE') = 1,
    'first: ' || r1::text || ' second: ' || r2::text);
end $$;

-- ---------- P05: a manager cannot use a code for the shop ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000003', false);
do $$
declare r jsonb; n0 int; n1 int;
begin
  select count(*) into n0 from public.promo_attempts where user_id = '15000000-0000-0000-0000-000000000003';
  r := public.redeem_promo_code('15100000-0000-0000-0000-000000000001', 'P15-FOREVER');
  select count(*) into n1 from public.promo_attempts where user_id = '15000000-0000-0000-0000-000000000003';
  -- A plain reply (not an error), and the try is still counted.
  insert into p15_results values ('P05', (r->>'ok')::boolean = false
      and r->>'message' = 'Only the shop owner can use a promo code.' and n1 = n0 + 1,
      'message: ' || coalesce(r->>'message', 'none') || ' counted: ' || (n1 - n0));
end $$;

-- ---------- P06: an switched-off code and an expired code are refused, with the same plain reply ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', false);
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := public.redeem_promo_code('15100000-0000-0000-0000-000000000002', 'P15-OFF');
  r2 := public.redeem_promo_code('15100000-0000-0000-0000-000000000002', 'P15-OLD');
  insert into p15_results values ('P06', (r1->>'ok')::boolean = false and (r2->>'ok')::boolean = false
      and r1->>'message' = r2->>'message', 'off: ' || r1::text || ' old: ' || r2::text);
end $$;

-- ---------- P07: a 30-day code ends: after the end time the shop goes back to its old plan ----------
-- Shop four got the 30-day code in P04 (its old plan was Free).
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', false);
do $$
declare v_until timestamptz; v_before text; v_after text;
begin
  select plan_until into v_until from public.shops where id = '15100000-0000-0000-0000-000000000004';
  v_before := (select p.code from public._plan_of('15100000-0000-0000-0000-000000000004') p);
  -- Pretend the 30 days are over (test only).
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan_until = now() - interval '1 minute' where id = '15100000-0000-0000-0000-000000000004';
  perform set_config('bizgrow.plan_change', 'off', true);
  v_after := (select p.code from public._plan_of('15100000-0000-0000-0000-000000000004') p);
  insert into p15_results values ('P07', v_until is not null and v_until > now() + interval '29 days'
      and v_until < now() + interval '31 days' and v_before = 'growth' and v_after = 'free',
    'until ' || coalesce(v_until::text, 'null') || ' before ' || v_before || ' after ' || v_after);
end $$;

-- ---------- P08: a shop already on All Features cannot take a lower plan code ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', false);
insert into public.promo_codes (code, plan, duration_days, max_uses, active) values ('P15-LOW', 'growth', 30, 5, true);
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', false);
do $$
declare r jsonb; v_used int;
begin
  r := public.redeem_promo_code('15100000-0000-0000-0000-000000000003', 'P15-LOW');
  select used_count into v_used from public.promo_codes where code = 'P15-LOW';
  insert into p15_results values ('P08', (r->>'ok')::boolean = false and v_used = 0 and r->>'message' like '%All Features%' and r->>'message' like '%for good%',
    'reply: ' || r::text);
end $$;

-- ---------- P09: guessing is limited: the 11th try in 15 minutes is refused and counted ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', false);
do $$
declare i int; r jsonb; v_last jsonb;
begin
  delete from public.promo_attempts where user_id = '15000000-0000-0000-0000-000000000002';
  for i in 1..10 loop
    r := public.redeem_promo_code('15100000-0000-0000-0000-000000000002', 'NOPE-' || i::text || '0000');
  end loop;
  v_last := public.redeem_promo_code('15100000-0000-0000-0000-000000000002', 'NOPE-11111');
  insert into p15_results values ('P09', (v_last->>'limited')::boolean = true
      and (select count(*) from public.promo_attempts where user_id = '15000000-0000-0000-0000-000000000002') = 10,
    'last: ' || v_last::text);
end $$;

-- ---------- P10: the plan guard refuses a plan change by a signed-in user; the app role cannot write shops ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', false);
do $$
declare v_msg text := 'no error';
begin
  begin
    update public.shops set plan = 'all' where id = '15100000-0000-0000-0000-000000000002';
  exception when others then v_msg := sqlerrm;
  end;
  insert into p15_results values ('P10a', v_msg like 'Only BizGrow can change the plan%', 'guard message: ' || v_msg);
end $$;
set local role authenticated;
do $$
declare v_msg text := 'no error';
begin
  begin
    update public.shops set plan = 'all' where id = '15100000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then v_msg := 'denied';
  end;
  insert into p15_results values ('P10b', v_msg in ('denied', 'Only BizGrow can change the plan. Ask for an upgrade instead.'),
    'app role tried plan change: ' || v_msg);
end $$;
reset role;

-- ---------- P11: a shop owner cannot read or write the code tables ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', false);
set local role authenticated;
do $$
declare v_msg text := 'no error';
begin
  begin
    perform 1 from public.promo_codes;
  exception when insufficient_privilege then v_msg := 'denied';
  end;
  insert into p15_results values ('P11', v_msg = 'denied', 'reading promo_codes: ' || v_msg);
end $$;
reset role;

-- ---------- P12: only the platform owner can create, list or switch off codes ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', false);
do $$
declare v_msg text := 'no error';
begin
  begin
    perform public.admin_create_promo('P15-SNEAK', 'growth', null, 5, null);
  exception when others then v_msg := sqlerrm;
  end;
  insert into p15_results values ('P12a', v_msg = 'Only the platform owner can do this.', 'owner tried: ' || v_msg);
end $$;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000004', false);
do $$
declare r jsonb; v_list jsonb;
begin
  r := public.admin_create_promo('P15-ADMIN1', 'growth', 14, 7, null);
  v_list := public.admin_list_promos();
  insert into p15_results values ('P12b', (r->>'ok')::boolean and (v_list::text like '%P15-ADMIN1%'),
    'create: ' || r::text);
  perform public.admin_set_promo_active((select id from public.promo_codes where code = 'P15-ADMIN1'), false);
  insert into p15_results values ('P12c', (select active from public.promo_codes where code = 'P15-ADMIN1') = false,
    'switched off');
end $$;

-- ---------- P13: a duplicate or badly typed code is refused ----------
do $$
declare v_dup text := 'no error'; v_bad text := 'no error';
begin
  begin perform public.admin_create_promo('p15-forever', 'growth', null, 5, null);
  exception when others then v_dup := sqlerrm; end;
  begin perform public.admin_create_promo('A', 'growth', null, 5, null);
  exception when others then v_bad := sqlerrm; end;
  insert into p15_results values ('P13', v_dup like 'That code already exists%' and v_bad like 'The code must be%',
    'dup: ' || v_dup || ' / short: ' || v_bad);
end $$;

-- ---------- P14: the Worker's order step: owner gets the price from the plan config, others do not ----------
do $$
declare r jsonb; v_msg text := 'no error'; v_row uuid;
begin
  r := public.billing_begin_order('15000000-0000-0000-0000-000000000001', '15100000-0000-0000-0000-000000000001', 'all');
  insert into p15_results values ('P14a', (r->>'ok')::boolean and (r->>'amount_paise')::int = 99900 and r->>'currency' = 'INR',
    'reply: ' || r::text);
  begin
    perform public.billing_begin_order('15000000-0000-0000-0000-000000000003', '15100000-0000-0000-0000-000000000001', 'all');
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P14b', v_msg = 'Only the shop owner can pay for a plan.', 'manager tried: ' || v_msg);
  v_msg := 'no error';
  begin
    perform public.billing_begin_order('15000000-0000-0000-0000-000000000001', '15100000-0000-0000-0000-000000000001', 'free');
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P14c', v_msg like 'Online payment is not set up%', 'free tried: ' || v_msg);
end $$;

-- ---------- P15: a paid order: wrong amount refused; right amount upgrades once; a repeat changes nothing ----------
do $$
declare v_pay uuid; v_msg text := 'no error'; r1 jsonb; r2 jsonb; v_plan text; v_until timestamptz; v_status text;
begin
  select id into v_pay from public.plan_payments where shop_id = '15100000-0000-0000-0000-000000000001' and status = 'pending' order by created_at desc limit 1;
  perform public.billing_attach_order(v_pay, 'order_P15TEST1');
  begin
    perform public.billing_mark_paid('order_P15TEST1', 'pay_P15TEST1', 100, 'INR', 'webhook', null);
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P15a', v_msg = 'Amount does not match this plan.', 'wrong amount: ' || v_msg);

  r1 := public.billing_mark_paid('order_P15TEST1', 'pay_P15TEST1', 99900, 'INR', 'webhook', null);
  r2 := public.billing_mark_paid('order_P15TEST1', 'pay_P15TEST1', 99900, 'INR', 'webhook', null);
  select plan, plan_until into v_plan, v_until from public.shops where id = '15100000-0000-0000-0000-000000000001';
  select status into v_status from public.plan_payments where id = v_pay;
  insert into p15_results values ('P15b', (r1->>'ok')::boolean and (r2->>'ok')::boolean and v_plan = 'all'
      and v_until > now() + interval '29 days' and v_status = 'paid',
    'plan ' || v_plan || ' until ' || coalesce(v_until::text, 'null') || ' status ' || v_status);

  v_msg := 'no error';
  begin
    perform public.billing_mark_paid('order_P15TEST1', 'pay_P15OTHER', 99900, 'INR', 'webhook', null);
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P15c', v_msg like 'This order was already paid%', 'second payment id: ' || v_msg);
end $$;

-- ---------- P16: a payment confirmed by a non-owner is refused; the app cannot run the payment steps ----------
do $$
declare v_pay uuid; v_msg text := 'no error';
begin
  insert into public.plan_payments (shop_id, plan, amount_paise) values ('15100000-0000-0000-0000-000000000002', 'growth', 49900)
    returning id into v_pay;
  perform public.billing_attach_order(v_pay, 'order_P15TEST2');
  begin
    perform public.billing_mark_paid('order_P15TEST2', 'pay_P15TEST2', 49900, 'INR', 'verify', '15000000-0000-0000-0000-000000000003');
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P16a', v_msg = 'Only the shop owner can confirm this payment.', 'manager confirm: ' || v_msg);
end $$;
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', false);
set local role authenticated;
do $$
declare v_msg text := 'no error';
begin
  begin
    perform public.billing_mark_paid('order_P15TEST2', 'pay_P15TEST2', 49900, 'INR', 'verify', null);
  exception when insufficient_privilege then v_msg := 'denied'; end;
  insert into p15_results values ('P16b', v_msg = 'denied', 'app role tried payment step: ' || v_msg);
  v_msg := 'no error';
  begin
    perform 1 from public.plan_payments;
  exception when insufficient_privilege then v_msg := 'denied'; end;
  insert into p15_results values ('P16c', v_msg = 'denied', 'app role reading plan_payments: ' || v_msg);
end $$;
reset role;

-- ---------- P17: a refused code leaves the shop's plan exactly as it was ----------
insert into p15_results values ('P17', (select plan from public.shops where id = '15100000-0000-0000-0000-000000000003') = 'all'
    and (select plan_until from public.shops where id = '15100000-0000-0000-0000-000000000003') is null
    and (select used_count from public.promo_codes where code = 'P15-LOW') = 0,
  'shop three plan: ' || (select plan from public.shops where id = '15100000-0000-0000-0000-000000000003'));

-- ---------- P19: a late payment for a lower plan never moves a shop down ----------
insert into public.plan_payments (id, shop_id, plan, amount_paise, razorpay_order_id)
values ('19000000-0000-0000-0000-000000000001', '15100000-0000-0000-0000-000000000003', 'growth', 49900, 'order_P19');
do $$
declare r jsonb;
begin
  r := public.billing_mark_paid('order_P19', 'pay_P19', 49900, 'INR', 'webhook', null);
  insert into p15_results values ('P19', (r->>'ok')::boolean and (r->>'plan_changed')::boolean = false
      and (select plan from public.shops where id = '15100000-0000-0000-0000-000000000003') = 'all'
      and (select status from public.plan_payments where razorpay_order_id = 'order_P19') = 'paid',
    'reply: ' || r::text);
end $$;

-- ---------- P20: the admin usage list shows which shop used a code (admin only) ----------
select set_config('test.p15forever', (select id::text from public.promo_codes where code = 'P15-FOREVER'), false);
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000004', false);
set local role authenticated;
do $$
declare v_use jsonb; v_msg text := 'no error';
begin
  v_use := public.admin_promo_usage(current_setting('test.p15forever')::uuid);
  insert into p15_results values ('P20', jsonb_array_length(v_use) >= 1 and v_use->0->>'shop_name' is not null,
    'rows: ' || jsonb_array_length(v_use));
end $$;
reset role;
select set_config('test.p15forever', (select id::text from public.promo_codes where code = 'P15-FOREVER'), false);
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', false);
set local role authenticated;
do $$
declare v_msg text := 'no error';
begin
  begin
    perform public.admin_promo_usage(current_setting('test.p15forever')::uuid);
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P20b', v_msg = 'Only the platform owner can do this.', 'shop owner tried: ' || v_msg);
end $$;
reset role;

-- ---------- P21: an owner who keeps asking gets a plain refusal after 10 orders in 15 minutes ----------
do $$
declare n0 int; n_ok int := 0; v_msg text := 'no error'; i int;
begin
  select count(*) into n0 from public.plan_payments
    where requested_by = '15000000-0000-0000-0000-000000000001' and created_at > now() - interval '15 minutes';
  for i in 1..20 loop
    begin
      perform public.billing_begin_order('15000000-0000-0000-0000-000000000001', '15100000-0000-0000-0000-000000000004', 'all');
      n_ok := n_ok + 1;
    exception when others then v_msg := sqlerrm; exit;
    end;
  end loop;
  insert into p15_results values ('P21', (n0 + n_ok) = 10 and v_msg like 'Too many payment tries%',
    'before: ' || n0 || ' new: ' || n_ok || ' last: ' || v_msg);
end $$;


-- ---------- P22-P32 (patch-16): shops given All Features by default, promo and payment rules, plan sources ----------
-- Shop A (16200000-...-01) was made before patch-14, so the default All Features came to it and patch-16 marked it 'legacy'.
-- Shops B, E: made here as legacy default shops. C: paid All Features with days left. D: a free shop.
select set_config('request.jwt.claim.sub', '', false);  -- BizGrow's own setup: no signed-in user
insert into auth.users (id, email) values
  ('16200000-0000-0000-0000-00000000000b', 'paid-owner@test.local'),
  ('16200000-0000-0000-0000-00000000000c', 'free-owner@test.local')
on conflict (id) do nothing;
insert into public.shops (id, name) values
  ('16200000-0000-0000-0000-000000000002', 'P16 Legacy Shop B'),
  ('16200000-0000-0000-0000-000000000003', 'P16 Paid Shop C'),
  ('16200000-0000-0000-0000-000000000004', 'P16 Free Shop D'),
  ('16200000-0000-0000-0000-000000000005', 'P16 Legacy Shop E')
on conflict (id) do nothing;
insert into public.staff (shop_id, auth_user_id, name, role, active) values
  ('16200000-0000-0000-0000-000000000002', '16200000-0000-0000-0000-00000000000a', 'Legacy Owner', 'owner', true),
  ('16200000-0000-0000-0000-000000000003', '16200000-0000-0000-0000-00000000000b', 'Paid Owner', 'owner', true),
  ('16200000-0000-0000-0000-000000000004', '16200000-0000-0000-0000-00000000000c', 'Free Owner', 'owner', true),
  ('16200000-0000-0000-0000-000000000005', '16200000-0000-0000-0000-00000000000a', 'Legacy Owner', 'owner', true)
on conflict (shop_id, auth_user_id) do nothing;
update public.shops set plan = 'all', plan_source = 'legacy' where id in ('16200000-0000-0000-0000-000000000002', '16200000-0000-0000-0000-000000000005');
update public.shops set plan = 'all', plan_source = 'paid', plan_base = 'free', plan_base_source = 'free',
       plan_until = now() + interval '20 days' where id = '16200000-0000-0000-0000-000000000003';
insert into public.promo_codes (code, plan, duration_days, max_uses, active) values
  ('P16-FOREVER', 'growth', null, 1, true),
  ('P16-AGAIN',   'growth', 30,   1, true),
  ('P16-TEMP',    'growth', 30,   2, true),
  ('P16-EXT',     'growth', 30,   2, true),
  ('P16-LOW',     'growth', 30,   1, true),
  ('P16-FREE',    'growth', 30,   1, true);

-- ---------- P22: the default shop from before patch-14 is marked legacy by the one-time backfill ----------
do $$
declare s public.shops;
begin
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000001';
  insert into p15_results values ('P22', s.plan = 'all' and s.plan_source = 'legacy' and s.plan_until is null,
    'plan ' || coalesce(s.plan, 'null') || ' source ' || coalesce(s.plan_source, 'null'));
end $$;

-- ---------- P23: a legacy default shop can take a permanent code (the bug: it was refused) ----------
select set_config('request.jwt.claim.sub', '16200000-0000-0000-0000-00000000000a', false);
do $$
declare r jsonb; s public.shops;
begin
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000001', 'P16-FOREVER');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000001';
  insert into p15_results values ('P23', (r->>'ok')::boolean and s.plan = 'growth' and s.plan_source = 'promo'
      and s.plan_until is null and s.plan_base is null,
    'reply: ' || r::text || ' | plan ' || s.plan || ' source ' || s.plan_source);
end $$;

-- ---------- P24: a code for the plan the shop already has for good is refused, and not counted ----------
do $$
declare r jsonb; n0 int;
begin
  select used_count into n0 from public.promo_codes where code = 'P16-AGAIN';
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000001', 'P16-AGAIN');
  insert into p15_results values ('P24', (r->>'ok')::boolean = false and r->>'message' like '%for good%'
      and (select used_count from public.promo_codes where code = 'P16-AGAIN') = n0,
    'reply: ' || r::text);
end $$;

-- ---------- P25: a legacy default shop takes a 30-day code: the plan and end date are set, and the base is kept as legacy ----------
do $$
declare r jsonb; s public.shops;
begin
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000002', 'P16-TEMP');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000002';
  insert into p15_results values ('P25', (r->>'ok')::boolean and s.plan = 'growth' and s.plan_source = 'promo'
      and s.plan_base = 'all' and s.plan_base_source = 'legacy'
      and s.plan_until between now() + interval '29 days' and now() + interval '31 days',
    'reply: ' || r::text || ' | plan ' || s.plan || ' base ' || coalesce(s.plan_base, 'null') || ' ' || coalesce(s.plan_base_source, 'null'));
end $$;

-- ---------- P26: the same plan, with days left: the code adds 30 days to the end date and says so ----------
do $$
declare r jsonb; before_until timestamptz; s public.shops;
begin
  select plan_until into before_until from public.shops where id = '16200000-0000-0000-0000-000000000002';
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000002', 'P16-EXT');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000002';
  insert into p15_results values ('P26', (r->>'ok')::boolean and (r->>'extended')::boolean
      and s.plan_until - before_until between interval '29 days 23 hours' and interval '30 days 1 minute'
      and s.plan_source = 'promo' and s.plan_base = 'all' and s.plan_base_source = 'legacy',
    'reply: ' || r::text);
end $$;

-- ---------- P27: a lower plan code is refused; the message names the current plan and its end date; nothing changes ----------
select set_config('request.jwt.claim.sub', '16200000-0000-0000-0000-00000000000b', false);
do $$
declare r jsonb; s public.shops; n0 int;
begin
  select used_count into n0 from public.promo_codes where code = 'P16-LOW';
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000003', 'P16-LOW');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000003';
  insert into p15_results values ('P27', (r->>'ok')::boolean = false
      and r->>'message' like '%All Features%'
      and r->>'message' like '%until ' || to_char(s.plan_until at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '%'
      and s.plan = 'all' and s.plan_source = 'paid'
      and (select used_count from public.promo_codes where code = 'P16-LOW') = n0,
    'reply: ' || r::text);
end $$;

-- ---------- P28: a free shop takes a 30-day code; the free plan is the one to go back to ----------
select set_config('request.jwt.claim.sub', '16200000-0000-0000-0000-00000000000c', false);
do $$
declare r jsonb; s public.shops;
begin
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000004', 'P16-FREE');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000004';
  insert into p15_results values ('P28', (r->>'ok')::boolean and s.plan = 'growth' and s.plan_source = 'promo'
      and s.plan_base = 'free' and s.plan_base_source = 'free' and s.plan_until is not null,
    'reply: ' || r::text);
end $$;

-- ---------- P29: a legacy default shop pays for Growth: the order is allowed, the payment sets the plan, a repeat changes nothing ----------
select set_config('request.jwt.claim.sub', '', false);
do $$
declare o jsonb; pay uuid; m1 jsonb; m2 jsonb; s public.shops; u_until timestamptz;
begin
  o := public.billing_begin_order('16200000-0000-0000-0000-00000000000a', '16200000-0000-0000-0000-000000000005', 'growth');
  pay := (o->>'payment_id')::uuid;
  perform public.billing_attach_order(pay, 'order_p16_legacy');
  m1 := public.billing_mark_paid('order_p16_legacy', 'pay_p16_legacy', 49900, 'INR', 'verify', '16200000-0000-0000-0000-00000000000a');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000005';
  u_until := s.plan_until;
  m2 := public.billing_mark_paid('order_p16_legacy', 'pay_p16_legacy', 49900, 'INR', 'webhook', null);
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000005';
  insert into p15_results values ('P29', (m1->>'plan_changed')::boolean and s.plan = 'growth' and s.plan_source = 'paid'
      and s.plan_base = 'all' and s.plan_base_source = 'legacy' and s.plan_until is not null
      and (m2->>'status') = 'paid' and s.plan_until = u_until
      and (select count(*) from public.plan_payments where razorpay_payment_id = 'pay_p16_legacy') = 1,
    'first: ' || m1::text || ' | repeat: ' || m2::text);
end $$;

-- ---------- P30: a paid shop on Growth with days left cannot order Growth again ----------
do $$
declare v_msg text := 'no error';
begin
  begin
    perform public.billing_begin_order('16200000-0000-0000-0000-00000000000a', '16200000-0000-0000-0000-000000000005', 'growth');
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P30', v_msg like 'Your shop is already on the Growth plan until%', 'message: ' || v_msg);
end $$;

-- ---------- P31: the platform owner can read a shop's plan source and set it; an owner cannot ----------
select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000004', false);
set role authenticated;
do $$
declare j jsonb; v_set jsonb;
begin
  j := public.admin_shop_plan('16200000-0000-0000-0000-000000000001');
  v_set := public.admin_set_plan_source('16200000-0000-0000-0000-000000000001', 'manual');
  insert into p15_results values ('P31', j->>'plan_source' = 'promo' and (v_set->>'plan_source') = 'manual',
    'read: ' || (j->>'plan_source') || ' set: ' || (v_set->>'plan_source'));
end $$;
reset role;
select set_config('request.jwt.claim.sub', '16200000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare v_msg text := 'no error';
begin
  begin
    perform public.admin_shop_plan('16200000-0000-0000-0000-000000000001');
  exception when others then v_msg := sqlerrm; end;
  insert into p15_results values ('P32', v_msg = 'Only the platform owner can do this.', 'owner tried: ' || v_msg);
end $$;
reset role;

-- ---------- P33-P34: a code for the top plan (All Features) works for a free shop and for a legacy default shop ----------
-- A new free shop F (16200000-...-06) and the code P16-TOP (All Features, 30 days, 2 uses).
select set_config('request.jwt.claim.sub', '', false);
insert into public.shops (id, name, plan, plan_base, plan_base_source) values
  ('16200000-0000-0000-0000-000000000006', 'P16 Free Shop F', 'free', null, null)
on conflict (id) do nothing;
insert into public.staff (shop_id, auth_user_id, name, role, active) values
  ('16200000-0000-0000-0000-000000000006', '16200000-0000-0000-0000-00000000000c', 'Free Owner', 'owner', true)
on conflict (shop_id, auth_user_id) do nothing;
insert into public.promo_codes (code, plan, duration_days, max_uses, active) values
  ('P16-TOP', 'all', 30, 2, true);

select set_config('request.jwt.claim.sub', '16200000-0000-0000-0000-00000000000c', false);
do $$
declare r jsonb; s public.shops;
begin
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000006', 'P16-TOP');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000006';
  insert into p15_results values ('P33', (r->>'ok')::boolean and s.plan = 'all' and s.plan_source = 'promo'
      and s.plan_until is not null and s.plan_base = 'free' and s.plan_base_source = 'free',
    'reply: ' || r::text || ' | plan ' || coalesce(s.plan, 'null') || ' source ' || coalesce(s.plan_source, 'null'));
end $$;

select set_config('request.jwt.claim.sub', '16200000-0000-0000-0000-00000000000a', false);
do $$
declare r jsonb; s public.shops;
begin
  r := public.redeem_promo_code('16200000-0000-0000-0000-000000000002', 'P16-TOP');
  select * into s from public.shops where id = '16200000-0000-0000-0000-000000000002';
  insert into p15_results values ('P34', (r->>'ok')::boolean and s.plan = 'all' and s.plan_source = 'promo'
      and s.plan_until is not null,
    'reply: ' || r::text || ' | plan ' || coalesce(s.plan, 'null') || ' source ' || coalesce(s.plan_source, 'null'));
end $$;

select id, ok, detail from p15_results order by id;
