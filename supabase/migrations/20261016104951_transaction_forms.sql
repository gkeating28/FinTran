create or replace function private.enforce_transaction_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_org uuid;
  type_tenant uuid;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A form cannot be moved to another transaction type';
  end if;

  select organisation_id, tenant_id into type_org, type_tenant
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_org is null
     or type_org is distinct from new.organisation_id
     or type_tenant is distinct from new.tenant_id then
    raise exception 'Transaction type must belong to this organisation';
  end if;

  if jsonb_typeof(new.layout) is distinct from 'object' or char_length(new.layout::text) > 8000 then
    raise exception 'Form layout must be an object';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.enforce_transaction_form() from public, anon, authenticated;

create table public.transaction_forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  transaction_type_id uuid not null references public.transaction_types (id) on delete cascade,
  layout jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_forms_layout_check check (
    jsonb_typeof(layout) = 'object' and char_length(layout::text) <= 8000
  ),
  unique (organisation_id, transaction_type_id)
);

create index transaction_forms_tenant_id_idx on public.transaction_forms (tenant_id);
create index transaction_forms_transaction_type_id_idx on public.transaction_forms (transaction_type_id);

create trigger transaction_forms_scope
  before insert or update on public.transaction_forms
  for each row execute function private.enforce_transaction_form();

alter table public.transaction_forms enable row level security;

create policy transaction_forms_select on public.transaction_forms
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy transaction_forms_insert on public.transaction_forms
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_forms_update on public.transaction_forms
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_forms_delete on public.transaction_forms
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.transaction_forms from public, anon;
grant select, insert, update, delete on table public.transaction_forms to authenticated;
revoke truncate, references, trigger on table public.transaction_forms from authenticated;
