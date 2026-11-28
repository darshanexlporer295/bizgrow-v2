-- patch-19: owner-visible alert when an online payment does not raise the plan.
-- Safe to run again (create if not exists, create or replace).
--
-- Before this, a captured payment for a plan at or below the shop's current plan was recorded only as an
-- audit line. Now the shop also gets billing_notice_plan (the plan the payment was for). The plan screen
-- shows a notice to the owner until a later online payment moves the shop to a new plan.
-- The notice is not a plan change: the shop's plan, end date and fallback are not touched.

alter table public.shops add column if not exists billing_notice_plan text;

-- Same as patch-17, plus: sets the notice when the plan is not raised, and clears it when a payment raises the plan.
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
    -- Never move a shop down: the money is recorded, the plan stays as it is, and the owner is told on the plan screen.
    update public.plan_payments set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = r.id;
    update public.shops set billing_notice_plan = r.plan where id = r.shop_id;
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
                          plan_until = v_until, billing_notice_plan = null
   where id = r.shop_id;
  perform set_config('bizgrow.plan_change', 'off', true);
  perform public._audit(r.shop_id, 'payment', 'plan_payments', r.id, 'Paid for the ' || v_plan.name || ' plan online');
  return jsonb_build_object('ok', true, 'status', 'paid', 'plan', r.plan, 'plan_changed', true);
end
$$;

revoke all on function public.billing_mark_paid(text, text, int, text, text, uuid) from public, anon, authenticated;
grant execute on function public.billing_mark_paid(text, text, int, text, text, uuid) to service_role;

-- Same as patch-17, plus billing_notice_plan (null when there is no notice).
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
    'billing_notice_plan', s.billing_notice_plan,
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
