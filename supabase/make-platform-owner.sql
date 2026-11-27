-- make-platform-owner.sql: makes ONE login the BizGrow platform owner (the only one who can make promo codes).
-- Run once in the Supabase SQL Editor, after patch-15 (or run-all-pending.sql) has run.
--
-- STEP 1: replace the placeholder email on the line marked EDIT HERE with the email you use to log in to BizGrow.
--         Keep the quote marks. Use the exact email of the login, not a shop staff email.
-- STEP 2: click Run. It says "platform owner added" when it worked.
--
-- Safe to run again. It never creates a login; the login must already exist (sign up in the app first).

do $$
declare
  v_email text := 'REPLACE-WITH-YOUR-LOGIN-EMAIL@example.com';   -- EDIT HERE (step 1)
  v_id    uuid;
begin
  if v_email like 'REPLACE-WITH-%' then
    raise exception 'Edit the email on the EDIT HERE line first (step 1), then run again.';
  end if;
  select id into v_id from auth.users where lower(email) = lower(btrim(v_email));
  if v_id is null then
    raise exception 'No login with that email yet. Sign up in BizGrow with that email first, then run again.';
  end if;
  insert into public.platform_admins (user_id) values (v_id) on conflict (user_id) do nothing;
  raise notice 'platform owner added';
end
$$;

-- Shows how many platform owners exist now (1 or more after a successful run).
select count(*) as platform_owners from public.platform_admins;
