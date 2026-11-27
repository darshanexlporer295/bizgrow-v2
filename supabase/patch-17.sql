-- patch-17: promo codes, done properly end to end.
-- Run after patch-16. Safe to run more than once. Nothing existing is deleted.
--
-- What changes:
--   * A promo or a payment that ends goes back to FREE, never to the old default "All Features" (patch-14 gave
--     existing shops that plan with no payment; it must not come back when a code runs out).
--     Rule, at read time and when written: a base of 'legacy' (or none) means 'free'.
--   * Expiry is checked when the plan is read (get_my_plan, every paid or promo check), so the shop falls back to Free
--     even if nobody opens the app. The data is kept.
--   * get_my_plan also returns the end date, how many days are left, and the plan it goes back to. The app shows
--     a gentle "ends in N days" note from that.
--   * Codes ignore case AND spaces: " shop 2026 " is the same as SHOP2026.
--   * redeem_promo_code: clear, plain messages; a success message with the end date.
--   * admin_create_promo: checks every field and gives a plain message (days 1 to 3650 or for good, uses 1 to 10000,
--     an end date in the future, a paid plan only). No raw database text reaches the screen.
--   * One-time fix of rows already written by patch-15/16 (a promo that ended went back to 'All Features').

-- ---------- 1. helpers: where a shop goes back to ----------
create or replace function public._norm_code(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[[:space:]]+', '', 'g'))
$$;

-- The plan a shop goes back to when its time-limited plan ends. An old default ('legacy') or nothing means Free.
create or replace function public._fallback_code(p_plan text, p_source text)
returns text language sql immutable as $$
  select case when p_plan is null or p_source is null or p_source = 'legacy' then 'free' else p_plan end
$$;

create or replace function public._fallback_source(p_source text)
returns text language sql immutable as $$
  select case when p_source is null or p_source = 'legacy' then 'free' else p_source end
$$;

-- Whole calendar days left in India time (0 = ends today or already ended).
create or replace function public._days_left(p_at timestamptz)
returns int language sql stable as $$
  select greatest(0, ((p_at at time zone 'Asia/Kolkata')::date - (now() at time zone 'Asia/Kolkata')::date))::int
$$;

revoke all on function public._norm_code(text), public._fallback_code(text, text), public._fallback_source(text),
                       public._days_left(timestamptz) from public, anon, authenticated;

-- ---------- 2. the plan a shop has now (read time): an ended plan is Free, or its base when that is a real plan ----------
create or replace function public._plan_of(p_shop uuid)
returns public.plans
language sql stable security definer set search_path = public as $$
  select p.* from public.plans p join public.shops s
    on p.code = (case when s.plan_until is not null and s.plan_until <= now()
                      then public._fallback_code(s.plan_base, s.plan_base_source)
                      else s.plan end)
  where s.id = p_shop
$$;

-- Writes the end of a time-limited plan into the shop row (called before each paid or promo check).
create or replace function public._sync_shop_plan(p_shop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  update public.shops
     set plan = public._fallback_code(plan_base, plan_base_source),
         plan_source = public._fallback_source(plan_base_source),
         plan_base = null, plan_base_source = null, plan_until = null
   where id = p_shop and plan_until is not null and plan_until <= now();
  perform set_config('bizgrow.plan_change', 'off', true);
end
$$;

-- ---------- 3. one-time fix of rows already written ----------
do $$
declare r record;
begin
  perform set_config('bizgrow.plan_change', 'on', true);
  -- A promo or payment that ends must go back to Free, not to the old default.
  update public.shops set plan_base = 'free', plan_base_source = 'free'
   where plan_base_source = 'legacy';
  perform set_config('bizgrow.plan_change', 'off', true);
  -- Any shop whose time is already up goes back now (the same rule the read path uses).
  for r in select id from public.shops where plan_until is not null and plan_until <= now() loop
    perform public._sync_shop_plan(r.id);
  end loop;
end
$$;

-- ---------- 4. promo codes: redeem ----------
create or replace function public.redeem_promo_code(p_shop uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_code     text := public._norm_code(p_code);
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

  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'Type the promo code first.');
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid. Check the letters and numbers and try again.');
  end if;

  -- Lock the code row: two shops using the last use at the same moment queue up here.
  select * into v_promo from public.promo_codes where code = v_code for update;
  if not found or not v_promo.active then
    return jsonb_build_object('ok', false, 'message', 'That code is not valid or has ended. Check it with BizGrow.');
  end if;
  if v_promo.expires_at is not null and v_promo.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'That code has ended, so it cannot be used now.');
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
  -- A legacy or free shop ranks below every paid plan, so any code can apply to it.
  v_rank := case when v_shop.plan_source in ('legacy', 'free') then 0 else v_cur.sort_order end;

  if v_new.sort_order > v_rank then
    -- Upgrade. The plan to go back to when this code's days end: the current base if the shop is on a timed plan, else its plan now.
    if v_shop.plan_until is not null then
      v_base     := public._fallback_code(v_shop.plan_base, v_shop.plan_base_source);
      v_base_src := public._fallback_source(v_shop.plan_base_source);
    else
      v_base     := public._fallback_code(v_shop.plan, v_shop.plan_source);
      v_base_src := public._fallback_source(v_shop.plan_source);
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
    return jsonb_build_object('ok', true, 'plan', v_new.code, 'plan_name', v_new.name, 'plan_until', v_until,
      'days_left', case when v_until is null then null else public._days_left(v_until) end,
      'message', 'Done. Your shop is now on the ' || v_new.name || ' plan'
                 || case when v_until is null then ' for good.' else ' until ' || public._day_text(v_until) || '.' end);
  end if;

  if v_new.code = v_cur.code and v_shop.plan_source not in ('legacy', 'free') then
    -- The same paid plan the shop already has.
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
    return jsonb_build_object('ok', true, 'plan', v_cur.code, 'plan_name', v_cur.name, 'plan_until', v_until, 'extended', true,
      'days_left', case when v_until is null then null else public._days_left(v_until) end,
      'message', 'Done. Your ' || v_cur.name || ' plan now runs'
                 || case when v_until is null then ' for good.' else ' until ' || public._day_text(v_until) || '.' end);
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

-- ---------- 5. promo codes: the platform owner makes a code (every field checked, plain messages) ----------
create or replace function public.admin_create_promo(p_code text, p_plan text, p_duration_days int,
                                                    p_max_uses int, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := public._norm_code(p_code); v_plan text := lower(btrim(coalesce(p_plan, ''))); v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'Only the platform owner can do this.' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{3,29}$' then
    raise exception 'The code must be 4 to 30 letters or numbers. A dash is allowed inside.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.plans where code = v_plan and sort_order > 1) then
    raise exception 'Pick a paid plan for the code: Growth or All Features.' using errcode = '22023';
  end if;
  if p_duration_days is not null and (p_duration_days < 1 or p_duration_days > 3650) then
    raise exception 'Days must be between 1 and 3650, or left empty for good.' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 10000 then
    raise exception 'The number of uses must be between 1 and 10000.' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The last day to use the code must be in the future.' using errcode = '22023';
  end if;
  insert into public.promo_codes (code, plan, duration_days, max_uses, expires_at, created_by)
  values (v_code, v_plan, p_duration_days, p_max_uses, p_expires_at, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
exception when unique_violation then
  raise exception 'That code already exists. Pick another.' using errcode = '22023';
end
$$;

-- ---------- 6. the plan a shop has, with its end date (the app shows "ends in N days") ----------
create or replace function public.get_my_plan(p_shop uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p public.plans%rowtype;
  s public.shops%rowtype;
  v_back public.plans%rowtype;
  v_req record;
begin
  if auth.uid() is null then raise exception 'Please log in again.' using errcode = '28000'; end if;
  if public._my_role(p_shop) is null then raise exception 'You are not in this shop' using errcode = '42501'; end if;
  p := public._plan_of(p_shop);
  select * into s from public.shops where id = p_shop;
  select * into v_back from public.plans
   where code = case when s.plan_until is not null then public._fallback_code(s.plan_base, s.plan_base_source)
                     else public._fallback_code(s.plan, s.plan_source) end;
  select r.to_plan, r.created_at into v_req
    from public.plan_requests r where r.shop_id = p_shop and r.status = 'new'
   order by r.created_at desc limit 1;
  return public._plan_json(p) || jsonb_build_object(
    'plan_source', case when s.plan_until is not null and s.plan_until <= now() then public._fallback_source(s.plan_base_source) else s.plan_source end,
    'plan_until', case when s.plan_until is not null and s.plan_until > now() then s.plan_until else null end,
    'plan_until_text', case when s.plan_until is not null and s.plan_until > now() then public._day_text(s.plan_until) else null end,
    'days_left', case when s.plan_until is not null and s.plan_until > now() then public._days_left(s.plan_until) else null end,
    'back_to', v_back.code,
    'back_to_name', v_back.name,
    'usage', jsonb_build_object(
      'bills', public._bills_in_month(p_shop, public._ist_today()),
      'items', public._items_count(p_shop),
      'people', public._people_count(p_shop)),
    'requested', case when v_req.to_plan is null then null
                 else jsonb_build_object('to_plan', v_req.to_plan, 'at', v_req.created_at) end);
end
$$;
revoke all on function public.get_my_plan(uuid) from public, anon;
grant execute on function public.get_my_plan(uuid) to authenticated;

-- ---------- 7. online payment: a paid plan that ends goes back to Free (same as codes) ----------
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
  v_rank := case when s.plan_source in ('legacy', 'free') then 0 else v_cur.sort_order end;
  if v_rank >= v_plan.sort_order then
    -- Never move a shop down: the money is recorded, the plan stays as it is, and the owner is told.
    update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
    perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id,
      'Online payment for the ' || v_plan.name || ' plan received; the shop already had a plan at or above it, so the plan was not changed');
    return jsonb_build_object('ok', true, 'status', 'paid', 'plan', v_cur.code, 'plan_changed', false);
  end if;
  -- The plan to go back to when this payment's 30 days end: Free, unless the shop's own base is a real plan.
  if s.plan_until is not null then
    v_base     := public._fallback_code(s.plan_base, s.plan_base_source);
    v_base_src := public._fallback_source(s.plan_base_source);
  else
    v_base     := public._fallback_code(s.plan, s.plan_source);
    v_base_src := public._fallback_source(s.plan_source);
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

revoke all on function public.billing_mark_paid(text, text, int, text, text, uuid) from public, anon, authenticated;
grant execute on function public.billing_mark_paid(text, text, int, text, text, uuid) to service_role;
