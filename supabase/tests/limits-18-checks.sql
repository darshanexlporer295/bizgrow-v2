-- Limits added by patch-18: promo tries capped across accounts, the shared voice count, and internal
-- functions closed to anon. SCRATCH DATABASE ONLY. Run after run-all-pending.sql (which includes patch-18).
-- Each row: id, ok (true = passed), detail. Test ids and codes here start with "L18" (not real ones).

create temp table if not exists l18_results (id text primary key, ok boolean, detail text);
grant all on l18_results to authenticated;

-- Test people and shops: seven owners, one shop each.
insert into auth.users (id, email)
  select ('16000000-0000-0000-0000-00000000000' || n)::uuid, 'l18-' || n || '@test.local' from generate_series(1, 7) n
on conflict (id) do nothing;
insert into public.shops (id, name)
  select ('16100000-0000-0000-0000-00000000000' || n)::uuid, 'L18 Shop ' || n from generate_series(1, 7) n
on conflict (id) do nothing;
insert into public.staff (shop_id, auth_user_id, name, role, active)
  select ('16100000-0000-0000-0000-00000000000' || n)::uuid, ('16000000-0000-0000-0000-00000000000' || n)::uuid,
         'Owner ' || n, 'owner', true
    from generate_series(1, 7) n
on conflict (shop_id, auth_user_id) do nothing;

-- One code that is switched off (every try at it fails) and one that works.
insert into public.promo_codes (code, plan, duration_days, max_uses, active)
  select 'L18-OFF', 'growth', 30, 1000, false
   where not exists (select 1 from public.promo_codes where code = 'L18-OFF');
insert into public.promo_codes (code, plan, duration_days, max_uses, active)
  select 'L18-FREE', 'growth', 30, 100, true
   where not exists (select 1 from public.promo_codes where code = 'L18-FREE');

-- L01 - L05: promo caps
do $$
declare r jsonb; n int; i int; u int;
begin
  -- L01: five accounts, ten failed tries each, on the same code = 50 failed tries on that code.
  for u in 1..5 loop
    perform set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-00000000000' || u, false);
    for i in 1..10 loop
      r := public.redeem_promo_code(('16100000-0000-0000-0000-00000000000' || u)::uuid, 'L18-OFF');
    end loop;
  end loop;
  select count(*) into n from public.promo_attempts where code = 'L18-OFF' and failed;
  insert into l18_results values ('L01', n = 50, 'failed tries on the code: ' || n);

  -- L02: a sixth account is stopped by the code cap, with the same generic message as the person limit.
  perform set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000006', false);
  r := public.redeem_promo_code('16100000-0000-0000-0000-000000000006', 'L18-OFF');
  select count(*) into n from public.promo_attempts where code = 'L18-OFF' and failed;
  insert into l18_results values ('L02', (r->>'limited')::boolean = true
      and r->>'message' = 'Too many tries. Please wait a while and try again.' and n = 50,
    'reply: ' || coalesce(r->>'message', 'none') || ' / failed tries still ' || n);

  -- L03: the same sixth account can still use a different, working code.
  r := public.redeem_promo_code('16100000-0000-0000-0000-000000000006', 'L18-FREE');
  insert into l18_results values ('L03', (r->>'ok')::boolean = true, 'other code reply: ' || coalesce(r->>'message', 'none'));

  -- L04: a try that uses the code is not counted as a failed try.
  insert into l18_results values ('L04',
    (select count(*) from public.promo_attempts where code = 'L18-FREE' and failed) = 0
    and (select count(*) from public.promo_attempts where code = 'L18-FREE') = 1,
    'rows for the working code: ' || (select count(*) from public.promo_attempts where code = 'L18-FREE'));
end $$;

-- L05: failed tries across all codes in the last hour are capped too (300). Filled up to the cap with other codes.
do $$
declare f int; r jsonb;
begin
  select count(*) into f from public.promo_attempts where failed and tried_at > now() - interval '1 hour';
  insert into public.promo_attempts (user_id, code, failed)
    select gen_random_uuid(), 'L18-SPRAY' || g, true from generate_series(1, greatest(0, 300 - f)) g;
  perform set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000007', false);
  r := public.redeem_promo_code('16100000-0000-0000-0000-000000000007', 'L18-NEVER-USED');
  insert into l18_results values ('L05', (r->>'limited')::boolean = true
      and r->>'message' = 'Too many tries. Please wait a while and try again.',
    'all-codes reply: ' || coalesce(r->>'message', 'none'));
end $$;

-- L10 - L12: the shared voice count, per signed-in person
do $$
declare r jsonb; codes text[] := '{}'; i int;
begin
  perform set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', false);
  for i in 1..3 loop
    r := public.voice_take(3, 60);
    codes := codes || (r->>'ok');
  end loop;
  r := public.voice_take(3, 60);
  insert into l18_results values ('L10', codes = array['true', 'true', 'true']
      and (r->>'ok')::boolean = false and r->>'code' = 'limited',
    'calls: ' || array_to_string(codes, ',') || ', then ' || coalesce(r->>'code', 'none'));

  perform set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', false);
  r := public.voice_take(3, 60);
  insert into l18_results values ('L11', (r->>'ok')::boolean = true, 'another person is not blocked');

  perform set_config('request.jwt.claim.sub', '', false);
  r := public.voice_take(3, 60);
  insert into l18_results values ('L12', (r->>'ok')::boolean = false and r->>'code' = 'login', 'no signed-in user: ' || coalesce(r->>'code', 'none'));
end $$;

-- L20 - L24: who can run what. Anon can run no internal (underscore) function and not the promo or voice calls.
insert into l18_results
  select 'L20', count(*) > 0 and count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) = 0,
         'internal functions: ' || count(*) || ', anon can run ' || count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '\_%';
insert into l18_results values ('L21',
  not has_function_privilege('anon', 'public._sync_shop_plan(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.redeem_promo_code(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.voice_take(int,int)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.redeem_promo_code(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.voice_take(int,int)', 'EXECUTE'),
  'anon denied the internal sync, promo and voice calls; signed-in users keep promo and voice');
insert into l18_results values ('L22',
  not has_table_privilege('anon', 'public.voice_attempts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.voice_attempts', 'SELECT')
  and not has_table_privilege('anon', 'public.promo_attempts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.promo_attempts', 'SELECT'),
  'attempt tables cannot be read by app roles');
insert into l18_results values ('L23',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'promo_attempts'
     and column_name in ('code', 'failed')) = 2,
  'promo_attempts has code and failed columns');

select id, ok, detail from l18_results order by id;
