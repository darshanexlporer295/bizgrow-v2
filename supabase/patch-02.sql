-- BizGrow v2, patch 02: shop phone, UPI ID, address and the Chotu assistant name.
-- Run once in the Supabase SQL Editor for the BizGrow project, after patch-01.
-- Safe to run again: every step checks first. Uses only the signed-in role. No secret keys.

-- 1. New columns on the shop row. Existing shops get empty values.
alter table public.shops add column if not exists phone text;
alter table public.shops add column if not exists upi_id text;
alter table public.shops add column if not exists address text;
alter table public.shops add column if not exists assistant_name text;

-- 2. The owner can save the four new fields. A new function, so update_my_shop (patch-01) is unchanged.
--    A null value keeps the old value. A blank value clears it (the assistant goes back to its usual name).
create or replace function public.update_my_shop_profile(
  p_shop uuid, p_phone text, p_upi_id text, p_address text, p_assistant_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text := nullif(trim(p_phone), '');
  up text := nullif(trim(p_upi_id), '');
  ad text := nullif(trim(p_address), '');
  an text := nullif(trim(p_assistant_name), '');
begin
  if not public.has_shop_role(p_shop, array['owner']) then
    raise exception 'Only the owner can change the shop.';
  end if;

  -- Light checks only: lengths, and the characters a phone number or UPI ID can use.
  if p_phone is not null and (length(ph) > 20 or ph !~ '^[0-9+() -]*$') then
    raise exception 'Please check the phone number.' using errcode = '22023';
  end if;
  if p_upi_id is not null and (length(up) > 100 or up !~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9]{2,32}$') then
    raise exception 'Please check the UPI ID. It should look like name@bank.' using errcode = '22023';
  end if;
  if p_address is not null and length(ad) > 200 then
    raise exception 'The address is too long. Keep it under 200 letters.' using errcode = '22023';
  end if;
  if p_assistant_name is not null and length(an) > 20 then
    raise exception 'The assistant name is too long. Keep it under 20 letters.' using errcode = '22023';
  end if;

  update public.shops
  set phone = case when p_phone is null then phone else ph end,
      upi_id = case when p_upi_id is null then upi_id else up end,
      address = case when p_address is null then address else ad end,
      assistant_name = case when p_assistant_name is null then assistant_name else an end
  where id = p_shop;
end;
$$;

-- 3. Access: only people who have signed in can call this. Nobody else, not even the public key.
revoke all on function public.update_my_shop_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_my_shop_profile(uuid, text, text, text, text) to authenticated;
