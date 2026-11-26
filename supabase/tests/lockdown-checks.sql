-- Lockdown checks (stage 9, patch-10). Run by run-checks.cjs --lockdown on a SCRATCH database only,
-- after store-checks.sql, patch-10.sql (twice) has run. Each check has an id L01 to L08.
-- The anonymous and service roles are played with SET ROLE, the same way the database itself would see them.
-- The last result lists one row per check: ok = true means the check passed.

create temp table if not exists lockdown_check_results (id text primary key, ok boolean, detail text);

-- L01: the public web address (anonymous role) can no longer place an order directly.
do $$
declare denied boolean := false; other text := ''; placed boolean := false;
begin
  set local role anon;
  begin
    perform public.place_store_order('test-shop-1', 'Lock Buyer', '9000000031', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
    placed := true;
  exception
    when insufficient_privilege then denied := true;
    when others then other := sqlerrm;
  end;
  reset role;
  insert into lockdown_check_results values ('L01', denied and not placed,
    case when denied then 'anonymous direct call refused' else 'anonymous call gave: ' || coalesce(nullif(other, ''), 'a result') end);
end $$;

-- L02: the server role (what the Worker uses) still places an order, and keeps the reference for L03.
do $$
declare r jsonb; msg text := ''; ok boolean := false; ref text := '';
begin
  set local role service_role;
  begin
    r := public.place_store_order('test-shop-1', 'Lock Buyer', '9000000032', null,
      jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0000-0000000000c2', 'qty', '1')));
    ok := coalesce(r->>'ok', '') = 'true';
    ref := coalesce(r->>'ref', '');
  exception when others then msg := sqlerrm;
  end;
  reset role;
  perform set_config('lockdown.ref', ref, false);
  insert into lockdown_check_results values ('L02', ok and ref <> '',
    case when ok then 'server role placed an order' else 'server role call failed: ' || msg end);
end $$;

-- L03: the anonymous role can still track that order (customers' tracking is unchanged).
do $$
declare r jsonb; msg text := ''; ok boolean := false;
begin
  set local role anon;
  begin
    r := public.track_store_order('test-shop-1', current_setting('lockdown.ref'), '9000000032');
    ok := coalesce(r->>'ok', '') = 'true' and coalesce(r->>'status', '') = 'new';
  exception when others then msg := sqlerrm;
  end;
  reset role;
  insert into lockdown_check_results values ('L03', ok,
    case when ok then 'anonymous tracking still works' else 'tracking failed: ' || msg end);
end $$;

-- L04: the anonymous role can still read the public store, with no cost prices.
do $$
declare r jsonb; msg text := ''; ok boolean := false;
begin
  set local role anon;
  begin
    r := public.public_store_catalogue('test-shop-1');
    ok := coalesce(r->'shop'->>'name', '') = 'Test Shop' and jsonb_typeof(r->'items') = 'array';
  exception when others then msg := sqlerrm;
  end;
  reset role;
  insert into lockdown_check_results values ('L04', ok,
    case when ok then 'public store page still reads' else 'store read failed: ' || msg end);
end $$;

-- L05: the anonymous role has no direct access to any table in the public schema.
insert into lockdown_check_results
select 'L05',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, 'select, insert, update, delete')),
  'anonymous role has no table access in the public schema';

-- L06: signed-in users cannot place orders directly either; only the server does.
insert into lockdown_check_results
select 'L06', not has_function_privilege('authenticated', 'public.place_store_order(text,text,text,text,jsonb)', 'execute')
              and not has_function_privilege('public', 'public.place_store_order(text,text,text,text,jsonb)', 'execute'),
  'signed-in users and the public role cannot call place_store_order';

-- L07: the server role has the function.
insert into lockdown_check_results
select 'L07', has_function_privilege('service_role', 'public.place_store_order(text,text,text,text,jsonb)', 'execute'),
  'server role (service_role) can call place_store_order';

-- L08: the owner app's functions and signed-in table access are unchanged.
insert into lockdown_check_results
select 'L08',
  has_function_privilege('authenticated', 'public.list_store_orders(uuid,text,timestamptz,boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.set_store_order_status(uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.cancel_new_store_orders(uuid,uuid[])', 'execute')
  and has_table_privilege('authenticated', 'public.tasks', 'select')
  and has_table_privilege('authenticated', 'public.products', 'select'),
  'owner app functions and signed-in table access unchanged';

select id, ok, detail from lockdown_check_results order by id;
