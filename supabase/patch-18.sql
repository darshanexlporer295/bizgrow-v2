-- ==================== patch-18: promo and voice limits, internal functions locked (safe to run again) ====================
-- Run after patch-17. Run it through supabase/run-all-pending.sql, which includes it.
--   1. Promo redeem: failed tries are counted per code across every account (50 per code per hour) and across all
--      codes (300 per hour). Hitting either gives the same generic message as the per-person limit.
--      Adds promo_attempts.code and promo_attempts.failed (existing rows keep failed = false).
--   2. Voice: one shared count per signed-in person (20 per minute), read by every Worker instance.
--      New table voice_attempts (locked, nothing can read it directly) and function voice_take (signed-in users only).
--   3. Internal helper functions (names starting with an underscore) cannot be run by anon or the public role.
--      Signed-in users keep the ones the policies and their own functions need.

-- ---------- 1. promo: failed tries per code and in total ----------
alter table public.promo_attempts add column if not exists code text;
alter table public.promo_attempts add column if not exists failed boolean not null default false;
create index if not exists promo_attempts_code_idx on public.promo_attempts (code, tried_at) where failed;
create index if not exists promo_attempts_failed_idx on public.promo_attempts (tried_at) where failed;

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
  v_fails    int;
  v_attempt  bigint;
begin
  if v_user is null then raise exception 'Please log in again.' using errcode = '42501'; end if;

  -- Limits first. Every try is recorded before anything can fail, so guessing is counted. A try counts as failed
  -- until it actually uses the code (then it is set back). Three caps, all with the same generic message:
  --   10 tries per person in 15 minutes (any code);
  --   50 failed tries per code in an hour, across every account (patch-18);
  --   300 failed tries across all codes in an hour, across every account (patch-18).
  select count(*) into v_recent from public.promo_attempts
   where user_id = v_user and tried_at > now() - interval '15 minutes';
  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait a while and try again.');
  end if;
  select count(*) into v_fails from public.promo_attempts
   where code = v_code and failed and tried_at > now() - interval '1 hour';
  if v_fails >= 50 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait a while and try again.');
  end if;
  select count(*) into v_fails from public.promo_attempts
   where failed and tried_at > now() - interval '1 hour';
  if v_fails >= 300 then
    return jsonb_build_object('ok', false, 'limited', true, 'message', 'Too many tries. Please wait a while and try again.');
  end if;
  insert into public.promo_attempts (user_id, code, failed) values (v_user, v_code, true) returning id into v_attempt;

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
    update public.promo_attempts set failed = false where id = v_attempt;
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
    update public.promo_attempts set failed = false where id = v_attempt;
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

-- ---------- 2. voice: one shared count per signed-in person ----------
create table if not exists public.voice_attempts (
  id        bigint generated always as identity primary key,
  user_id   uuid not null,
  tried_at  timestamptz not null default now()
);
create index if not exists voice_attempts_user_idx on public.voice_attempts (user_id, tried_at);
create index if not exists voice_attempts_time_idx on public.voice_attempts (tried_at);
alter table public.voice_attempts enable row level security;
revoke all on public.voice_attempts from public, anon, authenticated;

create or replace function public.voice_take(p_max int, p_window_seconds int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_recent int;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'code', 'login'); end if;
  -- One at a time per person, so two requests at the same moment cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('voice:' || v_user::text, 0));
  select count(*) into v_recent from public.voice_attempts
   where user_id = v_user and tried_at > now() - make_interval(secs => p_window_seconds);
  if v_recent >= p_max then return jsonb_build_object('ok', false, 'code', 'limited'); end if;
  insert into public.voice_attempts (user_id) values (v_user);
  delete from public.voice_attempts where tried_at < now() - interval '1 day';
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.voice_take(int, int) from public, anon;
grant execute on function public.voice_take(int, int) to authenticated;

-- ---------- 3. internal helpers: not callable by anon or the public role ----------
-- Functions the front end calls are not underscore names, so nothing a signed-in user uses is changed.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '\_%'
  loop
    execute 'revoke all on function ' || r.sig || ' from public, anon';
  end loop;
end
$$;
