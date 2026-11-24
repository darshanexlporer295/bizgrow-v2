-- BizGrow v2, patch 01: first-login shop set-up, owner shop edits, and the sign-up "finished" flag.
-- Run once in the Supabase SQL Editor for the BizGrow project, after schema.sql.
-- Safe to run again: every step checks first. Uses only the signed-in role. No secret keys.

-- 1. Sign-up answers get a "finished" flag (the six questions are done).
alter table public.signup_answers add column if not exists done boolean not null default false;

-- 2. First login: make the shop and the owner's staff row, once. Returns the shop id.
create or replace function public.create_my_shop(
  p_name text, p_trade text default null, p_city text default null,
  p_lang text default 'en', p_owner_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  em text;
  nm text;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;

  select s.shop_id into sid
  from public.staff s
  where s.auth_user_id = uid and s.active
  order by s.created_at
  limit 1;
  if sid is not null then
    return sid;
  end if;

  select u.email into em from auth.users u where u.id = uid;
  nm := coalesce(nullif(trim(p_owner_name), ''), split_part(coalesce(em, 'Owner'), '@', 1));

  insert into public.shops (name, trade, city, lang)
  values (coalesce(nullif(trim(p_name), ''), 'My shop'), nullif(p_trade, ''), nullif(trim(p_city), ''),
          coalesce(nullif(p_lang, ''), 'en'))
  returning id into sid;

  insert into public.staff (shop_id, auth_user_id, name, email, role, active)
  values (sid, uid, nm, em, 'owner', true);

  return sid;
end;
$$;

-- 3. The owner can change the shop name, trade, city and language. Blank values keep the old value.
create or replace function public.update_my_shop(
  p_shop uuid, p_name text, p_trade text, p_city text, p_lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_shop_role(p_shop, array['owner']) then
    raise exception 'Only the owner can change the shop.';
  end if;

  update public.shops
  set name = coalesce(nullif(trim(p_name), ''), name),
      trade = coalesce(nullif(p_trade, ''), trade),
      city = coalesce(nullif(trim(p_city), ''), city),
      lang = coalesce(nullif(p_lang, ''), lang)
  where id = p_shop;
end;
$$;

-- 4. Access: only people who have signed in can call these. Nobody else, not even the public key.
revoke all on function public.create_my_shop(text, text, text, text, text) from public, anon;
revoke all on function public.update_my_shop(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_my_shop(text, text, text, text, text) to authenticated;
grant execute on function public.update_my_shop(uuid, text, text, text, text) to authenticated;
