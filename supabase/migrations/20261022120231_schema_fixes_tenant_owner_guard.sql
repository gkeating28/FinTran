-- A direct tenant delete cascades through organisation access. The last-owner
-- guard must allow that, or a tenant with no documents cannot be removed.

create or replace function private.begin_tenant_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('fintran.deleting_organisation', 'on', true);
  return old;
end;
$$;

revoke all on function private.begin_tenant_delete() from public, anon, authenticated;

create or replace function private.finish_tenant_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('fintran.deleting_organisation', 'off', true);
  return old;
end;
$$;

revoke all on function private.finish_tenant_delete() from public, anon, authenticated;

create trigger tenants_begin_delete
  before delete on public.tenants
  for each row execute function private.begin_tenant_delete();

create trigger tenants_finish_delete
  after delete on public.tenants
  for each row execute function private.finish_tenant_delete();
