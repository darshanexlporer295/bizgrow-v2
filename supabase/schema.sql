-- BizGrow v2: database tables for the real server (prep only, not connected yet).
-- Run this whole file once in the Supabase SQL editor. It is safe to run again:
-- every step checks whether it is already there first.
--
-- Rule in plain words: every shop's rows are visible only to the logged-in
-- staff of that shop. Row Level Security (RLS) enforces this in the database itself.

-- ---------- shops and staff ----------

create table if not exists public.shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  trade       text,                       -- textile, plastic, chemical, agri, other
  city        text,
  lang        text not null default 'en', -- en, hi, mr, gu
  gstin       text,
  phone       text,                       -- shop phone number
  upi_id      text,                       -- for example name@bank
  address     text,                       -- printed on bills
  assistant_name text,                    -- the name of the voice assistant (blank = Chotu)
  created_at  timestamptz not null default now()
);

-- Shops made before patch-02 get the four columns above added here (safe to run again).
alter table public.shops add column if not exists phone text;
alter table public.shops add column if not exists upi_id text;
alter table public.shops add column if not exists address text;
alter table public.shops add column if not exists assistant_name text;
alter table public.shops add column if not exists business_type text;  -- patch-04

create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  email         text,
  -- owner, manager, cashier, stock-keeper, accountant
  role          text not null check (role in ('owner', 'manager', 'cashier', 'stock-keeper', 'accountant')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (shop_id, auth_user_id)
);

-- Helper: the shop ids the logged-in user works in. Security definer so it can
-- read the staff table without tripping the policies that call it.
create or replace function public.current_shop_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.shop_id from public.staff s
  where s.auth_user_id = auth.uid() and s.active
$$;

-- ---------- shop business data ----------

create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  name         text not null,
  category     text,
  unit         text,
  buy_price    numeric(12,2) not null default 0,
  sell_price   numeric(12,2) not null default 0,
  stock_qty    numeric(12,3) not null default 0,
  low_stock_at numeric(12,3) not null default 0,
  deleted_at   timestamptz,                -- soft delete: set instead of removing
  created_at   timestamptz not null default now()
);

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  name        text not null,
  phone       text,
  city        text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  name        text not null,
  phone       text,
  gstin       text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.bills (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  bill_no       integer not null,
  customer_id   uuid references public.customers(id) on delete set null,
  total         numeric(12,2) not null default 0,
  discount      numeric(12,2) not null default 0,
  payment_mode  text,                      -- cash, upi, udhar
  created_by    uuid references public.staff(id) on delete set null,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (shop_id, bill_no)
);

create table if not exists public.bill_items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  bill_id     uuid not null references public.bills(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  qty         numeric(12,3) not null default 1,
  rate        numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0
);

-- Udhar = money a customer owes the shop. Each entry can carry a due date.
create table if not exists public.udhar_entries (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  bill_id      uuid references public.bills(id) on delete set null,
  amount       numeric(12,2) not null,
  due_date     date,
  note         text,
  settled      boolean not null default false,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete set null,
  amount       numeric(12,2) not null,
  mode         text,                       -- cash, upi, bank
  paid_at      timestamptz not null default now(),
  created_by   uuid references public.staff(id) on delete set null,
  deleted_at   timestamptz
);

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  category    text,
  amount      numeric(12,2) not null,
  note        text,
  spent_on    date not null default current_date,
  created_by  uuid references public.staff(id) on delete set null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Audit log: who did what. Rows are never really deleted; deleted_at marks a soft delete.
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  actor_id    uuid references public.staff(id) on delete set null,
  action      text not null,              -- for example create, edit, delete
  table_name  text,
  row_id      uuid,
  summary     text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- sign-up questions and consent ----------

-- Answers to the six sign-up questions. shop_id is filled in once the shop exists.
create table if not exists public.signup_answers (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid not null references auth.users(id) on delete cascade,
  shop_id           uuid references public.shops(id) on delete cascade,
  shop_name         text,
  trade             text,                 -- textile, plastic, chemical, agri, other
  city              text,
  team_size         text,                 -- just_me, 2_5, 6_20, 20_plus
  problem           text,                 -- udhar, stock, accounts, staff, other
  udhar_customers   text,                 -- 0_10, 10_50, 50_plus
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Every time the person gives or takes back consent, one row is added.
create table if not exists public.consent_records (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  shop_id       uuid references public.shops(id) on delete cascade,
  granted       boolean not null,
  text_version  text not null,            -- which wording the person saw
  granted_at    timestamptz not null default now()
);

-- ---------- row level security and API access ----------
-- The Supabase project has "Grant API access to new tables automatically" OFF and
-- "Enable RLS on new tables automatically" ON. So this part does both jobs itself:
-- it turns Row Level Security on for every table, and it grants access to the
-- logged-in role only. The anonymous (not logged in) role gets nothing.

alter table public.shops           enable row level security;
alter table public.staff           enable row level security;
alter table public.products        enable row level security;
alter table public.customers       enable row level security;
alter table public.suppliers       enable row level security;
alter table public.bills           enable row level security;
alter table public.bill_items      enable row level security;
alter table public.udhar_entries   enable row level security;
alter table public.payments        enable row level security;
alter table public.expenses        enable row level security;
alter table public.audit_log       enable row level security;
alter table public.signup_answers  enable row level security;
alter table public.consent_records enable row level security;

-- Role check: is the logged-in user an active member of this shop, with one of the listed roles?
-- It is "security definer" so it can read the staff table without tripping the staff policies.
create or replace function public.has_shop_role(p_shop uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and s.shop_id = p_shop
      and s.role = any (p_roles)
  )
$$;

-- The owner saves the shop phone, UPI ID, address and assistant name. Owner only.
-- A null value keeps the old value; a blank value clears it. Light checks on length and characters.
create or replace function public.update_my_shop_profile(
  p_shop uuid, p_phone text, p_upi_id text, p_address text, p_assistant_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text := nullif(trim(p_phone), '');
  up text := nullif(trim(p_upi_id), '');
  ad text := nullif(trim(p_address), '');
  an text := nullif(trim(p_assistant_name), '');
begin
  if not public.has_shop_role(p_shop, array['owner']) then
    raise exception 'Only the owner can change the shop.';
  end if;

  if p_phone is not null and (length(ph) > 20 or ph !~ '^[0-9+() -]*$') then
    raise exception 'Please check the phone number.' using errcode = '22023';
  end if;
  if p_upi_id is not null and (length(up) > 100 or up !~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9]{2,32}$') then
    raise exception 'Please check the UPI ID. It should look like name@bank.' using errcode = '22023';
  end if;
  if p_address is not null and length(ad) > 200 then
    raise exception 'The address is too long. Keep it under 200 letters.' using errcode = '22023';
  end if;
  if p_assistant_name is not null and length(an) > 20 then
    raise exception 'The assistant name is too long. Keep it under 20 letters.' using errcode = '22023';
  end if;

  update public.shops
  set phone = case when p_phone is null then phone else ph end,
      upi_id = case when p_upi_id is null then upi_id else up end,
      address = case when p_address is null then address else ad end,
      assistant_name = case when p_assistant_name is null then assistant_name else an end
  where id = p_shop;
end;
$$;

-- Who may do what, table by table. Roles: owner, manager, cashier, stock-keeper, accountant.
--   read_r: who may see the rows
--   ins_r:  who may add rows
--   upd_r:  who may change rows (and soft-delete them, by setting deleted_at)
--   del_r:  who may really delete rows (owner and manager only)
-- An empty list {} means nobody. Every shop's rows are seen only by that shop's staff.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('products',      '{owner,manager,cashier,stock-keeper,accountant}', '{owner,manager,stock-keeper}', '{owner,manager,stock-keeper}', '{owner,manager}'),
      ('suppliers',     '{owner,manager,cashier,stock-keeper,accountant}', '{owner,manager,stock-keeper}', '{owner,manager,stock-keeper}', '{owner,manager}'),
      ('customers',     '{owner,manager,cashier,stock-keeper,accountant}', '{owner,manager,cashier}',     '{owner,manager,cashier}',     '{owner,manager}'),
      ('bills',         '{owner,manager,cashier,stock-keeper,accountant}', '{owner,manager,cashier}',     '{owner,manager}',             '{owner,manager}'),
      ('bill_items',    '{owner,manager,cashier,stock-keeper,accountant}', '{owner,manager,cashier}',     '{owner,manager}',             '{owner,manager}'),
      ('udhar_entries', '{owner,manager,cashier,stock-keeper,accountant}', '{owner,manager,cashier,accountant}', '{owner,manager,cashier,accountant}', '{owner,manager}'),
      ('payments',      '{owner,manager,cashier,stock-keeper,accountant}', '{owner,manager,cashier,accountant}', '{owner,manager,accountant}', '{owner,manager}'),
      ('expenses',      '{owner,manager,accountant}',                      '{owner,manager,accountant}',     '{owner,manager,accountant}',  '{owner,manager}'),
      ('audit_log',     '{owner,manager}',                                 '{owner,manager,cashier,stock-keeper,accountant}', '{}', '{}')
    ) as v(tbl, read_r, ins_r, upd_r, del_r)
  loop
    -- Drop the old policies first, so running this file again does not fail or leave a wider rule behind.
    execute format('drop policy if exists "shop staff access" on public.%I', c.tbl);
    execute format('drop policy if exists "shop read" on public.%I', c.tbl);
    execute format('drop policy if exists "shop add" on public.%I', c.tbl);
    execute format('drop policy if exists "shop change" on public.%I', c.tbl);
    execute format('drop policy if exists "shop remove" on public.%I', c.tbl);
    execute format('create policy "shop read" on public.%I for select to authenticated using (public.has_shop_role(shop_id, %L::text[]))', c.tbl, c.read_r);
    execute format('create policy "shop add" on public.%I for insert to authenticated with check (public.has_shop_role(shop_id, %L::text[]))', c.tbl, c.ins_r);
    execute format('create policy "shop change" on public.%I for update to authenticated using (public.has_shop_role(shop_id, %L::text[])) with check (public.has_shop_role(shop_id, %L::text[]))', c.tbl, c.upd_r, c.upd_r);
    execute format('create policy "shop remove" on public.%I for delete to authenticated using (public.has_shop_role(shop_id, %L::text[]))', c.tbl, c.del_r);
  end loop;
end
$$;

-- Shops and staff: staff can read their own shop and its staff list.
-- Changes to these go through the server, which holds the secret key.
drop policy if exists "shop staff can read shop" on public.shops;
create policy "shop staff can read shop" on public.shops
  for select to authenticated
  using (id in (select public.current_shop_ids()));

drop policy if exists "shop staff can read staff" on public.staff;
create policy "shop staff can read staff" on public.staff
  for select to authenticated
  using (shop_id in (select public.current_shop_ids()));

-- Sign-up answers: a person sees and saves only their own answers.
drop policy if exists "own signup answers" on public.signup_answers;
create policy "own signup answers" on public.signup_answers
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Consent records: a person can read their own records and add new ones.
-- Nobody can change or delete a consent record through the API, so the history stays complete.
drop policy if exists "own consent records" on public.consent_records;
drop policy if exists "own consent read" on public.consent_records;
drop policy if exists "own consent add" on public.consent_records;
create policy "own consent read" on public.consent_records
  for select to authenticated
  using (auth_user_id = auth.uid());
create policy "own consent add" on public.consent_records
  for insert to authenticated
  with check (auth_user_id = auth.uid());

-- ---------- grants ----------
-- Table access for the logged-in role only. The row rules above decide which rows.
-- Nothing is granted to the anonymous role, and the explicit revoke below makes sure of it.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;

grant select on public.shops, public.staff to authenticated;

grant select, insert, update, delete on
  public.products, public.suppliers, public.customers, public.bills, public.bill_items,
  public.udhar_entries, public.payments, public.expenses
  to authenticated;

grant select, insert on public.audit_log to authenticated;
grant select, insert, update on public.signup_answers to authenticated;
grant select, insert on public.consent_records to authenticated;

revoke execute on function public.current_shop_ids() from public, anon;
revoke execute on function public.has_shop_role(uuid, text[]) from public, anon;
grant execute on function public.current_shop_ids() to authenticated;
grant execute on function public.has_shop_role(uuid, text[]) to authenticated;

revoke all on function public.update_my_shop_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_my_shop_profile(uuid, text, text, text, text) to authenticated;

-- Business type (patch-04)
-- 2. Only the four listed values (or empty). Added only if it is not there yet.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shops_business_type_check') then
    alter table public.shops add constraint shops_business_type_check
      check (business_type is null or business_type in ('textile_trader', 'yarn_fabric', 'raw_material', 'other'));
  end if;
end $$;

-- 3. The owner can save the business type. A new function, so the older ones are unchanged.
create or replace function public.update_my_business_type(p_shop uuid, p_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bt text := nullif(trim(p_type), '');
begin
  if not public.has_shop_role(p_shop, array['owner']) then
    raise exception 'Only the owner can change the shop.';
  end if;
  if bt is not null and bt not in ('textile_trader', 'yarn_fabric', 'raw_material', 'other') then
    raise exception 'Please pick a business type from the list.' using errcode = '22023';
  end if;
  update public.shops set business_type = bt where id = p_shop;
end;
$$;

-- 4. Access: only people who have signed in can call this. Nobody else, not even the public key.
revoke all on function public.update_my_business_type(uuid, text) from public, anon;
grant execute on function public.update_my_business_type(uuid, text) to authenticated;


-- ============================================================
-- Folded from patch-01 (signup done flag, create_my_shop, update_my_shop)
-- ============================================================
-- BizGrow v2, patch 01: first-login shop set-up, owner shop edits, and the sign-up "finished" flag.
-- Run once in the Supabase SQL Editor for the BizGrow project, after schema.sql.
-- Safe to run again: every step checks first. Uses only the signed-in role. No secret keys.

-- 1. Sign-up answers get a "finished" flag (the six questions are done).
alter table public.signup_answers add column if not exists done boolean not null default false;

-- 2. First login: make the shop and the owner's staff row, once. Returns the shop id.
create or replace function public.create_my_shop(
  p_name text, p_trade text default null, p_city text default null,
  p_lang text default 'en', p_owner_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  em text;
  nm text;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;

  select s.shop_id into sid
  from public.staff s
  where s.auth_user_id = uid and s.active
  order by s.created_at
  limit 1;
  if sid is not null then
    return sid;
  end if;

  select u.email into em from auth.users u where u.id = uid;
  nm := coalesce(nullif(trim(p_owner_name), ''), split_part(coalesce(em, 'Owner'), '@', 1));

  insert into public.shops (name, trade, city, lang)
  values (coalesce(nullif(trim(p_name), ''), 'My shop'), nullif(p_trade, ''), nullif(trim(p_city), ''),
          coalesce(nullif(p_lang, ''), 'en'))
  returning id into sid;

  insert into public.staff (shop_id, auth_user_id, name, email, role, active)
  values (sid, uid, nm, em, 'owner', true);

  return sid;
end;
$$;

-- 3. The owner can change the shop name, trade, city and language. Blank values keep the old value.
create or replace function public.update_my_shop(
  p_shop uuid, p_name text, p_trade text, p_city text, p_lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_shop_role(p_shop, array['owner']) then
    raise exception 'Only the owner can change the shop.';
  end if;

  update public.shops
  set name = coalesce(nullif(trim(p_name), ''), name),
      trade = coalesce(nullif(p_trade, ''), trade),
      city = coalesce(nullif(trim(p_city), ''), city),
      lang = coalesce(nullif(p_lang, ''), lang)
  where id = p_shop;
end;
$$;

-- 4. Access: only people who have signed in can call these. Nobody else, not even the public key.
revoke all on function public.create_my_shop(text, text, text, text, text) from public, anon;
revoke all on function public.update_my_shop(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_my_shop(text, text, text, text, text) to authenticated;
grant execute on function public.update_my_shop(uuid, text, text, text, text) to authenticated;


-- ============================================================
-- Folded from patch-02 (shop phone, UPI ID, address, assistant name)
-- ============================================================
-- BizGrow v2, patch 02: shop phone, UPI ID, address and the Chotu assistant name.
-- Run once in the Supabase SQL Editor for the BizGrow project, after patch-01.
-- Safe to run again: every step checks first. Uses only the signed-in role. No secret keys.

-- 1. New columns on the shop row. Existing shops get empty values.
alter table public.shops add column if not exists phone text;
alter table public.shops add column if not exists upi_id text;
alter table public.shops add column if not exists address text;
alter table public.shops add column if not exists assistant_name text;

-- 2. The owner can save the four new fields. A new function, so update_my_shop (patch-01) is unchanged.
--    A null value keeps the old value. A blank value clears it (the assistant goes back to its usual name).
create or replace function public.update_my_shop_profile(
  p_shop uuid, p_phone text, p_upi_id text, p_address text, p_assistant_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text := nullif(trim(p_phone), '');
  up text := nullif(trim(p_upi_id), '');
  ad text := nullif(trim(p_address), '');
  an text := nullif(trim(p_assistant_name), '');
begin
  if not public.has_shop_role(p_shop, array['owner']) then
    raise exception 'Only the owner can change the shop.';
  end if;

  -- Light checks only: lengths, and the characters a phone number or UPI ID can use.
  if p_phone is not null and (length(ph) > 20 or ph !~ '^[0-9+() -]*$') then
    raise exception 'Please check the phone number.' using errcode = '22023';
  end if;
  if p_upi_id is not null and (length(up) > 100 or up !~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9]{2,32}$') then
    raise exception 'Please check the UPI ID. It should look like name@bank.' using errcode = '22023';
  end if;
  if p_address is not null and length(ad) > 200 then
    raise exception 'The address is too long. Keep it under 200 letters.' using errcode = '22023';
  end if;
  if p_assistant_name is not null and length(an) > 20 then
    raise exception 'The assistant name is too long. Keep it under 20 letters.' using errcode = '22023';
  end if;

  update public.shops
  set phone = case when p_phone is null then phone else ph end,
      upi_id = case when p_upi_id is null then upi_id else up end,
      address = case when p_address is null then address else ad end,
      assistant_name = case when p_assistant_name is null then assistant_name else an end
  where id = p_shop;
end;
$$;

-- 3. Access: only people who have signed in can call this. Nobody else, not even the public key.
revoke all on function public.update_my_shop_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_my_shop_profile(uuid, text, text, text, text) to authenticated;


-- ============================================================
-- Folded from patch-03 (Stage 2: bills, udhar, stock, expenses, staff, audit, reports)
-- ============================================================
-- BizGrow v2 Stage 2 (patch-03): real bills, udhar, stock, expenses, staff, audit and day reports.
-- Run this whole file once in the Supabase SQL editor (after schema.sql and patch-01/02).
-- It is safe to run again: every step checks whether it is already there first.
--
-- Plain-words rules:
--   * Money changes happen only through the functions below. Each one checks the
--     caller's role in that shop, changes the rows and writes an audit line in one go.
--     If any step fails, the whole change is undone (stock, bills, udhar, audit).
--   * Balance of a customer = unpaid part of their udhar bills, minus any advance they paid.
--   * Dates are Indian dates (IST), so a bill made at 1 a.m. counts for that day.

-- ---------- new columns (safe to add again) ----------

alter table public.shops     add column if not exists staff_discount_limit numeric(12,2) not null default 50;

alter table public.products  add column if not exists sku text;
alter table public.products  add column if not exists gst_rate numeric(5,2) not null default 0;
alter table public.products  add column if not exists hsn text;
alter table public.products  add column if not exists quick boolean not null default false;

alter table public.customers add column if not exists note text;
alter table public.customers add column if not exists advance numeric(12,2) not null default 0;

alter table public.bills     add column if not exists paid numeric(12,2) not null default 0;
alter table public.bills     add column if not exists due_date date;
alter table public.bills     add column if not exists sale_date date;
alter table public.bills     add column if not exists advance_used numeric(12,2) not null default 0;
alter table public.payments  add column if not exists bill_id uuid references public.bills(id) on delete set null;

alter table public.bill_items add column if not exists name text;
alter table public.bill_items add column if not exists cost numeric(12,2) not null default 0;

alter table public.expenses  add column if not exists method text;
alter table public.staff     add column if not exists deleted_at timestamptz;
alter table public.audit_log add column if not exists undone boolean not null default false;

-- Old bills (made before this patch) get their dates and paid amounts filled in once.
update public.bills set sale_date = (created_at at time zone 'Asia/Kolkata')::date where sale_date is null;
update public.bills set paid = total where paid = 0 and total > 0 and payment_mode in ('cash', 'upi');
update public.bill_items i set name = p.name from public.products p
  where i.name is null and p.id = i.product_id;
alter table public.bills alter column sale_date set default ((now() at time zone 'Asia/Kolkata')::date);
alter table public.bills alter column sale_date set not null;

-- ---------- new tables: tasks and pending staff invites ----------

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  title       text not null,
  due_on      date,
  priority    text not null default 'normal',
  done        boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- A person is invited by email. When they sign in with that email, claim_staff_invites() makes them staff.
create table if not exists public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id) on delete cascade,
  email       text not null,
  name        text not null,
  role        text not null check (role in ('manager', 'cashier', 'stock-keeper', 'accountant')),
  created_by  uuid references public.staff(id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.tasks         enable row level security;
alter table public.staff_invites enable row level security;

drop policy if exists "shop read" on public.tasks;
drop policy if exists "shop add" on public.tasks;
drop policy if exists "shop change" on public.tasks;
drop policy if exists "shop remove" on public.tasks;
create policy "shop read" on public.tasks for select to authenticated
  using (public.has_shop_role(shop_id, array['owner','manager','cashier','stock-keeper','accountant']));
create policy "shop add" on public.tasks for insert to authenticated
  with check (public.has_shop_role(shop_id, array['owner','manager']));
create policy "shop change" on public.tasks for update to authenticated
  using (public.has_shop_role(shop_id, array['owner','manager']))
  with check (public.has_shop_role(shop_id, array['owner','manager']));
create policy "shop remove" on public.tasks for delete to authenticated
  using (public.has_shop_role(shop_id, array['owner','manager']));

drop policy if exists "shop read" on public.staff_invites;
create policy "shop read" on public.staff_invites for select to authenticated
  using (public.has_shop_role(shop_id, array['owner','manager']));

-- ---------- small helper functions (not callable from the app) ----------

create or replace function public._ist_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Reads a number from text. Returns null when the text is not a plain number.
create or replace function public._num(p_text text)
returns numeric language sql immutable set search_path = public as $$
  select case when p_text ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then trim(p_text)::numeric end
$$;

create or replace function public._bill_label(p_no int)
returns text language sql immutable set search_path = public as $$
  select 'B' || lpad(p_no::text, 4, '0')
$$;

-- The caller's role in a shop (null when not an active member).
create or replace function public._my_role(p_shop uuid)
returns text language sql stable security definer set search_path = public as $$
  select s.role from public.staff s
  where s.shop_id = p_shop and s.auth_user_id = auth.uid() and s.active
  limit 1
$$;

-- The caller's staff row id in a shop (used for "who did it").
create or replace function public._actor(p_shop uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.id from public.staff s
  where s.shop_id = p_shop and s.auth_user_id = auth.uid() and s.active
  limit 1
$$;

-- Stops the call with a plain English message unless the caller has one of the roles.
create or replace function public._need(p_shop uuid, p_roles text[], p_msg text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Please log in again.' using errcode = '28000';
  end if;
  if p_shop is null or not public.has_shop_role(p_shop, p_roles) then
    raise exception '%', p_msg using errcode = '42501';
  end if;
end
$$;

-- One audit line. Written inside the same transaction as the change it describes.
create or replace function public._audit(p_shop uuid, p_action text, p_table text, p_row uuid, p_summary text)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (shop_id, actor_id, action, table_name, row_id, summary)
  values (p_shop, public._actor(p_shop), p_action, p_table, p_row, left(coalesce(p_summary, ''), 300))
$$;

-- What a customer owes: unpaid part of udhar bills, minus their advance.
create or replace function public._customer_balance(p_customer uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(
    coalesce((select sum(greatest(b.total - b.paid, 0)) from public.bills b
              where b.customer_id = p_customer and b.payment_mode = 'udhar' and b.deleted_at is null), 0)
    - coalesce((select c.advance from public.customers c where c.id = p_customer), 0), 2)
$$;

-- ---------- bills ----------

-- Makes a bill, takes stock out and writes the udhar entry for any unpaid part.
-- p_items: [{product_id, name, qty, price}]. method: cash, upi or udhar.
create or replace function public.create_sale(
  p_shop uuid, p_items jsonb, p_discount numeric, p_method text, p_customer_id uuid,
  p_paid numeric, p_due_date date, p_sale_date date, p_stock_override boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_qty numeric;
  v_price numeric;
  v_count int := 0;
  v_sub numeric := 0;
  v_disc numeric := coalesce(p_discount, 0);
  v_method text := lower(coalesce(nullif(trim(p_method), ''), 'cash'));
  v_total numeric;
  v_paid numeric;
  v_due numeric;
  v_today date := public._ist_today();
  v_date date := coalesce(p_sale_date, public._ist_today());
  v_due_date date;
  v_cust public.customers%rowtype;
  v_prod public.products%rowtype;
  v_limit numeric;
  v_bill_id uuid := gen_random_uuid();
  v_bill_no int;
  v_override boolean := coalesce(p_stock_override, false);
  v_advance_use numeric := 0;
  v_cash_now numeric := 0;
  v_stock_before numeric;
begin
  perform public._need(p_shop, array['owner','manager','cashier'], 'Your role cannot make bills. Ask the owner.');
  v_role := public._my_role(p_shop);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the bill';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'A bill can have at most 30 items. Split it into two bills.';
  end if;

  -- Pass 1: check every line and work out the subtotal. Nothing is changed yet.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := public._num(v_item->>'qty');
    v_price := public._num(v_item->>'price');
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be a number above 0'; end if;
    if v_qty > 9999 then raise exception 'Quantity is too large'; end if;
    if v_price is null or v_price <= 0 then raise exception 'Price must be a number above 0'; end if;
    v_pid := nullif(v_item->>'product_id', '')::uuid;
    if v_pid is not null then
      select * into v_prod from public.products
        where id = v_pid and shop_id = p_shop and deleted_at is null;
      if not found then
        raise exception '"%" is not in your stock list. Remove it and try again.', coalesce(v_item->>'name', 'An item');
      end if;
    else
      v_name := trim(coalesce(v_item->>'name', ''));
      if v_name = '' then raise exception 'Item name is needed'; end if;
      if length(v_name) > 60 then raise exception 'Item name is too long (max 60 letters)'; end if;
    end if;
    v_sub := v_sub + v_qty * v_price;
    v_count := v_count + 1;
  end loop;

  if v_disc < 0 then raise exception 'Discount must be 0 or more'; end if;
  if v_disc > v_sub then raise exception 'Discount cannot be more than the bill (%)', round(v_sub); end if;
  if v_disc > 0 and v_role = 'cashier' then
    select staff_discount_limit into v_limit from public.shops where id = p_shop;
    if v_disc > coalesce(v_limit, 50) then
      raise exception 'Discount above Rs % needs the owner. Ask the owner.', trunc(coalesce(v_limit, 50))
        using errcode = '42501';
    end if;
  end if;

  if v_method not in ('cash', 'upi', 'udhar') then raise exception 'Pick cash, UPI or udhar'; end if;
  v_total := round(v_sub - v_disc, 2);

  if p_customer_id is not null then
    select * into v_cust from public.customers
      where id = p_customer_id and shop_id = p_shop and deleted_at is null;
    if not found then
      if v_method = 'udhar' then raise exception 'Pick a customer for udhar'; end if;
      raise exception 'Customer not found';
    end if;
  end if;
  if v_method = 'udhar' and v_cust.id is null then raise exception 'Pick a customer for udhar'; end if;

  if v_date > v_today then raise exception 'The date cannot be in the future'; end if;
  if v_date < v_today and v_role not in ('owner', 'manager') then
    raise exception 'Only the owner or manager can back-date a bill' using errcode = '42501';
  end if;

  if v_method = 'udhar' then
    v_paid := least(v_total, greatest(coalesce(p_paid, 0), 0));
    v_cash_now := v_paid;
    -- Advance the customer already paid is used up first.
    if v_cust.advance > 0 and v_paid < v_total then
      v_advance_use := least(v_cust.advance, v_total - v_paid);
      v_paid := v_paid + v_advance_use;
      update public.customers set advance = advance - v_advance_use where id = v_cust.id;
    end if;
    v_due_date := coalesce(p_due_date, v_date + 30);
  else
    v_paid := v_total;
    v_due_date := null;
  end if;
  v_due := v_total - v_paid;

  -- Bill numbers are handed out one at a time per shop.
  perform 1 from public.shops where id = p_shop for update;
  select coalesce(max(b.bill_no), 0) + 1 into v_bill_no from public.bills b where b.shop_id = p_shop;

  insert into public.bills (id, shop_id, bill_no, customer_id, total, discount, payment_mode,
                            created_by, paid, due_date, sale_date, advance_used)
  values (v_bill_id, p_shop, v_bill_no, v_cust.id, v_total, v_disc, v_method,
          public._actor(p_shop), v_paid, v_due_date, v_date, v_advance_use);

  -- Money handed over at the counter on an udhar bill goes to the cash log too.
  if v_method = 'udhar' and v_cash_now > 0 then
    insert into public.payments (shop_id, customer_id, bill_id, amount, mode, paid_at, created_by)
    values (p_shop, v_cust.id, v_bill_id, v_cash_now, 'cash', now(), public._actor(p_shop));
  end if;

  -- Pass 2: take stock out line by line and save the lines.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := public._num(v_item->>'qty');
    v_price := public._num(v_item->>'price');
    v_pid := nullif(v_item->>'product_id', '')::uuid;
    if v_pid is not null then
      select * into v_prod from public.products
        where id = v_pid and shop_id = p_shop and deleted_at is null for update;
      v_stock_before := v_prod.stock_qty;
      if v_stock_before - v_qty < 0 and not v_override then
        raise exception 'Only % % of % left. The owner can allow more.',
          trim_scale(v_stock_before), coalesce(v_prod.unit, 'pc'), v_prod.name;
      end if;
      if v_stock_before - v_qty < 0 and v_role <> 'owner' then
        raise exception 'Only the owner can allow stock below zero' using errcode = '42501';
      end if;
      update public.products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into public.bill_items (shop_id, bill_id, product_id, name, qty, rate, amount, cost)
      values (p_shop, v_bill_id, v_pid, v_prod.name, v_qty, v_price, round(v_qty * v_price, 2), v_prod.buy_price);
    else
      insert into public.bill_items (shop_id, bill_id, product_id, name, qty, rate, amount, cost)
      values (p_shop, v_bill_id, null, trim(coalesce(v_item->>'name', '')), v_qty, v_price,
              round(v_qty * v_price, 2), 0);
    end if;
  end loop;

  if v_due > 0 then
    insert into public.udhar_entries (shop_id, customer_id, bill_id, amount, due_date, note)
    values (p_shop, v_cust.id, v_bill_id, v_due, v_due_date, 'Bill ' || public._bill_label(v_bill_no));
  end if;

  perform public._audit(p_shop, 'create', 'bills', v_bill_id,
    'Bill ' || public._bill_label(v_bill_no) || ' for ' || v_total);
  if v_disc > 0 then
    perform public._audit(p_shop, 'discount', 'bills', v_bill_id,
      'Discount ' || v_disc || ' on ' || public._bill_label(v_bill_no));
  end if;
  if v_date < v_today then
    perform public._audit(p_shop, 'back-date', 'bills', v_bill_id,
      'Back-dated ' || public._bill_label(v_bill_no) || ' to ' || v_date);
  end if;

  return jsonb_build_object('id', v_bill_id, 'bill_no', public._bill_label(v_bill_no), 'total', v_total,
    'paid', v_paid, 'due', v_due, 'method', v_method, 'date', v_date, 'due_date', v_due_date,
    'discount', v_disc, 'items', v_count);
end
$$;

-- Edit a bill: change the payment method and the customer (and the udhar due date).
-- Owner and manager only. Items are not changed here; delete and bill again for that.
create or replace function public.edit_sale(p_sale uuid, p_method text, p_customer_id uuid, p_due_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_method text;
  v_cust uuid;
  v_due numeric;
  v_paid numeric;
  v_adv numeric := 0;
begin
  select * into v_bill from public.bills where id = p_sale and deleted_at is null for update;
  if not found then raise exception 'Bill not found'; end if;
  perform public._need(v_bill.shop_id, array['owner','manager'], 'Only the owner or manager can edit a bill');

  v_method := lower(coalesce(nullif(trim(p_method), ''), v_bill.payment_mode));
  if v_method not in ('cash', 'upi', 'udhar') then raise exception 'Pick cash, UPI or udhar'; end if;
  v_cust := coalesce(p_customer_id, v_bill.customer_id);
  if p_customer_id is not null and not exists (
       select 1 from public.customers c
       where c.id = p_customer_id and c.shop_id = v_bill.shop_id and c.deleted_at is null) then
    raise exception 'Customer not found';
  end if;
  if v_method = 'udhar' and v_cust is null then raise exception 'Pick a customer for udhar'; end if;
  if v_method = 'udhar' and v_bill.payment_mode <> 'udhar' and v_bill.paid - v_bill.advance_used > 0 then
    raise exception 'Cash is already taken for this bill. Delete it and make a new udhar bill instead.';
  end if;

  if v_method = 'udhar' then
    if v_bill.payment_mode = 'udhar' then
      -- Still udhar: keep what was paid so far, and any advance already used.
      v_paid := v_bill.paid;
      v_adv := 0;
    else
      -- Switching from cash or UPI: nothing is counted as paid, the advance can cover part of it.
      if (select advance from public.customers where id = v_cust) > 0 then
        v_adv := least((select advance from public.customers where id = v_cust), v_bill.total);
        update public.customers set advance = advance - v_adv where id = v_cust;
      end if;
      v_paid := v_adv;
    end if;
    v_due := greatest(v_bill.total - v_paid, 0);
    update public.bills
      set payment_mode = 'udhar', customer_id = v_cust, paid = v_paid,
          advance_used = case when v_bill.payment_mode = 'udhar' then advance_used else v_adv end,
          due_date = coalesce(p_due_date, due_date, sale_date + 30)
      where id = v_bill.id;
  else
    -- Becoming cash or UPI: the bill counts as paid in full. Advance it already used stays used.
    v_due := 0;
    update public.bills
      set payment_mode = v_method, customer_id = v_cust, paid = total, due_date = null
      where id = v_bill.id;
  end if;

  update public.udhar_entries set deleted_at = now()
    where bill_id = v_bill.id and amount > 0 and deleted_at is null;
  if v_due > 0 then
    insert into public.udhar_entries (shop_id, customer_id, bill_id, amount, due_date, note)
    values (v_bill.shop_id, v_cust, v_bill.id, v_due,
            (select b.due_date from public.bills b where b.id = v_bill.id),
            'Bill ' || public._bill_label(v_bill.bill_no));
  end if;

  perform public._audit(v_bill.shop_id, 'edit', 'bills', v_bill.id,
    'Bill ' || public._bill_label(v_bill.bill_no) || ' changed to ' || v_method);

  select * into v_bill from public.bills where id = p_sale;
  return jsonb_build_object('id', v_bill.id, 'bill_no', public._bill_label(v_bill.bill_no),
    'method', v_bill.payment_mode, 'customer_id', v_bill.customer_id, 'total', v_bill.total,
    'paid', v_bill.paid, 'due', greatest(v_bill.total - v_bill.paid, 0));
end
$$;

-- Delete a bill (soft delete). Stock goes back on the shelf and the udhar is removed.
create or replace function public.delete_sale(p_sale uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
begin
  select * into v_bill from public.bills where id = p_sale and deleted_at is null for update;
  if not found then raise exception 'Bill not found'; end if;
  perform public._need(v_bill.shop_id, array['owner','manager'], 'Only the owner or manager can delete a bill');

  update public.bills set deleted_at = now() where id = v_bill.id;
  update public.products p set stock_qty = p.stock_qty + t.q
    from (select product_id, sum(qty) as q from public.bill_items
          where bill_id = v_bill.id and product_id is not null group by product_id) t
    where p.id = t.product_id;
  update public.udhar_entries set deleted_at = now() where bill_id = v_bill.id and deleted_at is null;
  if v_bill.payment_mode = 'udhar' then
    -- Money already taken on an udhar bill stays in the cash log and becomes the customer's advance.
    if v_bill.customer_id is not null and v_bill.paid > 0 then
      update public.customers set advance = advance + v_bill.paid where id = v_bill.customer_id;
    end if;
  else
    update public.payments set deleted_at = now() where bill_id = v_bill.id and deleted_at is null;
    if v_bill.advance_used > 0 and v_bill.customer_id is not null then
      update public.customers set advance = advance + v_bill.advance_used where id = v_bill.customer_id;
    end if;
  end if;

  perform public._audit(v_bill.shop_id, 'delete', 'bills', v_bill.id,
    'Bill ' || public._bill_label(v_bill.bill_no) || ' for ' || v_bill.total);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- udhar ----------

-- Records money received from a customer. It pays the oldest udhar bill first, then the next.
-- Anything left over becomes the customer's advance.
create or replace function public.record_udhar_payment(p_shop uuid, p_customer uuid, p_amount numeric, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(coalesce(nullif(trim(p_mode), ''), 'cash'));
  v_rest numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_cust_name text;
  v_b record;
begin
  perform public._need(p_shop, array['owner','manager','cashier','accountant'],
    'Your role cannot record payments. Ask the owner.');
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above 0.'; end if;
  if v_mode not in ('cash', 'upi', 'bank') then raise exception 'Pick cash, UPI or bank'; end if;
  select name into v_cust_name from public.customers
    where id = p_customer and shop_id = p_shop and deleted_at is null;
  if not found then raise exception 'Customer not found'; end if;

  v_rest := p_amount;
  for v_b in
    select b.id, b.bill_no, b.total, b.paid from public.bills b
    where b.shop_id = p_shop and b.customer_id = p_customer and b.payment_mode = 'udhar'
      and b.deleted_at is null and b.total > b.paid
    order by b.sale_date, b.bill_no
    for update
  loop
    exit when v_rest <= 0;
    v_take := least(v_b.total - v_b.paid, v_rest);
    update public.bills set paid = paid + v_take where id = v_b.id;
    insert into public.payments (shop_id, customer_id, bill_id, amount, mode, paid_at, created_by)
    values (p_shop, p_customer, v_b.id, v_take, v_mode, now(), public._actor(p_shop));
    insert into public.udhar_entries (shop_id, customer_id, bill_id, amount, note)
    values (p_shop, p_customer, v_b.id, -v_take, 'Payment ' || v_mode);
    v_rest := v_rest - v_take;
    v_applied := v_applied + v_take;
  end loop;

  if v_rest > 0 then
    update public.customers set advance = advance + v_rest where id = p_customer;
    insert into public.payments (shop_id, customer_id, bill_id, amount, mode, paid_at, created_by)
    values (p_shop, p_customer, null, v_rest, v_mode, now(), public._actor(p_shop));
    insert into public.udhar_entries (shop_id, customer_id, bill_id, amount, note)
    values (p_shop, p_customer, null, -v_rest, 'Advance');
  end if;

  perform public._audit(p_shop, 'edit', 'customers', p_customer,
    'Received ' || p_amount || ' from ' || v_cust_name);

  return jsonb_build_object('amount', p_amount, 'applied', v_applied,
    'advance_added', greatest(v_rest, 0), 'balance', public._customer_balance(p_customer));
end
$$;

-- ---------- customers ----------

create or replace function public.upsert_customer(
  p_shop uuid, p_id uuid, p_name text, p_phone text, p_city text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\s', '', 'g');
  v_id uuid;
begin
  perform public._need(p_shop, array['owner','manager','cashier'], 'Your role cannot add or change customers. Ask the owner.');
  if v_name = '' then raise exception 'Customer name is needed'; end if;
  if length(v_name) > 60 then raise exception 'Customer name is too long (max 60 letters)'; end if;
  if v_phone <> '' and v_phone !~ '^[0-9]{10}$' then raise exception 'Phone should be 10 digits'; end if;

  if p_id is null then
    insert into public.customers (shop_id, name, phone, city, note)
    values (p_shop, v_name, nullif(v_phone, ''), nullif(trim(coalesce(p_city, '')), ''),
            nullif(left(trim(coalesce(p_note, '')), 120), ''))
    returning id into v_id;
    perform public._audit(p_shop, 'create', 'customers', v_id, 'Customer ' || v_name);
  else
    update public.customers
      set name = v_name, phone = nullif(v_phone, ''), city = nullif(trim(coalesce(p_city, '')), ''),
          note = nullif(left(trim(coalesce(p_note, '')), 120), '')
      where id = p_id and shop_id = p_shop and deleted_at is null
      returning id into v_id;
    if v_id is null then raise exception 'Customer not found'; end if;
    perform public._audit(p_shop, 'edit', 'customers', v_id, 'Customer ' || v_name);
  end if;
  return v_id;
end
$$;

create or replace function public.delete_customer(p_customer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.customers%rowtype;
begin
  select * into v_c from public.customers where id = p_customer and deleted_at is null for update;
  if not found then raise exception 'Customer not found'; end if;
  perform public._need(v_c.shop_id, array['owner','manager'], 'Only the owner or manager can delete a customer');
  if public._customer_balance(p_customer) > 0 then
    raise exception 'This customer still owes money. Collect it first.';
  end if;
  update public.customers set deleted_at = now() where id = p_customer;
  perform public._audit(v_c.shop_id, 'delete', 'customers', p_customer, 'Customer ' || v_c.name);
  return jsonb_build_object('ok', true);
end
$$;

-- Customer list with balances (one call for the whole list).
create or replace function public.shop_customers(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  perform public._need(p_shop, array['owner','manager','cashier','stock-keeper','accountant'],
    'Your role cannot see customers.');
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'city', c.city, 'note', c.note,
      'advance', c.advance, 'balance', public._customer_balance(c.id),
      'last_credit', (select max(b.sale_date) from public.bills b
                      where b.customer_id = c.id and b.payment_mode = 'udhar' and b.deleted_at is null))
    order by c.name), '[]'::jsonb)
  into v_out
  from public.customers c where c.shop_id = p_shop and c.deleted_at is null;
  return v_out;
end
$$;

-- One customer with the ledger: udhar bills (credit) and payments, oldest first.
create or replace function public.customer_detail(p_customer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.customers%rowtype;
  v_ledger jsonb;
begin
  select * into v_c from public.customers where id = p_customer and deleted_at is null;
  if not found then raise exception 'Customer not found'; end if;
  perform public._need(v_c.shop_id, array['owner','manager','cashier','stock-keeper','accountant'],
    'Your role cannot see customers.');

  select coalesce(jsonb_agg(x.o order by x.ts), '[]'::jsonb) into v_ledger from (
    select b.created_at as ts, jsonb_build_object('kind', 'credit', 'amount', b.total,
      'created_at', b.created_at, 'note', public._bill_label(b.bill_no)) as o
    from public.bills b
    where b.customer_id = p_customer and b.payment_mode = 'udhar' and b.deleted_at is null
    union all
    select p.paid_at, jsonb_build_object('kind', 'payment', 'amount', p.amount,
      'created_at', p.paid_at, 'note', p.mode)
    from public.payments p
    where p.customer_id = p_customer and p.deleted_at is null and p.bill_id is null
  ) x;

  return jsonb_build_object(
    'customer', jsonb_build_object('id', v_c.id, 'name', v_c.name, 'phone', v_c.phone, 'city', v_c.city,
      'note', v_c.note, 'advance', v_c.advance, 'balance', public._customer_balance(p_customer),
      'last_credit', (select max(b.sale_date) from public.bills b
                      where b.customer_id = p_customer and b.payment_mode = 'udhar' and b.deleted_at is null)),
    'balance', public._customer_balance(p_customer),
    'ledger', v_ledger);
end
$$;

-- Udhar page: people who owe money, with their unpaid bills. Totals are hidden unless the viewer sees money.
create or replace function public.shop_udhar(p_shop uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := public._ist_today();
  v_people jsonb;
  v_total numeric;
  v_over numeric;
begin
  perform public._need(p_shop, array['owner','manager','cashier','stock-keeper','accountant'],
    'Your role cannot see udhar.');

  with due_bills as (
    select b.id, b.bill_no, b.customer_id, b.sale_date, b.due_date, b.total, b.paid,
           greatest(b.total - b.paid, 0) as due
    from public.bills b
    where b.shop_id = p_shop and b.deleted_at is null and b.payment_mode = 'udhar'
      and b.customer_id is not null and b.total > b.paid
  ),
  per as (
    select d.customer_id, sum(d.due) as dues, min(d.due_date) as oldest_due,
           max(case when d.due_date < v_today then v_today - d.due_date else 0 end) as dl
    from due_bills d group by d.customer_id
  ),
  rws as (
    select p.customer_id, c.name, c.phone, c.advance, p.oldest_due, p.dl,
           round(p.dues - c.advance, 2) as bal, (p.dl > 0) as ov,
           (select coalesce(jsonb_agg(jsonb_build_object('id', x.id,
                'bill_no', public._bill_label(x.bill_no), 'date', x.sale_date, 'due_date', x.due_date,
                'total', x.total, 'paid', x.paid, 'due', x.due,
                'days_late', case when x.due_date < v_today then v_today - x.due_date else 0 end)
              order by x.sale_date, x.bill_no), '[]'::jsonb)
            from due_bills x where x.customer_id = p.customer_id) as bills
    from per p join public.customers c on c.id = p.customer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', r.customer_id, 'name', r.name, 'phone', r.phone,
           'balance', r.bal, 'advance', r.advance, 'oldest_due', r.oldest_due, 'days_late', r.dl,
           'overdue', r.ov, 'bills', r.bills)
         order by r.ov desc, r.dl desc, r.bal desc) filter (where r.bal > 0), '[]'::jsonb),
         coalesce(sum(r.bal) filter (where r.bal > 0), 0),
         coalesce(sum(r.bal) filter (where r.bal > 0 and r.ov), 0)
  into v_people, v_total, v_over
  from rws r;

  return jsonb_build_object('total', v_total, 'overdue_total', v_over, 'people', v_people);
end
$$;

-- ---------- stock ----------

create or replace function public.upsert_product(
  p_shop uuid, p_id uuid, p_name text, p_category text, p_unit text,
  p_buy numeric, p_sell numeric, p_stock numeric, p_reorder numeric,
  p_sku text, p_gst numeric, p_hsn text, p_quick boolean, p_stock_override boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text := trim(coalesce(p_name, ''));
  v_old public.products%rowtype;
  v_id uuid;
  v_override boolean := coalesce(p_stock_override, false);
begin
  perform public._need(p_shop, array['owner','manager','stock-keeper'], 'Your role cannot change stock items. Ask the owner.');
  v_role := public._my_role(p_shop);

  if v_name = '' then raise exception 'Item name is needed'; end if;
  if length(v_name) > 60 then raise exception 'Item name is too long (max 60 letters)'; end if;
  if p_sell is null or p_sell <= 0 then raise exception 'Price must be a number above 0'; end if;
  if p_buy is null or p_buy < 0 then raise exception 'Cost must be 0 or more'; end if;
  if p_stock is null then raise exception 'Stock must be a number'; end if;
  if p_stock < 0 and not (v_override and v_role = 'owner') then
    raise exception 'Stock cannot go below zero. The owner can allow it.';
  end if;
  if coalesce(p_reorder, 0) < 0 then raise exception 'Reorder level must be 0 or more'; end if;
  if coalesce(p_gst, 0) < 0 or coalesce(p_gst, 0) > 100 then raise exception 'GST rate must be between 0 and 100'; end if;

  if p_id is null then
    insert into public.products (shop_id, name, category, unit, buy_price, sell_price, stock_qty, low_stock_at,
                                 sku, gst_rate, hsn, quick)
    values (p_shop, v_name, nullif(trim(coalesce(p_category, '')), ''),
            coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'pc'), p_buy, p_sell, p_stock,
            coalesce(p_reorder, 0), nullif(trim(coalesce(p_sku, '')), ''), coalesce(p_gst, 0),
            nullif(trim(coalesce(p_hsn, '')), ''), coalesce(p_quick, false))
    returning id into v_id;
    perform public._audit(p_shop, 'create', 'products', v_id,
      'Item ' || v_name || ' added with ' || trim_scale(p_stock) || ' in stock');
  else
    select * into v_old from public.products where id = p_id and shop_id = p_shop and deleted_at is null for update;
    if not found then raise exception 'Item not found'; end if;
    update public.products
      set name = v_name, category = nullif(trim(coalesce(p_category, '')), ''),
          unit = coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'pc'),
          buy_price = p_buy, sell_price = p_sell, stock_qty = p_stock,
          low_stock_at = coalesce(p_reorder, 0), sku = nullif(trim(coalesce(p_sku, '')), ''),
          gst_rate = coalesce(p_gst, 0), hsn = nullif(trim(coalesce(p_hsn, '')), ''),
          quick = coalesce(p_quick, false)
      where id = p_id
      returning id into v_id;
    perform public._audit(p_shop, 'edit', 'products', v_id,
      'Item ' || v_name || case when v_old.stock_qty <> p_stock
        then ', stock ' || trim_scale(v_old.stock_qty) || ' to ' || trim_scale(p_stock) else '' end);
  end if;
  return v_id;
end
$$;

-- Add or take out stock by a number, with a reason. The history is the audit log.
create or replace function public.adjust_product_stock(p_product uuid, p_change numeric, p_reason text, p_override boolean)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.products%rowtype;
  v_new numeric;
  v_role text;
begin
  select * into v_p from public.products where id = p_product and deleted_at is null for update;
  if not found then raise exception 'Item not found'; end if;
  perform public._need(v_p.shop_id, array['owner','manager','stock-keeper'], 'Your role cannot change stock. Ask the owner.');
  v_role := public._my_role(v_p.shop_id);
  if p_change is null or p_change = 0 then raise exception 'Enter how many to add or take out (not zero)'; end if;

  v_new := v_p.stock_qty + p_change;
  if v_new < 0 then
    if not coalesce(p_override, false) then
      raise exception 'Stock cannot go below zero. Only % % left. The owner can allow it.',
        trim_scale(v_p.stock_qty), coalesce(v_p.unit, 'pc');
    end if;
    if v_role <> 'owner' then
      raise exception 'Only the owner can allow stock below zero' using errcode = '42501';
    end if;
  end if;

  update public.products set stock_qty = v_new where id = p_product;
  perform public._audit(v_p.shop_id, 'edit', 'products', p_product,
    'Stock ' || trim_scale(v_p.stock_qty) || ' to ' || trim_scale(v_new) || ' (' ||
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'adjusted') || ')');
  return v_new;
end
$$;

create or replace function public.delete_product(p_product uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.products%rowtype;
begin
  select * into v_p from public.products where id = p_product and deleted_at is null for update;
  if not found then raise exception 'Item not found'; end if;
  perform public._need(v_p.shop_id, array['owner','manager'], 'Only the owner or manager can delete an item');
  update public.products set deleted_at = now() where id = p_product;
  perform public._audit(v_p.shop_id, 'delete', 'products', p_product, 'Item ' || v_p.name);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- expenses ----------

create or replace function public.add_expense(p_shop uuid, p_category text, p_amount numeric,
  p_date date, p_method text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_date date := coalesce(p_date, public._ist_today());
  v_cat text := coalesce(nullif(trim(coalesce(p_category, '')), ''), 'Other');
  v_method text := lower(coalesce(nullif(trim(coalesce(p_method, '')), ''), 'cash'));
begin
  perform public._need(p_shop, array['owner','manager','accountant'], 'Your role cannot add expenses. Ask the owner.');
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be a number above 0'; end if;
  if v_date > public._ist_today() then raise exception 'The date cannot be in the future'; end if;
  if v_method not in ('cash', 'upi', 'bank') then raise exception 'Pick cash, UPI or bank'; end if;

  insert into public.expenses (shop_id, category, amount, note, spent_on, created_by, method)
  values (p_shop, v_cat, p_amount, nullif(left(trim(coalesce(p_note, '')), 200), ''), v_date,
          public._actor(p_shop), v_method)
  returning id into v_id;
  perform public._audit(p_shop, 'create', 'expenses', v_id, 'Expense ' || v_cat || ' ' || p_amount);
  return v_id;
end
$$;

create or replace function public.delete_expense(p_expense uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.expenses%rowtype;
begin
  select * into v_e from public.expenses where id = p_expense and deleted_at is null for update;
  if not found then raise exception 'Expense not found'; end if;
  perform public._need(v_e.shop_id, array['owner','manager'], 'Only the owner or manager can delete an expense');
  update public.expenses set deleted_at = now() where id = p_expense;
  perform public._audit(v_e.shop_id, 'delete', 'expenses', p_expense, 'Expense ' || coalesce(v_e.category, '') || ' ' || v_e.amount);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- staff ----------

-- Owner invites anyone; manager can invite only cashier, stock-keeper and accountant.
create or replace function public.invite_staff(p_shop uuid, p_name text, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
begin
  perform public._need(p_shop, array['owner','manager'], 'Only the owner can invite staff');
  v_role := public._my_role(p_shop);
  if p_role is null or p_role not in ('manager', 'cashier', 'stock-keeper', 'accountant') then
    raise exception 'Pick a role';
  end if;
  if v_role = 'manager' and p_role = 'manager' then
    raise exception 'Only the owner can add a manager' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'Name is needed'; end if;
  if length(v_name) > 60 then raise exception 'Name is too long (max 60 letters)'; end if;
  if v_email !~ '^\S+@\S+\.\S+$' then raise exception 'Enter a valid email'; end if;
  if exists (select 1 from public.staff s where s.shop_id = p_shop and lower(s.email) = v_email and s.active)
     or exists (select 1 from public.staff_invites i where i.shop_id = p_shop and lower(i.email) = v_email and i.claimed_at is null) then
    raise exception 'That email is already added';
  end if;

  insert into public.staff_invites (shop_id, email, name, role, created_by)
  values (p_shop, v_email, v_name, p_role, public._actor(p_shop))
  returning id into v_id;
  perform public._audit(p_shop, 'create', 'staff', v_id, 'Invited ' || v_name || ' as ' || p_role);
  return v_id;
end
$$;

-- Called when a signed-in person has a pending invite. Turns the invite into a staff row.
create or replace function public.claim_staff_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n int := 0;
  r record;
begin
  if v_uid is null or v_email = '' then return 0; end if;
  for r in select * from public.staff_invites where lower(email) = v_email and claimed_at is null loop
    insert into public.staff (shop_id, auth_user_id, name, email, role, active, deleted_at)
    values (r.shop_id, v_uid, r.name, v_email, r.role, true, null)
    on conflict (shop_id, auth_user_id)
      do update set role = excluded.role, active = true, deleted_at = null, name = excluded.name;
    update public.staff_invites set claimed_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- Change a role and/or suspend or activate a person. Owner: anyone except the owner.
-- Manager: only cashier, stock-keeper and accountant.
create or replace function public.update_staff(p_staff uuid, p_role text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.staff%rowtype;
  v_role text;
begin
  select * into v_t from public.staff where id = p_staff and deleted_at is null for update;
  if not found then raise exception 'Person not found'; end if;
  perform public._need(v_t.shop_id, array['owner','manager'], 'Only the owner or manager can change staff');
  v_role := public._my_role(v_t.shop_id);

  if v_t.role = 'owner' then
    raise exception 'The owner cannot be suspended or changed' using errcode = '42501';
  end if;
  if v_t.auth_user_id = auth.uid() and (p_active = false or (p_role is not null and p_role <> v_t.role)) then
    raise exception 'You cannot suspend or change your own role.' using errcode = '42501';
  end if;
  if v_role = 'manager' and v_t.role = 'manager' then
    raise exception 'Only the owner can change a manager' using errcode = '42501';
  end if;
  if p_role is not null then
    if p_role not in ('manager', 'cashier', 'stock-keeper', 'accountant') then raise exception 'Pick a role'; end if;
    if v_role = 'manager' and p_role = 'manager' then
      raise exception 'Only the owner can make a manager' using errcode = '42501';
    end if;
    if p_role <> v_t.role then
      update public.staff set role = p_role where id = p_staff;
      perform public._audit(v_t.shop_id, 'role change', 'staff', p_staff, v_t.name || ' is now ' || p_role);
    end if;
  end if;
  if p_active is not null and p_active <> v_t.active then
    update public.staff set active = p_active where id = p_staff;
    perform public._audit(v_t.shop_id, 'edit', 'staff', p_staff,
      v_t.name || case when p_active then ' activated' else ' suspended' end);
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Remove a person (soft delete: they lose access; the audit undo can bring them back).
create or replace function public.remove_staff(p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.staff%rowtype;
  v_role text;
begin
  select * into v_t from public.staff where id = p_staff and deleted_at is null for update;
  if not found then raise exception 'Person not found'; end if;
  perform public._need(v_t.shop_id, array['owner','manager'], 'Only the owner or manager can remove staff');
  v_role := public._my_role(v_t.shop_id);
  if v_t.role = 'owner' then raise exception 'The owner cannot be removed' using errcode = '42501'; end if;
  if v_t.auth_user_id = auth.uid() then raise exception 'You cannot remove yourself.' using errcode = '42501'; end if;
  if v_role = 'manager' and v_t.role = 'manager' then
    raise exception 'Only the owner can remove a manager' using errcode = '42501';
  end if;
  update public.staff set active = false, deleted_at = now() where id = p_staff;
  perform public._audit(v_t.shop_id, 'delete', 'staff', p_staff, 'Removed ' || v_t.name);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- audit undo ----------

-- Undo a delete. Bills give back their stock and udhar; other rows simply come back.
-- Only the delete made in the same change can be undone (matched by time), and only once.
create or replace function public.undo_audit(p_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.audit_log%rowtype;
begin
  select * into v_a from public.audit_log where id = p_entry;
  if not found then raise exception 'Entry not found'; end if;
  perform public._need(v_a.shop_id, array['owner','manager'], 'Only the owner or manager can undo');
  if v_a.undone then raise exception 'Already undone'; end if;
  if v_a.action <> 'delete' then raise exception 'Nothing to undo'; end if;

  if v_a.table_name = 'bills' then
    update public.bills set deleted_at = null where id = v_a.row_id and deleted_at = v_a.created_at;
    if not found then raise exception 'Nothing to undo'; end if;
    update public.products p set stock_qty = p.stock_qty - t.q
      from (select product_id, sum(qty) as q from public.bill_items
            where bill_id = v_a.row_id and product_id is not null group by product_id) t
      where p.id = t.product_id;
    update public.udhar_entries set deleted_at = null
      where bill_id = v_a.row_id and deleted_at = v_a.created_at;
    update public.payments set deleted_at = null
      where bill_id = v_a.row_id and deleted_at = v_a.created_at;
    update public.customers c set advance = c.advance - (case when b.payment_mode = 'udhar' then b.paid else b.advance_used end)
      from public.bills b
      where b.id = v_a.row_id and c.id = b.customer_id
        and (case when b.payment_mode = 'udhar' then b.paid else b.advance_used end) > 0;
  elsif v_a.table_name = 'products' then
    update public.products set deleted_at = null where id = v_a.row_id and deleted_at = v_a.created_at;
  elsif v_a.table_name = 'customers' then
    update public.customers set deleted_at = null where id = v_a.row_id and deleted_at = v_a.created_at;
  elsif v_a.table_name = 'expenses' then
    update public.expenses set deleted_at = null where id = v_a.row_id and deleted_at = v_a.created_at;
  elsif v_a.table_name = 'staff' then
    update public.staff set deleted_at = null, active = true
      where id = v_a.row_id and deleted_at = v_a.created_at;
  else
    raise exception 'Nothing to undo';
  end if;
  if not found then raise exception 'Nothing to undo'; end if;

  update public.audit_log set undone = true where id = p_entry;
  perform public._audit(v_a.shop_id, 'undo', v_a.table_name, v_a.row_id, 'Undid: ' || coalesce(v_a.summary, ''));
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- day summary (the owner's evening summary, the Z report and the dashboard) ----------

create or replace function public.day_summary(p_shop uuid, p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop_name text;
  v_bills int := 0;
  v_sales numeric := 0;
  v_cash numeric := 0;
  v_upi numeric := 0;
  v_udhar_added numeric := 0;
  v_credit numeric := 0;
  v_disc numeric := 0;
  v_paid_bills numeric := 0;
  v_rec numeric := 0;
  v_rec_cash numeric := 0;
  v_counter numeric := 0;
  v_exp numeric := 0;
  v_exp_cash numeric := 0;
  v_profit numeric := 0;
  v_edits int := 0;
  v_deletes int := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  perform public._need(p_shop, array['owner','manager','accountant'],
    'Only the owner, manager or accountant can see the day summary.');
  select name into v_shop_name from public.shops where id = p_shop;

  select count(*), coalesce(sum(b.total), 0),
         coalesce(sum(b.paid - b.advance_used - coalesce((select sum(p.amount) from public.payments p
                  where p.bill_id = b.id and p.deleted_at is null), 0)) filter (where b.payment_mode = 'cash'), 0),
         coalesce(sum(b.paid - b.advance_used - coalesce((select sum(p.amount) from public.payments p
                  where p.bill_id = b.id and p.deleted_at is null), 0)) filter (where b.payment_mode = 'upi'), 0),
         coalesce(sum(b.total) filter (where b.payment_mode = 'udhar'), 0),
         coalesce(sum(greatest(b.total - b.paid, 0)) filter (where b.payment_mode = 'udhar'), 0),
         coalesce(sum(b.discount), 0), coalesce(sum(b.paid) filter (where b.payment_mode <> 'udhar'), 0)
    into v_bills, v_sales, v_cash, v_upi, v_udhar_added, v_credit, v_disc, v_paid_bills
    from public.bills b
    where b.shop_id = p_shop and b.deleted_at is null and b.sale_date = p_date;

  select coalesce(sum(i.amount - i.qty * i.cost), 0) into v_profit
    from public.bill_items i join public.bills b on b.id = i.bill_id
    where b.shop_id = p_shop and b.deleted_at is null and b.sale_date = p_date;

  -- Money in today: all payments logged today (udhar bills' counter payments and later recoveries).
  -- Recovered = the later ones only, so nothing is counted twice.
  select coalesce(sum(p.amount) filter (where p.bill_id is null), 0),
         coalesce(sum(p.amount) filter (where p.mode = 'cash'), 0)
    into v_rec, v_rec_cash
    from public.payments p
    where p.shop_id = p_shop and p.deleted_at is null
      and (p.paid_at at time zone 'Asia/Kolkata')::date = p_date;
  select coalesce(sum(p.amount), 0) into v_counter
    from public.payments p
    where p.shop_id = p_shop and p.deleted_at is null and p.bill_id is not null
      and (p.paid_at at time zone 'Asia/Kolkata')::date = p_date;

  select coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.method = 'cash'), 0)
    into v_exp, v_exp_cash
    from public.expenses e
    where e.shop_id = p_shop and e.deleted_at is null and e.spent_on = p_date;
  v_profit := v_profit - v_exp;

  select count(*) filter (where a.action in ('edit', 'role change')),
         count(*) filter (where a.action = 'delete')
    into v_edits, v_deletes
    from public.audit_log a
    where a.shop_id = p_shop and not a.undone and (a.created_at at time zone 'Asia/Kolkata')::date = p_date;

  select coalesce(jsonb_agg(x.line), '[]'::jsonb) into v_lines from (
    select coalesce(s.name, 'Someone') || ': ' || a.summary as line, a.created_at
    from public.audit_log a left join public.staff s on s.id = a.actor_id
    where a.shop_id = p_shop and not a.undone and a.action = 'delete'
      and (a.created_at at time zone 'Asia/Kolkata')::date = p_date
    order by a.created_at desc limit 5
  ) x;

  return jsonb_build_object(
    'date', p_date, 'shop', v_shop_name,
    'bills', v_bills, 'sales', v_sales, 'profit', v_profit,
    'cash_sales', v_cash, 'upi_sales', v_upi,
    'udhar_added', v_udhar_added, 'credit_given', v_credit,
    'discounts_given', v_disc,
    'payments_recovered', v_rec, 'udhar_cash', v_rec_cash,
    'collected', v_cash + v_upi + v_rec + v_counter,
    'expenses', v_exp, 'expenses_cash', v_exp_cash,
    'cash_in_hand', v_cash + v_rec_cash - v_exp_cash,
    'edits', v_edits, 'deletes', v_deletes, 'delete_lines', v_lines);
end
$$;

-- ---------- erase (owner only, the app asks the owner to type DELETE) ----------

create or replace function public.erase_shop(p_shop uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._need(p_shop, array['owner'], 'Only the owner can delete data.');
  if trim(coalesce(p_confirm, '')) <> 'DELETE' then raise exception 'Type DELETE to confirm'; end if;
  delete from public.shops where id = p_shop;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- grants ----------
-- Only the logged-in role can run these. The anonymous role gets nothing.

revoke all on function public._ist_today(), public._num(text), public._bill_label(int),
  public._my_role(uuid), public._actor(uuid), public._need(uuid, text[], text),
  public._audit(uuid, text, text, uuid, text), public._customer_balance(uuid)
  from public, anon, authenticated;

revoke all on function
  public.create_sale(uuid, jsonb, numeric, text, uuid, numeric, date, date, boolean),
  public.edit_sale(uuid, text, uuid, date),
  public.delete_sale(uuid),
  public.record_udhar_payment(uuid, uuid, numeric, text),
  public.upsert_customer(uuid, uuid, text, text, text, text),
  public.delete_customer(uuid),
  public.shop_customers(uuid),
  public.customer_detail(uuid),
  public.shop_udhar(uuid),
  public.upsert_product(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, numeric, text, boolean, boolean),
  public.adjust_product_stock(uuid, numeric, text, boolean),
  public.delete_product(uuid),
  public.add_expense(uuid, text, numeric, date, text, text),
  public.delete_expense(uuid),
  public.invite_staff(uuid, text, text, text),
  public.claim_staff_invites(),
  public.update_staff(uuid, text, boolean),
  public.remove_staff(uuid),
  public.undo_audit(uuid),
  public.day_summary(uuid, date),
  public.erase_shop(uuid, text)
  from public, anon;

grant execute on function
  public.create_sale(uuid, jsonb, numeric, text, uuid, numeric, date, date, boolean),
  public.edit_sale(uuid, text, uuid, date),
  public.delete_sale(uuid),
  public.record_udhar_payment(uuid, uuid, numeric, text),
  public.upsert_customer(uuid, uuid, text, text, text, text),
  public.delete_customer(uuid),
  public.shop_customers(uuid),
  public.customer_detail(uuid),
  public.shop_udhar(uuid),
  public.upsert_product(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, numeric, text, boolean, boolean),
  public.adjust_product_stock(uuid, numeric, text, boolean),
  public.delete_product(uuid),
  public.add_expense(uuid, text, numeric, date, text, text),
  public.delete_expense(uuid),
  public.invite_staff(uuid, text, text, text),
  public.claim_staff_invites(),
  public.update_staff(uuid, text, boolean),
  public.remove_staff(uuid),
  public.undo_audit(uuid),
  public.day_summary(uuid, date),
  public.erase_shop(uuid, text)
  to authenticated;

grant select, insert, update, delete on public.tasks to authenticated;
grant select on public.staff_invites to authenticated;

-- Folded from patch-06 (online store). Same content as supabase/patch-06.sql.
-- Safe to run more than once.

alter table public.shops add column if not exists store_enabled boolean not null default false;
alter table public.shops add column if not exists store_slug text;
create unique index if not exists shops_store_slug_key on public.shops (store_slug);

create table if not exists public.store_orders (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id) on delete cascade,
  customer_name  text not null,
  customer_phone text not null,
  note           text,
  status         text not null default 'new'
                 check (status in ('new', 'accepted', 'packed', 'delivered', 'cancelled')),
  item_count     int not null default 0,
  total          numeric(12,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists store_orders_shop_idx on public.store_orders (shop_id, created_at desc);

create table if not exists public.store_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.store_orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  unit        text,
  price       numeric(12,2) not null default 0,
  qty         numeric(12,3) not null default 0,
  line_total  numeric(12,2) not null default 0
);
create index if not exists store_order_items_order_idx on public.store_order_items (order_id);

-- No policies: the tables are reached only through the functions below.
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;
revoke all on public.store_orders, public.store_order_items from anon, authenticated;

-- A short, unique store link name, for example "rajesh-textiles-4f9a2c".
create or replace function public._store_slug(p_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(
           nullif(trim(both '-' from left(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), 30)), ''),
           'shop')
         || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
$$;

-- Anonymous: the public store. Only for shops that turned the store on.
-- Returns selling prices and in-stock items. Never cost prices, never customers.
create or replace function public.public_store_catalogue(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.shops%rowtype;
  v_items jsonb;
begin
  select * into v_s from public.shops
   where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'name', q.name, 'category', q.category, 'unit', q.unit, 'price', q.price)
           order by q.name), '[]'::jsonb)
    into v_items
    from (
      select p.id, p.name, p.category, p.unit, p.sell_price as price
        from public.products p
       where p.shop_id = v_s.id and p.deleted_at is null and p.stock_qty > 0
       order by p.name
       limit 300
    ) q;
  return jsonb_build_object(
    'found', true,
    'shop', jsonb_build_object('name', v_s.name, 'phone', v_s.phone, 'city', v_s.city, 'lang', v_s.lang),
    'items', v_items);
end
$$;

-- Anonymous: place an order from the public store. Checks the input and limits
-- how often one number and one shop can send orders. Prices come from the shop's
-- own product list, never from the browser.
create or replace function public.place_store_order(
  p_slug text, p_name text, p_phone text, p_note text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.shops%rowtype;
  v_p public.products%rowtype;
  v_it jsonb;
  v_name text := left(trim(coalesce(p_name, '')), 60);
  v_phone text := regexp_replace(left(coalesce(p_phone, ''), 40), '[^0-9]', '', 'g');
  v_note text := left(trim(coalesce(p_note, '')), 300);
  v_order uuid;
  v_qty numeric;
  v_line numeric;
  v_count int := 0;
  v_total numeric := 0;
  v_recent int;
begin
  select * into v_s from public.shops
   where store_slug = nullif(trim(coalesce(p_slug, '')), '') and store_enabled;
  if not found then
    raise exception 'This store is not open right now';
  end if;
  if length(v_name) < 2 then
    raise exception 'Please enter your name';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 13 then
    raise exception 'Please enter a valid phone number';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'Too many items in one order';
  end if;

  select count(*) into v_recent from public.store_orders
   where shop_id = v_s.id and customer_phone = v_phone and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'Too many orders from this number. Please wait a few minutes.';
  end if;
  select count(*) into v_recent from public.store_orders
   where shop_id = v_s.id and created_at > now() - interval '1 hour';
  if v_recent >= 300 then
    raise exception 'This store is busy. Please try again later.';
  end if;

  insert into public.store_orders (shop_id, customer_name, customer_phone, note)
  values (v_s.id, v_name, v_phone, nullif(v_note, ''))
  returning id into v_order;

  for v_it in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_it->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Some items are no longer available. Please refresh the store and try again.';
    end if;
    if coalesce(v_it->>'qty', '') !~ '^[0-9]{1,4}(\.[0-9]{1,3})?$' then
      raise exception 'Please check the quantities';
    end if;
    v_qty := (v_it->>'qty')::numeric;
    if v_qty <= 0 or v_qty > 9999 then
      raise exception 'Please check the quantities';
    end if;
    select * into v_p from public.products
     where id = (v_it->>'product_id')::uuid
       and shop_id = v_s.id and deleted_at is null and stock_qty > 0;
    if not found then
      raise exception 'Some items are no longer in stock. Please refresh the store and try again.';
    end if;
    v_line := round(v_p.sell_price * v_qty, 2);
    insert into public.store_order_items (order_id, product_id, name, unit, price, qty, line_total)
    values (v_order, v_p.id, v_p.name, v_p.unit, v_p.sell_price, v_qty, v_line);
    v_count := v_count + 1;
    v_total := v_total + v_line;
  end loop;

  update public.store_orders set item_count = v_count, total = v_total where id = v_order;
  return jsonb_build_object(
    'ok', true,
    'ref', upper(substr(md5(v_order::text), 1, 6)),
    'item_count', v_count,
    'total', v_total);
end
$$;

-- Owner, manager or cashier: the shop's orders, newest first, with the count of new ones.
create or replace function public.list_store_orders(p_shop uuid, p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_new int;
begin
  perform public._need(p_shop, array['owner', 'manager', 'cashier'], 'Only the owner, manager or cashier can see orders');
  if p_status is not null and p_status not in ('new', 'accepted', 'packed', 'delivered', 'cancelled') then
    raise exception 'Unknown order status';
  end if;
  select count(*) into v_new from public.store_orders where shop_id = p_shop and status = 'new';
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id,
           'ref', upper(substr(md5(q.id::text), 1, 6)),
           'name', q.customer_name,
           'phone', q.customer_phone,
           'note', q.note,
           'status', q.status,
           'item_count', q.item_count,
           'total', q.total,
           'created_at', q.created_at,
           'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                       'name', i.name, 'unit', i.unit, 'price', i.price,
                       'qty', i.qty, 'line_total', i.line_total) order by i.name), '[]'::jsonb)
                       from public.store_order_items i where i.order_id = q.id))
           order by q.created_at desc), '[]'::jsonb)
    into v_items
    from (
      select o.* from public.store_orders o
       where o.shop_id = p_shop and (p_status is null or o.status = p_status)
       order by o.created_at desc
       limit 200
    ) q;
  return jsonb_build_object('items', v_items, 'new_count', v_new);
end
$$;

-- Owner, manager or cashier: move an order to a new status.
create or replace function public.set_store_order_status(p_order uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.store_orders%rowtype;
begin
  select * into v_o from public.store_orders where id = p_order for update;
  if not found then
    raise exception 'Order not found';
  end if;
  perform public._need(v_o.shop_id, array['owner', 'manager', 'cashier'], 'Only the owner, manager or cashier can change orders');
  if p_status not in ('new', 'accepted', 'packed', 'delivered', 'cancelled') then
    raise exception 'Unknown order status';
  end if;
  update public.store_orders set status = p_status, updated_at = now() where id = p_order;
  perform public._audit(v_o.shop_id, 'edit', 'store_orders', p_order,
    'Order ' || upper(substr(md5(p_order::text), 1, 6)) || ' marked ' || p_status);
  return jsonb_build_object('ok', true, 'status', p_status);
end
$$;

-- Owner only: turn the online store on or off. The link name is made once and kept.
create or replace function public.set_store_enabled(p_shop uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_on boolean := coalesce(p_enabled, false);
begin
  perform public._need(p_shop, array['owner'], 'Only the owner can turn the online store on or off');
  update public.shops
     set store_enabled = v_on,
         store_slug = coalesce(store_slug, public._store_slug(name))
   where id = p_shop
   returning store_slug into v_slug;
  if not found then
    raise exception 'Shop not found';
  end if;
  perform public._audit(p_shop, 'edit', 'shops', p_shop,
    case when v_on then 'Online store turned on' else 'Online store turned off' end);
  return jsonb_build_object('ok', true, 'store_enabled', v_on, 'store_slug', v_slug);
end
$$;

-- Grants: anonymous visitors may only read the public store and place an order.
grant usage on schema public to anon;
revoke all on function public._store_slug(text) from public, anon, authenticated;

revoke all on function public.public_store_catalogue(text) from public;
grant execute on function public.public_store_catalogue(text) to anon, authenticated;

revoke all on function public.place_store_order(text, text, text, text, jsonb) from public;
grant execute on function public.place_store_order(text, text, text, text, jsonb) to anon, authenticated;

revoke all on function public.list_store_orders(uuid, text) from public, anon;
grant execute on function public.list_store_orders(uuid, text) to authenticated;

revoke all on function public.set_store_order_status(uuid, text) from public, anon;
grant execute on function public.set_store_order_status(uuid, text) to authenticated;

revoke all on function public.set_store_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_store_enabled(uuid, boolean) to authenticated;
