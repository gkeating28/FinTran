-- Owners and admins can change an organisation's display name. The slug stays as it was.

create or replace function public.rename_organisation(p_organisation_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before renaming an organisation';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to rename an organisation';
  end if;
  if char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 80 then
    raise exception 'Organisation name must be between 2 and 80 characters';
  end if;

  update public.organisations
  set name = btrim(p_name)
  where id = p_organisation_id;

  if not found then
    raise exception 'That organisation could not be renamed';
  end if;
end;
$$;

revoke all on function public.rename_organisation(uuid, text) from public, anon;
grant execute on function public.rename_organisation(uuid, text) to authenticated;
