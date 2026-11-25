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
