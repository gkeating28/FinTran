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
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.organisation_id::text, 4815162342::bigint)
    );

    select coalesce(max(last_reference), 0) + 1
      into new.last_reference
    from public.transaction_types
    where organisation_id = new.organisation_id;
  else
    new.last_reference := old.last_reference;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_type() from public, anon, authenticated;

create table public.transaction_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  description text not null,
  last_reference integer not null,
  type text not null,
  created_at timestamptz not null default now(),
  constraint transaction_types_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint transaction_types_description_check check (char_length(description) between 1 and 200),
  constraint transaction_types_last_reference_check check (last_reference > 0),
  constraint transaction_types_type_check check (type in ('Sales', 'Purchases')),
  unique (organisation_id, code)
);

create index transaction_types_tenant_id_idx on public.transaction_types (tenant_id);

create trigger transaction_types_scope
  before insert or update on public.transaction_types
  for each row execute function private.enforce_transaction_type();

alter table public.transaction_types enable row level security;

create policy transaction_types_select on public.transaction_types
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy transaction_types_insert on public.transaction_types
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_types_update on public.transaction_types
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_types_delete on public.transaction_types
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.transaction_types from public, anon;
grant select, insert, update, delete on table public.transaction_types to authenticated;
revoke truncate, references, trigger on table public.transaction_types from authenticated;
