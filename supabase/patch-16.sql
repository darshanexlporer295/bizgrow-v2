-- patch-16: where a shop's plan came from, and fair rules for promo codes and payments.
-- Run after patch-15 (plans, promo codes, plan payments). Safe to run more than once. Nothing existing is deleted.
--
-- Why: patch-14 gave every shop that existed then the plan 'all' as a default (no payment, no end date).
-- Patch-15 compared plans by rank, so such a shop was "already on a better plan" and every code was refused:
-- "You already have the plan or a better plan than this."
--
-- What changes:
--   * shops.plan_source: where the current plan came from.
--       'free'   = the default plan for new shops
--       'legacy' = the patch-14 default 'all' (not a payment, not a code). Treated like a free shop for codes and payments.
--       'promo'  = a promo code, 'paid' = an online payment, 'manual' = set by BizGrow by hand.
--   * shops.plan_base_source: the same, for the plan to go back to (plan_base).
--   * A promo or a payment can move a legacy or free shop to its plan, and sets the end date.
--   * A real plan (paid, promo or manual) is never replaced by a lower one. A lower code is refused and the message
--     names the current plan and its end date.
--   * A code for the plan the shop already has, with an end date: its days are added to the end date.
--     A code for the plan the shop already has for good: refused, with a message saying so.
--   * Platform owner only: admin_shop_plan (see the source) and admin_set_plan_source (change it).
--   * The plan guard now also protects plan_source and plan_base_source.

-- ---------- 1. columns and the one-time backfill ----------
alter table public.shops add column if not exists plan_source      text;
alter table public.shops add column if not exists plan_base_source text;

-- Existing shops (only rows not set yet, so a second run changes nothing).
update public.shops s set plan_source = case
    when s.plan = 'free' then 'free'
    when exists (select 1 from public.plan_payments p where p.shop_id = s.id and p.plan = s.plan and p.status = 'paid') then 'paid'
    when exists (select 1 from public.promo_redemptions r where r.shop_id = s.id and r.plan = s.plan) then 'promo'
    when s.plan = 'all' and s.plan_until is null then 'legacy'
    else 'manual' end
 where s.plan_source is null;

update public.shops s set plan_base_source = case
    when s.plan_base = 'free' then 'free'
    when exists (select 1 from public.plan_payments p where p.shop_id = s.id and p.plan = s.plan_base and p.status = 'paid') then 'paid'
    when exists (select 1 from public.promo_redemptions r where r.shop_id = s.id and r.plan = s.plan_base) then 'promo'
    when s.plan_base = 'all' then 'legacy'
    else 'manual' end
 where s.plan_base is not null and s.plan_base_source is null;

alter table public.shops alter column plan_source set default 'free';
alter table public.shops alter column plan_source set not null;

alter table public.shops drop constraint if exists shops_plan_source_check;
alter table public.shops add constraint shops_plan_source_check
  check (plan_source in ('free', 'legacy', 'promo', 'paid', 'manual'));
alter table public.shops drop constraint if exists shops_plan_base_source_check;
alter table public.shops add constraint shops_plan_base_source_check
  check (plan_base_source is null or plan_base_source in ('free', 'legacy', 'promo', 'paid', 'manual'));

-- ---------- 2. the plan guard: plan_source too ----------
create or replace function public._plan_guard_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.plan, new.plan_base, new.plan_until, new.plan_source, new.plan_base_source)
         is distinct from (old.plan, old.plan_base, old.plan_until, old.plan_source, old.plan_base_source)
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

-- ---------- 3. helpers ----------
-- A date for messages, in India time, e.g. "17 Dec 2026".
create or replace function public._day_text(p_at timestamptz)
returns text language sql immutable as $$
  select to_char(p_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')
$$;

-- Writes the end of a time-limited plan into the shop row. The plan goes back to plan_base and its source with it.
create or replace function public._sync_shop_plan(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops
     set plan = plan_base, plan_source = coalesce(plan_base_source, 'free'),
         plan_base = null, plan_base_source = null, plan_until = null
   where id = p_shop and plan_until is not null and plan_until <= now() and plan_base is not null;
  perform set_config('bizgrow.plan_change', 'off', true);
end
$$;

-- ---------- 4. promo codes ----------
create or replace function public.redeem_promo_code(p_shop uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_promo    public.promo_codes;
  v_shop     public.shops;
  v_cur      public.plans;
  v_new      public.plans;
  v_rank     int;
  v_base     text;
  v_base_src text;
  v_until    timestamptz;
  v_recent   int;
  v_msg      text;
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
  select * into v_cur from public._plan_of(p_shop);
  select * into v_new from public.plans where code = v_promo.plan;
  -- A legacy default shop has no real plan yet, so it ranks below every plan (any code can apply).
  v_rank := case when v_shop.plan_source = 'legacy' then 0 else v_cur.sort_order end;

  if v_new.sort_order > v_rank then
    -- Upgrade. The plan to go back to when this code's days end: the current base if the shop is on a timed plan, else its plan now.
    if v_shop.plan_until is not null and v_shop.plan_base is not null then
      v_base := v_shop.plan_base;  v_base_src := v_shop.plan_base_source;
    else
      v_base := v_shop.plan;       v_base_src := v_shop.plan_source;
    end if;
    v_until := case when v_promo.duration_days is null then null else now() + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan = v_promo.plan, plan_source = 'promo', plan_until = v_until,
                            plan_base = case when v_until is null then null else v_base end,
                            plan_base_source = case when v_until is null then null else v_base_src end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code for the ' || v_new.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_new.code, 'plan_name', v_new.name, 'plan_until', v_until);
  end if;

  if v_new.code = v_cur.code and v_shop.plan_source <> 'legacy' then
    -- The same plan the shop already has.
    if v_shop.plan_until is null then
      return jsonb_build_object('ok', false, 'message',
        'Your shop is already on the ' || v_cur.name || ' plan for good, so this code was not used.');
    end if;
    -- Days go on top of the current end date. A code with no end date makes the plan permanent.
    v_until := case when v_promo.duration_days is null then null
                    else greatest(v_shop.plan_until, now()) + make_interval(days => v_promo.duration_days) end;

    update public.promo_codes set used_count = used_count + 1 where id = v_promo.id;
    insert into public.promo_redemptions (promo_id, shop_id, redeemed_by, plan, plan_until)
    values (v_promo.id, p_shop, v_user, v_promo.plan, v_until);

    perform set_config('bizgrow.plan_change', 'on', true);
    update public.shops set plan_until = v_until,
                            plan_base = case when v_until is null then null else plan_base end,
                            plan_base_source = case when v_until is null then null else plan_base_source end
     where id = p_shop;
    perform set_config('bizgrow.plan_change', 'off', true);

    perform public._audit(p_shop, 'promo', 'shops', p_shop, 'Used a promo code to extend the ' || v_cur.name || ' plan');
    return jsonb_build_object('ok', true, 'plan', v_cur.code, 'plan_name', v_cur.name, 'plan_until', v_until, 'extended', true);
  end if;

  -- A lower plan: refused, and the message says what the shop has now and until when.
  v_msg := 'Your shop is on the ' || v_cur.name || ' plan'
        || case when v_shop.plan_until is not null then ' until ' || public._day_text(v_shop.plan_until) else ' for good' end
        || '. This code gives the ' || v_new.name || ' plan, which is lower, so it was not used.';
  return jsonb_build_object('ok', false, 'message', v_msg);
end
$$;
revoke all on function public.redeem_promo_code(uuid, text) from public, anon;
grant execute on function public.redeem_promo_code(uuid, text) to authenticated;

-- ---------- 5. online payment: the same rules as codes ----------
create or replace function public.billing_begin_order(p_user_id uuid, p_shop uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan public.plans; v_cur public.plans; v_shop public.shops; v_rank int; v_row uuid; v_msg text;
begin
  if not exists (select 1 from public.staff where shop_id = p_shop and auth_user_id = p_user_id and role = 'owner' and active) then
    raise exception 'Only the shop owner can pay for a plan.' using errcode = '22023';
  end if;
  select * into v_plan from public.plans where code = lower(btrim(coalesce(p_plan, '')));
  if not found or v_plan.price_paise is null then
    raise exception 'Online payment is not set up for this plan yet.' using errcode = '22023';
  end if;
  perform public._sync_shop_plan(p_shop);
  select * into v_shop from public.shops where id = p_shop;
  select * into v_cur from public._plan_of(p_shop);
  v_rank := case when v_shop.plan_source = 'legacy' then 0 else v_cur.sort_order end;
  if v_plan.sort_order <= v_rank then
    v_msg := 'Your shop is already on the ' || v_cur.name || ' plan'
          || case when v_shop.plan_until is not null then ' until ' || public._day_text(v_shop.plan_until) else ' for good' end
          || '. Pick a higher plan.';
    raise exception '%', v_msg using errcode = '22023';
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
declare r public.plan_payments; s public.shops; v_base text; v_base_src text; v_until timestamptz;
        v_plan public.plans; v_cur public.plans; v_rank int;
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
  v_rank := case when s.plan_source = 'legacy' then 0 else v_cur.sort_order end;
  if v_rank >= v_plan.sort_order then
    -- Never move a shop down: the money is recorded, the plan stays as it is, and the owner is told.
    update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
    perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id,
      'Online payment for the ' || v_plan.name || ' plan received; the shop already had a plan at or above it, so the plan was not changed');
    return jsonb_build_object('ok', true, 'status', 'paid', 'plan', v_cur.code, 'plan_changed', false);
  end if;
  -- The plan to go back to when this payment's 30 days end.
  if s.plan_until is not null and s.plan_base is not null then
    v_base := s.plan_base;  v_base_src := s.plan_base_source;
  else
    v_base := s.plan;       v_base_src := s.plan_source;
  end if;
  -- Renewing the same plan while it still runs adds 30 days on top; any other case starts 30 days from now.
  v_until := case when s.plan_until is not null and s.plan_until > now() and s.plan = r.plan
                  then s.plan_until + interval '30 days' else now() + interval '30 days' end;

  update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan = r.plan, plan_source = 'paid', plan_base = v_base, plan_base_source = v_base_src,
                          plan_until = v_until
   where id = r.shop_id;
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

-- ---------- 6. platform owner: see and set where a shop's plan came from ----------
-- Sources: free (default), legacy (old default, not paid), promo, paid, manual (set by hand).
create or replace function public.admin_shop_plan(p_shop uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.shops;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Shop not found.' using errcode = '22023'; end if;
  return jsonb_build_object('shop_id', s.id, 'shop', s.name, 'plan', s.plan, 'plan_source', s.plan_source,
    'plan_until', s.plan_until, 'plan_base', s.plan_base, 'plan_base_source', s.plan_base_source);
end
$$;

create or replace function public.admin_set_plan_source(p_shop uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_src text := lower(btrim(coalesce(p_source, ''))); v_old text;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  if v_src not in ('free', 'legacy', 'promo', 'paid', 'manual') then
    raise exception 'Pick one of: free, legacy, promo, paid, manual.' using errcode = '22023';
  end if;
  select plan_source into v_old from public.shops where id = p_shop for update;
  if not found then raise exception 'Shop not found.' using errcode = '22023'; end if;
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops set plan_source = v_src where id = p_shop;
  perform set_config('bizgrow.plan_change', 'off', true);
  perform public._audit(p_shop, 'plan_source', 'shops', p_shop, 'Plan source set from ' || v_old || ' to ' || v_src || ' by BizGrow');
  return jsonb_build_object('ok', true, 'plan_source', v_src);
end
$$;

revoke all on function public.admin_shop_plan(uuid), public.admin_set_plan_source(uuid, text) from public, anon;
grant execute on function public.admin_shop_plan(uuid), public.admin_set_plan_source(uuid, text) to authenticated;
