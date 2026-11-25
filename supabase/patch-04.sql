-- BizGrow v2, patch 04: the business type of the shop (textile trader, yarn or fabric, raw material, other).
-- Run once in the Supabase SQL Editor for the BizGrow project, after patch-03.
-- Safe to run again: every step checks first. Uses only the signed-in role. No secret keys.
-- Until this is run, the app still works: the business type is kept on the phone and the app says so.

-- 1. The new column on the shop row. Existing shops get an empty value.
alter table public.shops add column if not exists business_type text;

-- 2. Only the four listed values (or empty). Added only if it is not there yet.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shops_business_type_check') then
    alter table public.shops add constraint shops_business_type_check
      check (business_type is null or business_type in ('textile_trader', 'yarn_fabric', 'raw_material', 'other'));
  end if;
end $$;

-- 3. The owner can save the business type. A new function, so the older ones are unchanged.
create or replace function public.update_my_business_type(p_shop uuid, p_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bt text := nullif(trim(p_type), '');
begin
  if not public.has_shop_role(p_shop, array['owner']) then
    raise exception 'Only the owner can change the shop.';
  end if;
  if bt is not null and bt not in ('textile_trader', 'yarn_fabric', 'raw_material', 'other') then
    raise exception 'Please pick a business type from the list.' using errcode = '22023';
  end if;
  update public.shops set business_type = bt where id = p_shop;
end;
$$;

-- 4. Access: only people who have signed in can call this. Nobody else, not even the public key.
revoke all on function public.update_my_business_type(uuid, text) from public, anon;
grant execute on function public.update_my_business_type(uuid, text) to authenticated;
