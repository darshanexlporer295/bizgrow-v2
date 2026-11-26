-- Rollback checks (stage 9, patch-10-rollback). Run by run-checks.cjs --lockdown on a SCRATCH database only,
-- after patch-10-rollback.sql (twice) has run. Each check has an id R01 to R03.
-- The last result lists one row per check: ok = true means the check passed.

create temp table if not exists rollback_check_results (id text primary key, ok boolean, detail text);

-- R01: the public role and signed-in users can call place_store_order again (the state before patch-10).
insert into rollback_check_results
select 'R01',
  has_function_privilege('anon', 'public.place_store_order(text,text,text,text,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.place_store_order(text,text,text,text,jsonb)', 'execute'),
  'anonymous and signed-in roles can call place_store_order again';

-- R02: a real anonymous call places an order again (scratch database only).
do $$
declare r jsonb; msg text := ''; ok boolean := false;
begin
  set local role anon;
  begin
    r := public.place_store_order('test-shop-1', 'Rollback Buyer', '9000000041', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
    ok := coalesce(r->>'ok', '') = 'true';
  exception when others then msg := sqlerrm;
  end;
  reset role;
  insert into rollback_check_results values ('R02', ok,
    case when ok then 'anonymous call places an order after rollback' else 'call failed: ' || msg end);
end $$;

-- R03: the server role still has the function, and the rollback did not touch the server role's rights.
insert into rollback_check_results
select 'R03', has_function_privilege('service_role', 'public.place_store_order(text,text,text,text,jsonb)', 'execute'),
  'server role still has place_store_order';

select id, ok, detail from rollback_check_results order by id;
