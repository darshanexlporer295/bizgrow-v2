-- verify-applied.sql: checks that the database changes from patch-14 to patch-20 are on this project.
-- READ ONLY: this file only looks. It creates, changes and deletes nothing, and it is safe to run as often as you like.
--
-- How to use: open the Supabase SQL Editor, click New query, paste the WHOLE file, click Run.
-- You get one table with a line per check: the step (the patch it belongs to), what was checked, and OK or NOT OK.
-- The last line says "all" and whether everything is in place.
--
-- What to expect after supabase/run-all-pending.sql has finished with "Success":
--   every line says OK, and the last line says ALL IN PLACE ("checks passed: 43 of 43").
-- If any line says NOT OK, run supabase/run-all-pending.sql once more (it is safe to run again), then this file again.
-- If it still says NOT OK, copy the NOT OK lines and send them to the BizGrow team. Do not change anything else.
--
-- This file does not show any data from your shops, customers or orders. It only reads the list of tables,
-- columns, functions and rules that the database has.

with checks(step, check_name, passed) as (
  values
  -- patch-14: plans and plan requests
  ('14', 'table plans',                         to_regclass('public.plans') is not null),
  ('14', 'table plan_requests',                 to_regclass('public.plan_requests') is not null),
  ('14', 'function get_plans',                  exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'get_plans')),
  ('14', 'function get_my_plan',                exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'get_my_plan')),
  ('14', 'function request_plan_upgrade',       exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'request_plan_upgrade')),
  -- patch-15: prices, plan end dates, promo codes, online payments
  ('15', 'plans.price_paise column',            exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.plans') and a.attname = 'price_paise' and not a.attisdropped and a.attnum > 0)),
  ('15', 'shops.plan_until column',             exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.shops') and a.attname = 'plan_until' and not a.attisdropped and a.attnum > 0)),
  ('15', 'shops.plan_base column',              exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.shops') and a.attname = 'plan_base' and not a.attisdropped and a.attnum > 0)),
  ('15', 'table promo_codes',                   to_regclass('public.promo_codes') is not null),
  ('15', 'table promo_redemptions',             to_regclass('public.promo_redemptions') is not null),
  ('15', 'table promo_attempts',                to_regclass('public.promo_attempts') is not null),
  ('15', 'table plan_payments',                 to_regclass('public.plan_payments') is not null),
  ('15', 'table platform_admins',               to_regclass('public.platform_admins') is not null),
  ('15', 'function redeem_promo_code',          exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'redeem_promo_code')),
  ('15', 'function admin_create_promo',         exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_create_promo')),
  ('15', 'function admin_list_promos',          exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_list_promos')),
  ('15', 'function admin_set_promo_active',     exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_set_promo_active')),
  ('15', 'function admin_promo_usage',          exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_promo_usage')),
  ('15', 'function billing_begin_order',        exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'billing_begin_order')),
  ('15', 'function billing_mark_paid',          exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'billing_mark_paid')),
  -- patch-16: where a plan came from, and the fair-rules fixes
  ('16', 'shops.plan_source column',            exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.shops') and a.attname = 'plan_source' and not a.attisdropped and a.attnum > 0)),
  ('16', 'shops.plan_base_source column',       exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.shops') and a.attname = 'plan_base_source' and not a.attisdropped and a.attnum > 0)),
  ('16', 'plan_source rule (shops_plan_source_check)', exists (select 1 from pg_constraint c where c.conname = 'shops_plan_source_check' and c.conrelid = to_regclass('public.shops'))),
  ('16', 'function admin_shop_plan',            exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_shop_plan')),
  ('16', 'function admin_set_plan_source',      exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_set_plan_source')),
  -- patch-17: plan end dates go back to Free, code rules
  ('17', 'function _days_left',                 exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_days_left')),
  ('17', 'function _norm_code',                 exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_norm_code')),
  ('17', 'function _fallback_code',             exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_fallback_code')),
  ('17', 'function _fallback_source',           exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_fallback_source')),
  -- patch-18: promo failed-try caps, shared voice limit, internal functions closed
  ('18', 'promo_attempts.code column',          exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.promo_attempts') and a.attname = 'code' and not a.attisdropped and a.attnum > 0)),
  ('18', 'promo_attempts.failed column',        exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.promo_attempts') and a.attname = 'failed' and not a.attisdropped and a.attnum > 0)),
  ('18', 'table voice_attempts',               to_regclass('public.voice_attempts') is not null),
  ('18', 'function voice_take',                 exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'voice_take')),
  ('18', 'internal functions (names starting _) cannot be run by anon', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_%')
        and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_%' and has_function_privilege('anon', p.oid, 'EXECUTE'))),
  ('18', 'redeem_promo_code cannot be run by anon', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'redeem_promo_code')
        and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'redeem_promo_code' and has_function_privilege('anon', p.oid, 'EXECUTE'))),
  -- patch-19: owner alert when a payment does not raise the plan
  ('19', 'shops.billing_notice_plan column',   exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.shops') and a.attname = 'billing_notice_plan' and not a.attisdropped and a.attnum > 0)),
  -- patch-20: whole-shop caps removed from the public order and tracking functions
  ('20', 'place_store_order has no whole-shop 300 cap', coalesce(pg_get_functiondef(to_regprocedure('public.place_store_order(text,text,text,text,jsonb)')) like '%place_store_order%'
        and pg_get_functiondef(to_regprocedure('public.place_store_order(text,text,text,text,jsonb)')) not like '%busy%'
        and pg_get_functiondef(to_regprocedure('public.place_store_order(text,text,text,text,jsonb)')) not like '%>= 300%', false)),
  ('20', 'track_store_order has no whole-shop count, keeps per phone limit', coalesce(pg_get_functiondef(to_regprocedure('public.track_store_order(text,text,text)')) not like '%v_by_shop%'
        and pg_get_functiondef(to_regprocedure('public.track_store_order(text,text,text)')) like '%v_by_phone > 10%', false)),
  ('20', 'shop link order function can be run by the public (anon)', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'place_store_order_for_client' and has_function_privilege('anon', p.oid, 'EXECUTE'))),
  ('20', 'shop link tracking function can be run by the public (anon)', exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'track_store_order_for_client' and has_function_privilege('anon', p.oid, 'EXECUTE'))),
  -- security: the new tables keep row-level security on, and anon cannot read the promo codes
  ('18', 'row-level security on promo_codes',   coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.promo_codes')), false)),
  ('18', 'row-level security on voice_attempts', coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.voice_attempts')), false)),
  ('18', 'anon cannot read promo_codes',       coalesce(not has_table_privilege('anon', to_regclass('public.promo_codes'), 'SELECT'), false))
),
result as (
  select step, check_name, coalesce(passed, false) as passed from checks
)
select step, check_name, case when passed then 'OK' else 'NOT OK' end as result
  from result
union all
select 'all', 'checks passed: ' || count(*) filter (where passed)::text || ' of ' || count(*)::text,
       case when bool_and(passed) then 'ALL IN PLACE' else 'NOT ALL IN PLACE' end
  from result
order by step, check_name;
