-- Test only: copies the default rights that Supabase gives new objects in the public schema.
-- The live project has these defaults; a plain Postgres scratch database does not. Run before patch-13 so that
-- patch-13's "no default rights for anon" lines are tested against the same starting point as the live project.
-- SCRATCH DATABASE ONLY (run-checks.cjs --scratch). Never run this on the live project.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Proves the starting point is real: a new table made now is open to anon. If not, the defaults test means nothing.
create table public.zz_defaults_probe (id int);
do $$
begin
  if not has_table_privilege('anon', 'public.zz_defaults_probe', 'select') then
    raise exception 'test setup: anon should have default rights here';
  end if;
end $$;
drop table public.zz_defaults_probe;
