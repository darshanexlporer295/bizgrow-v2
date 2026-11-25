-- patch-05: remove or change a person who was invited but has not signed in yet.
-- Safe to run more than once.
create or replace function public.remove_staff_invite(p_invite uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i public.staff_invites%rowtype;
begin
  select * into v_i from public.staff_invites where id = p_invite and claimed_at is null for update;
  if not found then raise exception 'Person not found'; end if;
  perform public._need(v_i.shop_id, array['owner','manager'], 'Only the owner or manager can remove staff');
  delete from public.staff_invites where id = p_invite;
  perform public._audit(v_i.shop_id, 'delete', 'staff', p_invite, 'Removed invite for ' || coalesce(v_i.name, v_i.email));
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.update_staff_invite(p_invite uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_i public.staff_invites%rowtype;
begin
  select * into v_i from public.staff_invites where id = p_invite and claimed_at is null for update;
  if not found then raise exception 'Person not found'; end if;
  perform public._need(v_i.shop_id, array['owner'], 'Only the owner can change an invite');
  if p_role is null or p_role not in ('manager', 'cashier', 'stock-keeper', 'accountant') then
    raise exception 'Pick a role';
  end if;
  update public.staff_invites set role = p_role where id = p_invite;
  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.remove_staff_invite(uuid) from public, anon;
revoke all on function public.update_staff_invite(uuid, text) from public, anon;
grant execute on function public.remove_staff_invite(uuid) to authenticated;
grant execute on function public.update_staff_invite(uuid, text) to authenticated;
