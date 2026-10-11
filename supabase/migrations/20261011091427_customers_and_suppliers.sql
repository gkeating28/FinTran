create or replace function private.enforce_party_scope()
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
    raise exception 'A record cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.name := btrim(new.name);
  new.phone := nullif(btrim(new.phone), '');
  new.email := nullif(btrim(new.email), '');
  new.website := nullif(btrim(new.website), '');
  new.address := nullif(btrim(new.address), '');
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$$;

revoke all on function private.enforce_party_scope() from public, anon, authenticated;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  name text not null,
  phone text,
  email text,
  website text,
  address text,
  contact_details text,
  notes text,
  created_at timestamptz not null default now(),
  constraint customers_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint customers_name_check check (char_length(name) between 1 and 200),
  constraint customers_phone_check check (
    phone is null or (char_length(phone) between 1 and 40 and phone ~ '^[0-9+(). -]+$')
  ),
  constraint customers_email_check check (
    email is null or (
      char_length(email) <= 200
      and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  constraint customers_website_check check (
    website is null or (char_length(website) between 1 and 200 and website !~ '[[:space:]]')
  ),
  constraint customers_address_check check (address is null or char_length(address) between 1 and 500),
  constraint customers_contact_details_check check (
    contact_details is null or char_length(contact_details) between 1 and 500
  ),
  constraint customers_notes_check check (notes is null or char_length(notes) between 1 and 4000),
  unique (organisation_id, code)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  name text not null,
  phone text,
  email text,
  website text,
  address text,
  contact_details text,
  notes text,
  created_at timestamptz not null default now(),
  constraint suppliers_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint suppliers_name_check check (char_length(name) between 1 and 200),
  constraint suppliers_phone_check check (
    phone is null or (char_length(phone) between 1 and 40 and phone ~ '^[0-9+(). -]+$')
  ),
  constraint suppliers_email_check check (
    email is null or (
      char_length(email) <= 200
      and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  constraint suppliers_website_check check (
    website is null or (char_length(website) between 1 and 200 and website !~ '[[:space:]]')
  ),
  constraint suppliers_address_check check (address is null or char_length(address) between 1 and 500),
  constraint suppliers_contact_details_check check (
    contact_details is null or char_length(contact_details) between 1 and 500
  ),
  constraint suppliers_notes_check check (notes is null or char_length(notes) between 1 and 4000),
  unique (organisation_id, code)
);

create index customers_tenant_id_idx on public.customers (tenant_id);
create index suppliers_tenant_id_idx on public.suppliers (tenant_id);

create trigger customers_scope
  before insert or update on public.customers
  for each row execute function private.enforce_party_scope();

create trigger suppliers_scope
  before insert or update on public.suppliers
  for each row execute function private.enforce_party_scope();

alter table public.customers enable row level security;
alter table public.suppliers enable row level security;

create policy customers_select on public.customers
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy customers_insert on public.customers
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy customers_update on public.customers
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy customers_delete on public.customers
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy suppliers_select on public.suppliers
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy suppliers_update on public.suppliers
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.customers from public, anon;
revoke all on table public.suppliers from public, anon;
grant select, insert, update, delete on table public.customers to authenticated;
grant select, insert, update, delete on table public.suppliers to authenticated;
revoke truncate, references, trigger on table public.customers from authenticated;
revoke truncate, references, trigger on table public.suppliers from authenticated;
