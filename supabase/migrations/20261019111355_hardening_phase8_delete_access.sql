-- Deleting an organisation removes its access rows. That must not be blocked
-- by the rule that an organisation keeps an owner while it still exists.

create or replace function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_others integer;
begin
  if current_setting('fintran.deleting_organisation', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if old.role = 'owner'
     and (
       tg_op = 'DELETE'
       or new.role is distinct from 'owner'
       or new.organisation_id is distinct from old.organisation_id
     )
  then
    select count(*) into v_others
    from public.organisation_access
    where organisation_id = old.organisation_id
      and role = 'owner'
      and user_id is distinct from old.user_id;

    if v_others = 0 then
      raise exception 'An organisation must keep at least one owner.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_last_owner() from public, anon, authenticated;

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

  perform set_config('fintran.deleting_organisation', 'on', true);
  delete from public.organisations where id = p_organisation_id;
  perform set_config('fintran.deleting_organisation', 'off', true);
end;
$$;

revoke all on function public.delete_organisation(uuid) from public, anon;
grant execute on function public.delete_organisation(uuid) to authenticated;
