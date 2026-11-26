-- patch-10 ROLLBACK (stage 9): undoes supabase/patch-10-lockdown.sql.
-- Run once in the Supabase SQL Editor if you want the public web address to be able to call
-- place_store_order directly again (the state before patch-10). Safe to run more than once.
--
-- What it does:
--   * Gives the public (anon) and signed-in (authenticated) roles back their execute right on
--     place_store_order, exactly as patch-08 set it.
--   * Leaves service_role alone, so the Worker keeps working either way.
--
-- What it does NOT do:
--   * It does not give the anonymous role table access back. That access was never used by the
--     store or the owner app (Row Level Security blocked every row for it anyway), so there is
--     nothing to restore. Signed-in users keep their table access.
--   * It deletes nothing and changes no data.

grant execute on function public.place_store_order(text, text, text, text, jsonb) to anon, authenticated;
