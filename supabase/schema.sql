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
  created_at  timestamptz not null default now()
);

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
