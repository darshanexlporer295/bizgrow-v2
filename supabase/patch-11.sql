-- patch-11: suppliers can be added, edited and deleted in the real app (stage 10).
-- Run once in the Supabase SQL Editor after patch-09 (or use supabase/run-all-pending.sql).
-- Safe to run more than once.
-- What changes:
--   * Suppliers get two new fields: what they supply (items) and a note.
--   * New functions upsert_supplier (add or edit) and delete_supplier (soft delete, like items and people).
--     Owner, manager and stock-keeper can add and edit. Owner and manager can delete, as the rules already
--     said in the role table. Each change writes one line to the activity log.
--   * Only signed-in users can run these. The public (anon) role gets nothing.
-- Nothing is deleted and no existing supplier changes.

alter table public.suppliers add column if not exists items text;
alter table public.suppliers add column if not exists note text;

-- ---------- add or edit a supplier ----------
create or replace function public.upsert_supplier(
  p_shop uuid, p_id uuid, p_name text, p_phone text, p_items text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text := trim(coalesce(p_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_items text := nullif(trim(coalesce(p_items, '')), '');
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_id    uuid;
begin
  perform public._need(p_shop, array['owner','manager','stock-keeper'],
    'Your role cannot change suppliers. Ask the owner or manager.');

  if v_name = '' then raise exception 'Supplier name is needed'; end if;
  if length(v_name) > 60 then raise exception 'Supplier name is too long (max 60 letters)'; end if;
  if v_phone is not null and length(v_phone) > 20 then raise exception 'Phone number is too long'; end if;
  if v_items is not null and length(v_items) > 120 then raise exception 'What they supply is too long (max 120 letters)'; end if;
  if v_note is not null and length(v_note) > 200 then raise exception 'Note is too long (max 200 letters)'; end if;

  if p_id is null then
    insert into public.suppliers (shop_id, name, phone, items, note)
    values (p_shop, v_name, v_phone, v_items, v_note)
    returning id into v_id;
    perform public._audit(p_shop, 'create', 'suppliers', v_id, 'Supplier ' || v_name);
  else
    update public.suppliers
       set name = v_name, phone = v_phone, items = v_items, note = v_note
     where id = p_id and shop_id = p_shop and deleted_at is null
     returning id into v_id;
    if v_id is null then raise exception 'Supplier not found'; end if;
    perform public._audit(p_shop, 'update', 'suppliers', v_id, 'Supplier ' || v_name);
  end if;
  return v_id;
end
$$;

-- ---------- delete a supplier (soft delete) ----------
create or replace function public.delete_supplier(p_shop uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  perform public._need(p_shop, array['owner','manager'], 'Only the owner or manager can delete a supplier');

  update public.suppliers set deleted_at = now()
   where id = p_id and shop_id = p_shop and deleted_at is null
  returning name into v_name;
  if not found then raise exception 'Supplier not found'; end if;

  perform public._audit(p_shop, 'delete', 'suppliers', p_id, 'Supplier ' || v_name);
  return jsonb_build_object('ok', true);
end
$$;

-- ---------- grants ----------
-- Signed-in users only. New functions are open to everyone by default in Postgres, so close that first.
revoke all on function
  public.upsert_supplier(uuid, uuid, text, text, text, text),
  public.delete_supplier(uuid, uuid)
  from public, anon;

grant execute on function
  public.upsert_supplier(uuid, uuid, text, text, text, text),
  public.delete_supplier(uuid, uuid)
  to authenticated;
