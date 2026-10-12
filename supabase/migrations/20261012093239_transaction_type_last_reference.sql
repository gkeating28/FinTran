create or replace function private.enforce_transaction_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A transaction type cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.description := btrim(new.description);

  if tg_op = 'INSERT' then
    new.last_reference := 0;
  else
    new.last_reference := old.last_reference;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_type() from public, anon, authenticated;

alter table public.transaction_types
  drop constraint transaction_types_last_reference_check;

alter table public.transaction_types
  add constraint transaction_types_last_reference_check check (last_reference >= 0);

alter table public.transaction_types disable trigger transaction_types_scope;

update public.transaction_types
set last_reference = 0;

alter table public.transaction_types enable trigger transaction_types_scope;
