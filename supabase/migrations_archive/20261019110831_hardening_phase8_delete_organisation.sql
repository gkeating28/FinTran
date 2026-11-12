-- Phase 8: an organisation with documents cannot be deleted, and only an owner can delete one.

alter table public.transaction_headers drop constraint transaction_headers_organisation_id_fkey;

alter table public.transaction_headers
  add constraint transaction_headers_organisation_id_fkey
  foreign key (organisation_id) references public.organisations (id) on delete restrict;

create or replace function public.delete_organisation(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_organisations integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before deleting an organisation';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner'])) then
    raise exception 'You need an owner role to delete an organisation';
  end if;

  select tenant_id into v_tenant
  from public.organisations
  where id = p_organisation_id;

  if v_tenant is null then
    raise exception 'That organisation could not be deleted';
  end if;
  if exists (
    select 1 from public.transaction_headers where organisation_id = p_organisation_id
  ) then
    raise exception 'This organisation has documents and cannot be deleted.';
  end if;

  select count(*) into v_organisations
  from public.organisations
  where tenant_id = v_tenant;

  if v_organisations <= 1 then
    raise exception 'A tenant must keep at least one organisation';
  end if;

  delete from public.organisations where id = p_organisation_id;
end;
$$;

revoke all on function public.delete_organisation(uuid) from public, anon;
grant execute on function public.delete_organisation(uuid) to authenticated;
