-- Supplier checks (stage 10, patch-11). SCRATCH DATABASE ONLY: creates test users and shops.
-- Run by supabase/tests/run-checks.cjs after patch-11.sql. Uses its own shops so it does not touch
-- the online store checks. Each row: id, ok (true = passed), detail.

create temp table if not exists sup_check_results (id text primary key, ok boolean, detail text);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'sup-owner@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'sup-manager@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'sup-cashier@test.local'),
  ('00000000-0000-0000-0000-0000000000d4', 'sup-keeper@test.local'),
  ('00000000-0000-0000-0000-0000000000d5', 'sup-other-owner@test.local')
on conflict (id) do nothing;

insert into public.shops (id, name, phone, city, lang, plan) values
  ('00000000-0000-0000-0000-0000000000e1', 'Supplier Shop', '9822222222', 'Jaipur', 'en', 'all'),
  ('00000000-0000-0000-0000-0000000000e2', 'Other Shop', '9833333333', 'Surat', 'en', 'all')
on conflict (id) do nothing;

insert into public.staff (shop_id, auth_user_id, name, email, role) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Owner', 'sup-owner@test.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d2', 'Manager', 'sup-manager@test.local', 'manager'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d3', 'Cashier', 'sup-cashier@test.local', 'cashier'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d4', 'Keeper', 'sup-keeper@test.local', 'stock-keeper'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d5', 'Other Owner', 'sup-other-owner@test.local', 'owner');

-- ---------- S01: the new fields exist ----------
insert into sup_check_results
select 'S01', (select count(*) from information_schema.columns
                where table_schema = 'public' and table_name = 'suppliers' and column_name in ('items', 'note')) = 2,
       'suppliers has the items and note fields';

-- ---------- S02: the owner adds a supplier ----------
do $$
declare v_id uuid; v_row public.suppliers%rowtype;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
  v_id := public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', null,
            '  Ram Traders  ', '9800000001', 'Atta, rice', 'Pays on delivery');
  select * into v_row from public.suppliers where id = v_id;
  insert into sup_check_results values ('S02',
    found and v_row.name = 'Ram Traders' and v_row.phone = '9800000001'
      and v_row.items = 'Atta, rice' and v_row.note = 'Pays on delivery' and v_row.shop_id = '00000000-0000-0000-0000-0000000000e1',
    'owner adds a supplier, name trimmed, items and note saved');
  perform set_config('test.sup_id', v_id::text, false);
end $$;

-- ---------- S03: a cashier cannot add a supplier ----------
do $$
declare v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
  begin
    perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', null, 'Cashier Try', null, null, null);
  exception when others then v_msg := sqlerrm;
  end;
  insert into sup_check_results values ('S03', v_msg like 'Your role cannot change suppliers%',
    'cashier is refused: ' || v_msg);
end $$;

-- ---------- S04: a stock-keeper can add and edit ----------
do $$
declare v_id uuid; v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);
  v_id := public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', null, 'Keeper Supplies', null, null, null);
  begin
    perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', v_id, 'Keeper Supplies Ltd', '9800000002', 'Oil', null);
  exception when others then v_msg := sqlerrm;
  end;
  insert into sup_check_results values ('S04',
    v_id is not null and v_msg = 'no error'
      and (select name from public.suppliers where id = v_id) = 'Keeper Supplies Ltd',
    'stock-keeper adds and edits a supplier: ' || v_msg);
  perform set_config('test.keeper_sup_id', v_id::text, false);
end $$;

-- ---------- S05: a stock-keeper cannot delete ----------
do $$
declare v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', false);
  begin
    perform public.delete_supplier('00000000-0000-0000-0000-0000000000e1', current_setting('test.keeper_sup_id')::uuid);
  exception when others then v_msg := sqlerrm;
  end;
  insert into sup_check_results values ('S05', v_msg like 'Only the owner or manager can delete%',
    'stock-keeper is refused on delete: ' || v_msg);
end $$;

-- ---------- S06: the manager edits, then deletes (soft delete) ----------
do $$
declare v_id uuid := current_setting('test.sup_id')::uuid; v_msg text := 'no error'; v_deleted boolean;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
  perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', v_id, 'Ram Traders', '9800000001', 'Atta, rice, dal', 'Pays on delivery');
  perform public.delete_supplier('00000000-0000-0000-0000-0000000000e1', v_id);
  select deleted_at is not null into v_deleted from public.suppliers where id = v_id;
  insert into sup_check_results values ('S06', coalesce(v_deleted, false),
    'manager edits and deletes; the row is kept with deleted_at set');
end $$;

-- ---------- S07: a deleted supplier cannot be edited or deleted again ----------
do $$
declare v_id uuid := current_setting('test.sup_id')::uuid; v_msg text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
  begin
    perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', v_id, 'Back again', null, null, null);
  exception when others then v_msg := sqlerrm;
  end;
  insert into sup_check_results values ('S07', v_msg = 'Supplier not found', 'deleted supplier is not found: ' || v_msg);
end $$;

-- ---------- S08: empty and too long names are refused ----------
do $$
declare v_empty text := 'no error'; v_long text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
  begin
    perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', null, '   ', null, null, null);
  exception when others then v_empty := sqlerrm;
  end;
  begin
    perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', null, repeat('x', 61), null, null, null);
  exception when others then v_long := sqlerrm;
  end;
  insert into sup_check_results values ('S08', v_empty = 'Supplier name is needed' and v_long like 'Supplier name is too long%',
    'empty and 61-letter names are refused');
end $$;

-- ---------- S09: a user of another shop cannot touch these suppliers ----------
do $$
declare v_id uuid := current_setting('test.keeper_sup_id')::uuid; v_a text := 'no error'; v_b text := 'no error';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d5', false);
  begin
    perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e1', null, 'Sneaky', null, null, null);
  exception when others then v_a := sqlerrm;
  end;
  begin
    perform public.upsert_supplier('00000000-0000-0000-0000-0000000000e2', v_id, 'Sneaky edit', null, null, null);
  exception when others then v_b := sqlerrm;
  end;
  insert into sup_check_results values ('S09',
    v_a like 'Your role cannot change suppliers%' and v_b = 'Supplier not found'
      and (select name from public.suppliers where id = v_id) = 'Keeper Supplies Ltd',
    'other shop is refused: ' || v_a || ' / ' || v_b);
end $$;

-- ---------- S10: the activity log has a line for each change ----------
insert into sup_check_results
select 'S10', (select count(*) from public.audit_log
                where table_name = 'suppliers' and shop_id = '00000000-0000-0000-0000-0000000000e1') >= 5,
       'activity log has the supplier changes';

-- ---------- S11: the public (anon) role cannot run the supplier functions ----------
insert into sup_check_results
select 'S11', not has_function_privilege('anon', 'public.upsert_supplier(uuid,uuid,text,text,text,text)', 'execute')
              and not has_function_privilege('anon', 'public.delete_supplier(uuid,uuid)', 'execute')
              and has_function_privilege('authenticated', 'public.upsert_supplier(uuid,uuid,text,text,text,text)', 'execute')
              and has_function_privilege('authenticated', 'public.delete_supplier(uuid,uuid)', 'execute'),
       'anon cannot run supplier functions; signed-in users can';

-- ---------- S12: only the live supplier is in the shop list, with its items and note ----------
insert into sup_check_results
select 'S12', (select count(*) from public.suppliers
                where shop_id = '00000000-0000-0000-0000-0000000000e1' and deleted_at is null) = 1
              and (select items from public.suppliers
                    where shop_id = '00000000-0000-0000-0000-0000000000e1' and deleted_at is null) = 'Oil',
       'only the live supplier remains in the shop list, with its items';

select id, ok, detail from sup_check_results order by id;
