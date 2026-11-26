-- patch-10: online store orders only come through the Cloudflare Worker (stage 9).
-- OPTIONAL. Run once in the Supabase SQL Editor, and only after BOTH of these are true:
--   1. The Worker has its server key (Cloudflare secret SUPABASE_SERVICE_KEY, see docs/SETUP-STEPS.md Part 6)
--      and the Worker is deployed.
--   2. The shop link shows the security check box, and a test order from the shop link goes through.
-- If you run it before that, customers cannot place orders until the Worker key is in place.
-- Safe to run more than once. To undo it, run supabase/patch-10-rollback.sql.
--
-- What changes:
--   * place_store_order can no longer be called straight from the public web address with the
--     public key. Only the Worker can place an order, using the server key (service_role).
--   * The anonymous (public) role loses its empty table access on every table in the public
--     schema. Row Level Security already blocked every row for it; this removes the door itself.
--   * Unchanged on purpose: the shop page reads (public_store_catalogue), order tracking
--     (track_store_order and track_store_order_for_client), the owner app (signed-in users) and everything else.
--
-- Needs patch-08 (place_store_order) to be in place first. Nothing is deleted and no data changes.

-- ---------- place_store_order: only the server (service_role) may call it ----------
revoke all on function public.place_store_order(text, text, text, text, jsonb) from public, anon, authenticated;

-- The Worker connects with the service_role key. Give that role the function, if the role exists
-- (it does on Supabase; a plain Postgres may not have it).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.place_store_order(text, text, text, text, jsonb) to service_role;
  end if;
end $$;

-- ---------- the per-connection order function (patch-12), if it is there ----------
do $$
begin
  if to_regprocedure('public.place_store_order_for_client(text,text,text,text,jsonb,text)') is not null then
    revoke all on function public.place_store_order_for_client(text, text, text, text, jsonb, text) from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.place_store_order_for_client(text, text, text, text, jsonb, text) to service_role;
    end if;
  end if;
end $$;

-- ---------- anonymous role: no direct table access at all ----------
-- schema.sql already intends this. Supabase's default privileges can hand the anonymous role access to
-- tables created later (for example tasks and staff_invites). Signed-in users keep their own grants.
revoke all on all tables in schema public from anon;
