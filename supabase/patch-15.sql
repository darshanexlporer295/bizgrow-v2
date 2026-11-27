-- patch-15: promo codes, the platform owner, and online payment for plan upgrades.
-- Run after patch-14 (plans, shops.plan). Safe to run more than once. Nothing existing is deleted.
--
-- What changes:
--   * plans.price_paise: the price of a plan in paise (100 paise = Rs 1). Null = not sold online.
--     ASSUMED PRICES, please check and change them: Growth Rs 499 and All Features Rs 999, per 30 days.
--   * shops: plan_until (when a time-limited plan ends) and plan_base (the plan to go back to). Null plan_until = no end.
--   * platform_admins: the BizGrow platform owner(s). Only they can create, list or switch off promo codes.
--     Seed yourself with supabase/make-platform-owner.sql (one line to edit, run once in the SQL Editor).
--   * promo_codes, promo_redemptions: a code gives a plan for N days (or for good), with a limit on uses.
--     One use per shop per code. Redeeming is atomic (row lock), so the limit cannot be passed by two people at once.
--   * promo_attempts: counts tries per person so codes cannot be guessed (10 tries per 15 minutes).
--   * plan_payments: one row per online payment attempt. Only the Worker (service key) can write it.
--     No card data is stored here. Razorpay keeps card details.
--   * Changing a shop's plan is allowed only inside these functions (not by the app directly).
--
-- Nothing here is readable or writable by shop owners except through the functions below.

-- ---------- 1. prices and plan end dates ----------
alter table public.plans add column if not exists price_paise int check (price_paise is null or price_paise >= 0);
-- ASSUMED prices (set once, only where no price is set yet):
update public.plans set price_paise = 49900 where code = 'growth' and price_paise is null;  -- ASSUMED Rs 499 / 30 days
update public.plans set price_paise = 99900 where code = 'all'    and price_paise is null;  -- ASSUMED Rs 999 / 30 days

alter table public.shops add column if not exists plan_until timestamptz;
alter table public.shops add column if not exists plan_base  text references public.plans(code);

-- ---------- 2. the plan guard: only our own functions may change plan fields ----------
-- Replaces the guard from patch-14 with the same rules, plus: plan, plan_base and plan_until
-- can change only inside the functions in this file (they set bizgrow.plan_change = on).
create or replace function public._plan_guard_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.plan, new.plan_base, new.plan_until) is distinct from (old.plan, old.plan_base, old.plan_until)
     and auth.uid() is not null
     and coalesce(current_setting('bizgrow.plan_change', true), '') <> 'on' then
    raise exception 'Only BizGrow can change the plan. Ask for an upgrade instead.' using errcode = '42501';
  end if;
  if new.store_enabled and (tg_op = 'INSERT' or not old.store_enabled)
     and not (select p.online_store from public.plans p where p.code = new.plan) then
    raise exception 'The online store is not on your plan. Ask BizGrow about upgrading.' using errcode = '42501';
  end if;
  return new;
end
$$;

-- The plan a shop is on right now. After plan_until passes, it is the plan_base (read-only, so it can be used in checks).
create or replace function public._plan_of(p_shop uuid)
returns public.plans
language sql stable security definer set search_path = public as $$
  select p.* from public.plans p join public.shops s
    on p.code = (case when s.plan_until is not null and s.plan_until <= now() and s.plan_base is not null
                      then s.plan_base else s.plan end)
  where s.id = p_shop
$$;

-- Writes the end of a time-limited plan into the shop row. Called by the functions below.
create or replace function public._sync_shop_plan(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops
     set plan = plan_base, plan_base = null, plan_until = null
   where id = p_shop and plan_until is not null and plan_until <= now() and plan_base is not null;
  perform set_config('bizgrow.plan_change', 'off', true);
end
$$;

-- ---------- 3. platform owner ----------
create table if not exists public.platform_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------- 4. promo codes ----------
create table if not exists public.promo_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9-]{3,29}$'),
  plan          text not null references public.plans(code),
  duration_days int check (duration_days is null or duration_days between 1 and 3650),  -- null = for good
  max_uses      int not null check (max_uses between 1 and 10000),
  used_count    int not null default 0 check (used_count >= 0),
  expires_at    timestamptz,                                                             -- null = no end date for the code
  active        boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (used_count <= max_uses)
);
create unique index if not exists promo_codes_code_key on public.promo_codes (code);

create table if not exists public.promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references public.promo_codes(id) on delete cascade,
  shop_id     uuid not null references public.shops(id) on delete cascade,
  redeemed_by uuid references auth.users(id) on delete set null,
  plan        text not null,
  plan_until  timestamptz,
  created_at  timestamptz not null default now(),
  unique (promo_id, shop_id)
);

create table if not exists public.promo_attempts (
  id        bigint generated always as identity primary key,
  user_id   uuid not null,
  tried_at  timestamptz not null default now()
);
create index if not exists promo_attempts_user_idx on public.promo_attempts (user_id, tried_at);

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.promo_attempts enable row level security;
revoke all on public.promo_codes, public.promo_redemptions, public.promo_attempts from public, anon, authenticated;

-- Shop owner types a code. Returns jsonb for ordinary answers, so the counted try is kept even when it fails.
create or replace function public.redeem_promo_code(p_shop uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_promo  public.promo_codes;
  v_shop   public.shops;
  v_cur    public.plans;
  v_new    public.plans;
  v_base   text;
  v_until  timestamptz;
  v_recent int;
begin
  if v_user is null then raise exception 'Please log in again.' using errcode = '42501'; end if;

  -- Rate limit first, and record the try before anything can fail (so guessing is counted).
  select count(*) into v_recent from public.promo_attempts
   where user_id = v_user and tried_at > now() - interval '15 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait 15 minutes and try again.');
  end if;
  insert into public.promo_attempts (user_id) values (v_user);

  -- A plain check, not _need: _need raises, and a raise would undo the counted try above.
  if p_shop is null or not public.has_shop_role(p_shop, array['owner']) then
    return jsonb_build_object('ok', false, 'message', 'Only the shop owner can use a promo code.');
  end if;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid.');
  end if;

  -- Lock the code row: two shops using the last use at the same moment queue up here.
  select * into v_promo from public.promo_codes where code = v_code for update;
  if not found or not v_promo.active
     or (v_promo.expires_at is not null and v_promo.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid or has ended.');
  end if;
  if exists (select 1 from public.promo_redemptions where promo_id = v_promo.id and shop_id = p_shop) then
    return jsonb_build_object('ok', false, 'message', 'Your shop has already used this code.');
  end if;
  if v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('ok', false, 'message', 'This code has been used up.');
  end if;

  perform public._sync_shop_plan(p_shop);
  select * into v_shop from public.shops where id = p_shop for update;
  select * into v_cur from public.plans where code = (case when v_shop.plan_until is not null and v_shop.plan_until > now()
                                                              and v_shop.plan_base is not null then v_shop.plan_base else v_shop.plan end);
  select * into v_new from public.plans where code = v_promo.plan;
  if v_new.sort_order <= v_cur.sort_order then
    return jsonb_build_object('ok', false, 'message', 'Your shop already has this plan or a better one.');
  end if;

  v_base  := case when v_shop.plan_until is not null and v_shop.plan_base is not null then v_shop.plan_base else v_shop.plan end;
  v_until := case when v_promo.duration_days is null then null else now() + make_interval(days => v_promo.duration_days) end;

  update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
  insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
  values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan = v_promo.plan, plan_base = v_base, plan_until = v_until where id = p_shop;
  perform set_config('bizgrow.plan_change', 'off', true);

  perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code for the ' || v_new.name || ' plan');
  return jsonb_build_object('ok', true, 'plan', v_new.code, 'plan_name', v_new.name, 'plan_until', v_until);
end
$$;
revoke all on function public.redeem_promo_code(uuid, text) from public, anon;
grant execute on function public.redeem_promo_code(uuid, text) to authenticated;

-- Platform owner only. Every other caller gets a plain refusal.
create or replace function public.admin_create_promo(p_code text, p_plan text, p_duration_days int,
                                                    p_max_uses int, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    raise exception 'The code must be 4 to 30 letters or numbers (a dash is allowed inside).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where code = lower(btrim(coalesce(p_plan, '')))) then
    raise exception 'Pick a plan.' using errcode = '22023';
  end if;
  insert into public.promo_codes (code, plan, duration_days, max_uses, expires_at, created_by)
  values (v_code, lower(btrim(p_plan)), p_duration_days, p_max_uses, p_expires_at, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
exception when unique_violation then
  raise exception 'That code already exists. Pick another.' using errcode = '22023';
end
$$;

create or replace function public.admin_list_promos()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'plan', c.plan, 'duration_days', c.duration_days,
      'max_uses', c.max_uses, 'used_count', c.used_count, 'expires_at', c.expires_at,
      'active', c.active, 'created_at', c.created_at
    ) order by c.created_at desc)
    from public.promo_codes c), '[]'::jsonb);
end
$$;

create or replace function public.admin_set_promo_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  update public.promo_codes set active = coalesce(p_active, false) where id = p_id;
  if not found then raise exception 'Code not found.' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Platform owner only: who used one code, when, and which shop. Used by the Admin screen.
create or replace function public.admin_promo_usage(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shop_name', sh.name, 'plan', r.plan, 'plan_until', r.plan_until, 'redeemed_at', r.created_at
    ) order by r.created_at desc)
    from public.promo_redemptions r join public.shops sh on sh.id = r.shop_id
    where r.promo_id = p_id), '[]'::jsonb);
end
$$;

revoke all on function public.admin_create_promo(text, text, int, int, timestamptz),
                     public.admin_list_promos(),
                     public.admin_set_promo_active(uuid, boolean),
                     public.admin_promo_usage(uuid) from public, anon;
grant execute on function public.admin_create_promo(text, text, int, int, timestamptz),
                         public.admin_list_promos(),
                         public.admin_set_promo_active(uuid, boolean),
                         public.admin_promo_usage(uuid) to authenticated;

-- ---------- 5. online payments for plan upgrades (called by the Worker with the service key only) ----------
create table if not exists public.plan_payments (
  id                  uuid primary key default gen_random_uuid(),
  shop_id             uuid not null references public.shops(id) on delete cascade,
  plan                text not null references public.plans(code),
  amount_paise        int  not null check (amount_paise > 0),
  currency            text not null default 'INR' check (currency = 'INR'),
  status              text not null default 'pending' check (status in ('pending', 'paid')),
  razorpay_order_id   text unique,
  razorpay_payment_id text unique,
  requested_by        uuid references auth.users(id) on delete set null,
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);
alter table public.plan_payments enable row level security;
revoke all on public.plan_payments from public, anon, authenticated;

create or replace function public.billing_begin_order(p_user_id uuid, p_shop uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan public.plans; v_cur public.plans; v_row uuid;
begin
  if not exists (select 1 from public.staff where shop_id = p_shop and auth_user_id = p_user_id and role = 'owner' and active) then
    raise exception 'Only the shop owner can pay for a plan.' using errcode = '22023';
  end if;
  select * into v_plan from public.plans where code = lower(btrim(coalesce(p_plan, '')));
  if not found or v_plan.price_paise is null then
    raise exception 'Online payment is not set up for this plan yet.' using errcode = '22023';
  end if;
  select * into v_cur from public._plan_of(p_shop);
  if v_plan.sort_order <= v_cur.sort_order then
    raise exception 'Your shop already has this plan or a better one.' using errcode = '22023';
  end if;
  -- Rate limit: at most 10 payment orders per owner in 15 minutes, so a button mash cannot flood Razorpay.
  if (select count(*) from public.plan_payments
       where requested_by = p_user_id and created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many payment tries. Please wait 15 minutes and try again.' using errcode = '22023';
  end if;
  insert into public.plan_payments (shop_id, plan, amount_paise, requested_by)
  values (p_shop, v_plan.code, v_plan.price_paise, p_user_id) returning id into v_row;
  return jsonb_build_object('ok', true, 'payment_id', v_row, 'amount_paise', v_plan.price_paise,
                            'currency', 'INR', 'plan', v_plan.code);
end
$$;

create or replace function public.billing_attach_order(p_payment uuid, p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.plan_payments set razorpay_order_id = p_order
   where id = p_payment and status = 'pending' and razorpay_order_id is null;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Marks an order paid and moves the shop to the plan. Idempotent: the same payment again changes nothing.
-- p_source 'verify' comes with the signed-in owner's id, which must be the shop owner. 'webhook' has none.
create or replace function public.billing_mark_paid(p_order text, p_payment text, p_amount int, p_currency text,
                                                   p_source text, p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.plan_payments; s public.shops; v_base text; v_until timestamptz; v_plan public.plans; v_cur public.plans;
begin
  if p_source not in ('verify', 'webhook') then raise exception 'Unknown source.' using errcode = '22023'; end if;
  select * into r from public.plan_payments where razorpay_order_id = p_order for update;
  if not found then raise exception 'Payment not found.' using errcode = '22023'; end if;

  if r.status = 'paid' then
    if r.razorpay_payment_id = p_payment then
      return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan);
    end if;
    raise exception 'This order was already paid.' using errcode = '22023';
  end if;

  if p_amount is distinct from r.amount_paise or upper(coalesce(p_currency, '')) <> r.currency then
    raise exception 'Amount does not match this plan.' using errcode = '22023';
  end if;
  if p_source = 'verify' and (p_user_id is null or not exists (
       select 1 from public.staff where shop_id = r.shop_id and auth_user_id = p_user_id and role = 'owner' and active)) then
    raise exception 'Only the shop owner can confirm this payment.' using errcode = '42501';
  end if;

  perform public._sync_shop_plan(r.shop_id);
  select * into s from public.shops where id = r.shop_id for update;
  select * into v_plan from public.plans where code = r.plan;
  select * into v_cur from public._plan_of(r.shop_id);
  if v_cur.sort_order >= v_plan.sort_order then
    -- Never move a shop down: the money is recorded, the plan stays as it is, and the owner is told.
    update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
    perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id,
      'Online payment for the ' || v_plan.name || ' plan received; the shop already had a plan at or above it, so the plan was not changed');
    return jsonb_build_object('ok', true, 'status', 'paid', 'plan', v_cur.code, 'plan_changed', false);
  end if;
  -- The plan to go back to when this payment's 30 days end.
  v_base := case when s.plan_until is not null and s.plan_base is not null then s.plan_base else s.plan end;
  -- Renewing the same plan while it still runs adds 30 days on top; any other case starts 30 days from now.
  v_until := case when s.plan_until is not null and s.plan_until > now() and s.plan = r.plan
                  then s.plan_until + interval '30 days' else now() + interval '30 days' end;

  update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan = r.plan, plan_base = v_base, plan_until = v_until where id = r.shop_id;
  perform set_config('bizgrow.plan_change', 'off', true);
  perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id, 'Paid for the ' || v_plan.name || ' plan online');
  return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan, 'plan_changed', true);
end
$$;

revoke all on function public.billing_begin_order(uuid, uuid, text), public.billing_attach_order(uuid, text),
                     public.billing_mark_paid(text, text, int, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.billing_begin_order(uuid, uuid, text), public.billing_attach_order(uuid, text),
                         public.billing_mark_paid(text, text, int, text, text, uuid) to service_role;
