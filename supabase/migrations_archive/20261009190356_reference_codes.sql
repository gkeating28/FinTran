create or replace function private.enforce_reference_scope()
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
    raise exception 'A code cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.description := btrim(new.description);
  return new;
end;
$$;

revoke all on function private.enforce_reference_scope() from public, anon, authenticated;

create table public.gl_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint gl_codes_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint gl_codes_description_check check (char_length(description) between 1 and 200),
  unique (organisation_id, code)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint departments_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint departments_description_check check (char_length(description) between 1 and 200),
  unique (organisation_id, code)
);

create table public.cost_centres (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint cost_centres_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint cost_centres_description_check check (char_length(description) between 1 and 200),
  unique (organisation_id, code)
);

create index gl_codes_tenant_id_idx on public.gl_codes (tenant_id);
create index departments_tenant_id_idx on public.departments (tenant_id);
create index cost_centres_tenant_id_idx on public.cost_centres (tenant_id);

create trigger gl_codes_scope
  before insert or update on public.gl_codes
  for each row execute function private.enforce_reference_scope();

create trigger departments_scope
  before insert or update on public.departments
  for each row execute function private.enforce_reference_scope();

create trigger cost_centres_scope
  before insert or update on public.cost_centres
  for each row execute function private.enforce_reference_scope();

alter table public.gl_codes enable row level security;
alter table public.departments enable row level security;
alter table public.cost_centres enable row level security;

create policy gl_codes_select on public.gl_codes
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));
create policy gl_codes_insert on public.gl_codes
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));
create policy gl_codes_update on public.gl_codes
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));
create policy gl_codes_delete on public.gl_codes
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy departments_select on public.departments
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));
create policy departments_insert on public.departments
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));
create policy departments_update on public.departments
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));
create policy departments_delete on public.departments
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy cost_centres_select on public.cost_centres
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));
create policy cost_centres_insert on public.cost_centres
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));
create policy cost_centres_update on public.cost_centres
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));
create policy cost_centres_delete on public.cost_centres
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.gl_codes from public, anon;
revoke all on table public.departments from public, anon;
revoke all on table public.cost_centres from public, anon;
grant select, insert, update, delete on table public.gl_codes to authenticated;
grant select, insert, update, delete on table public.departments to authenticated;
grant select, insert, update, delete on table public.cost_centres to authenticated;
