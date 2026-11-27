-- patch-14: plans (Free, Growth, All Features) and the limits that go with them (stage 11).
-- Run once in the Supabase SQL Editor, after schema.sql and patch-01 to patch-12 (supabase/run-all-pending.sql includes it). Safe to run more than once.
-- What changes:
--   * plans: one table. Each row is one plan and its limits. To change a plan, change its row (one line, see below).
--   * shops.plan: the plan each shop is on. Shops that exist when this patch runs get 'all' (All Features), so nobody
--     loses anything. Shops created after this (new sign-ups) start on 'free'.
--   * Limits enforced on the server, so the app cannot get around them:
--       - bills per month (Free: 30). Counted per bill date, deleted bills do not count.
--       - items in stock (Free: 50).
--       - people in the shop, staff plus pending invites (Free: 2).
--       - online store on/off and suppliers (Free: not included).
--     Udhar reminders, the voice helper and full reports are shown as locked in the app (not enforced on the server yet).
--   * plan_requests: a shop owner can ask for another plan. This only records the request for the BizGrow team.
--     Nothing is charged and no plan is changed by the request. The team changes the plan by hand.
-- To change a limit for a plan, for example to give Free 40 bills:
--   update public.plans set bills_per_month = 40 where code = 'free';
-- To move a shop to another plan (done by the BizGrow team in the SQL Editor, not by the app):
--   update public.shops set plan = 'growth' where name = 'Shop name';
-- Nothing is deleted and no existing bill, product, staff row or supplier changes.

-- ---------- 1. the plans ----------
create table if not exists public.plans (
  code            text primary key,
  name            text not null,
  sort_order      int  not null,
  bills_per_month int,        -- null = no limit
  max_items       int,        -- null = no limit
  max_people      int,        -- null = no limit (staff plus pending invites)
  online_store    boolean not null default false,
  suppliers       boolean not null default false,
  udhar_reminders boolean not null default false,
  voice           boolean not null default false,
  full_reports    boolean not null default false
);

insert into public.plans (code, name, sort_order, bills_per_month, max_items, max_people,
                          online_store, suppliers, udhar_reminders, voice, full_reports) values
  ('free',   'Free',         1, 30,   50,  2,    false, false, false, false, false),
  ('growth', 'Growth',       2, 300,  500, 5,    true,  true,  true,  false, true),
  ('all',    'All Features', 3, null, null, null, true,  true,  true,  true,  true)
on conflict (code) do nothing;

alter table public.plans enable row level security;
drop policy if exists "plans read" on public.plans;
create policy "plans read" on public.plans for select to authenticated using (true);
revoke all on public.plans from public, anon, authenticated;
grant select on public.plans to authenticated;

-- ---------- 2. the plan on each shop ----------
-- Only the first run adds the column. Shops that exist at that moment are set to All Features, once.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'shops' and column_name = 'plan') then
    alter table public.shops add column plan text not null default 'free' references public.plans(code);
    update public.shops set plan = 'all';
  end if;
end
$$;

-- Only the BizGrow team can change a plan (the SQL Editor has no signed-in user). The app cannot.
create or replace function public._plan_guard_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.plan is distinct from old.plan and auth.uid() is not null then
    raise exception 'Only BizGrow can change the plan. Ask for an upgrade instead.' using errcode = '42501';
  end if;
  if new.store_enabled and (tg_op = 'INSERT' or not old.store_enabled)
     and not (select p.online_store from public.plans p where p.code = new.plan) then
    raise exception 'The online store is not on your plan. Ask BizGrow about upgrading.' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_shop on public.shops;
create trigger plan_guard_shop before insert or update on public.shops
  for each row execute function public._plan_guard_shop();

-- ---------- 3. helpers ----------
create or replace function public._plan_of(p_shop uuid)
returns public.plans
language sql stable security definer set search_path = public as $$
  select p.* from public.plans p join public.shops s on s.plan = p.code where s.id = p_shop
$$;

-- Bills dated in the same month as p_date (deleted bills do not count).
create or replace function public._bills_in_month(p_shop uuid, p_date date)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.bills b
   where b.shop_id = p_shop and b.deleted_at is null
     and b.sale_date >= date_trunc('month', p_date)::date
     and b.sale_date <  (date_trunc('month', p_date) + interval '1 month')::date
$$;

create or replace function public._items_count(p_shop uuid)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.products where shop_id = p_shop and deleted_at is null
$$;

create or replace function public._people_count(p_shop uuid)
returns int
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.staff where shop_id = p_shop and active and deleted_at is null)
       + (select count(*)::int from public.staff_invites where shop_id = p_shop and claimed_at is null)
$$;

-- ---------- 4. limits checked before a row is saved ----------
create or replace function public._plan_guard_bill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  p := public._plan_of(new.shop_id);
  if p.code is not null and p.bills_per_month is not null
     and public._bills_in_month(new.shop_id, new.sale_date) >= p.bills_per_month then
    raise exception 'The % bills for this month are used up on the % plan. Ask BizGrow about the next plan.',
      p.bills_per_month, p.name using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_bill on public.bills;
create trigger plan_guard_bill before insert on public.bills
  for each row execute function public._plan_guard_bill();

create or replace function public._plan_guard_product()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  if new.deleted_at is not null then return new; end if;
  p := public._plan_of(new.shop_id);
  if p.code is not null and p.max_items is not null
     and public._items_count(new.shop_id) >= p.max_items then
    raise exception 'Your % plan allows % items. Remove some items or ask BizGrow about the next plan.',
      p.name, p.max_items using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_product on public.products;
create trigger plan_guard_product before insert on public.products
  for each row execute function public._plan_guard_product();

create or replace function public._plan_guard_supplier()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  p := public._plan_of(new.shop_id);
  if p.code is not null and not p.suppliers then
    raise exception 'Suppliers are not on your % plan. Ask BizGrow about upgrading.', p.name
      using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_supplier on public.suppliers;
create trigger plan_guard_supplier before insert on public.suppliers
  for each row execute function public._plan_guard_supplier();

create or replace function public._plan_guard_people()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.plans%rowtype;
begin
  if tg_table_name = 'staff_invites' and new.claimed_at is not null then return new; end if;
  p := public._plan_of(new.shop_id);
  if p.code is not null and p.max_people is not null
     and public._people_count(new.shop_id) >= p.max_people then
    raise exception 'Your % plan allows % people in the shop. Remove someone or ask BizGrow about the next plan.',
      p.name, p.max_people using errcode = 'P0001';
  end if;
  return new;
end
$$;
drop trigger if exists plan_guard_people on public.staff_invites;
create trigger plan_guard_people before insert on public.staff_invites
  for each row execute function public._plan_guard_people();

-- ---------- 5. upgrade requests (recorded only) ----------
create table if not exists public.plan_requests (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  from_plan    text not null,
  to_plan      text not null references public.plans(code),
  requested_by uuid references public.staff(id) on delete set null,
  status       text not null default 'new' check (status in ('new', 'done', 'dropped')),
  created_at   timestamptz not null default now()
);
create index if not exists plan_requests_shop_idx on public.plan_requests (shop_id, status, created_at);

alter table public.plan_requests enable row level security;
drop policy if exists "owner reads plan requests" on public.plan_requests;
create policy "owner reads plan requests" on public.plan_requests for select to authenticated
  using (public.has_shop_role(shop_id, array['owner']));
revoke all on public.plan_requests from public, anon, authenticated;
grant select on public.plan_requests to authenticated;

-- ---------- 6. functions the app calls ----------
create or replace function public._plan_json(p public.plans)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('code', p.code, 'name', p.name, 'sort_order', p.sort_order,
    'bills_per_month', p.bills_per_month, 'max_items', p.max_items, 'max_people', p.max_people,
    'features', jsonb_build_object('online_store', p.online_store, 'suppliers', p.suppliers,
      'udhar_reminders', p.udhar_reminders, 'voice', p.voice, 'full_reports', p.full_reports))
$$;

-- All three plans, for the Plans screen. Any signed-in user can read them.
create or replace function public.get_plans()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please log in again.' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(public._plan_json(p) order by p.sort_order) from public.plans p), '[]'::jsonb);
end
$$;

-- The shop's plan, the usage so far and any open upgrade request. Any member of the shop can read it.
create or replace function public.get_my_plan(p_shop uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.plans%rowtype;
  v_req record;
begin
  if auth.uid() is null then raise exception 'Please log in again.' using errcode = '28000'; end if;
  if public._my_role(p_shop) is null then raise exception 'You are not in this shop' using errcode = '42501'; end if;
  p := public._plan_of(p_shop);
  select r.to_plan, r.created_at into v_req
    from public.plan_requests r where r.shop_id = p_shop and r.status = 'new'
   order by r.created_at desc limit 1;
  return public._plan_json(p) || jsonb_build_object(
    'usage', jsonb_build_object(
      'bills', public._bills_in_month(p_shop, public._ist_today()),
      'items', public._items_count(p_shop),
      'people', public._people_count(p_shop)),
    'requested', case when v_req.to_plan is null then null
                 else jsonb_build_object('to_plan', v_req.to_plan, 'at', v_req.created_at) end);
end
$$;

-- The owner asks for another plan. Recorded for the BizGrow team. Nothing is charged and the plan does not change here.
create or replace function public.request_plan_upgrade(p_shop uuid, p_plan text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_current text;
  v_id uuid;
  v_plan text := lower(trim(coalesce(p_plan, '')));
begin
  perform public._need(p_shop, array['owner'], 'Only the owner can ask for a plan change.');
  select plan into v_current from public.shops where id = p_shop;
  if not exists (select 1 from public.plans where code = v_plan) then raise exception 'Pick a plan'; end if;
  if v_plan = v_current then raise exception 'That is already your plan'; end if;

  select r.id into v_id from public.plan_requests r
   where r.shop_id = p_shop and r.status = 'new' and r.to_plan = v_plan limit 1;
  if v_id is null then
    insert into public.plan_requests (shop_id, from_plan, to_plan, requested_by)
    values (p_shop, v_current, v_plan, public._actor(p_shop))
    returning id into v_id;
    perform public._audit(p_shop, 'request', 'plan_requests', v_id, 'Asked for the ' || v_plan || ' plan');
  end if;
  return jsonb_build_object('ok', true, 'to_plan', v_plan);
end
$$;

revoke all on function public._plan_of(uuid), public._bills_in_month(uuid, date), public._items_count(uuid),
  public._people_count(uuid), public._plan_json(public.plans), public._plan_guard_shop(),
  public._plan_guard_bill(), public._plan_guard_product(), public._plan_guard_supplier(),
  public._plan_guard_people() from public, anon, authenticated;
revoke all on function public.get_plans(), public.get_my_plan(uuid), public.request_plan_upgrade(uuid, text) from public, anon;
grant execute on function public.get_plans(), public.get_my_plan(uuid), public.request_plan_upgrade(uuid, text) to authenticated;
