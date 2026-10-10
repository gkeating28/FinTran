create table public.vat_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  description text not null,
  rate numeric(5, 2) not null,
  vat_type text not null,
  created_at timestamptz not null default now(),
  constraint vat_rates_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint vat_rates_description_check check (char_length(description) between 1 and 200),
  constraint vat_rates_rate_check check (rate >= 0 and rate <= 100),
  constraint vat_rates_vat_type_check check (vat_type in ('Sales', 'Expense')),
  unique (organisation_id, code)
);

create index vat_rates_tenant_id_idx on public.vat_rates (tenant_id);

create trigger vat_rates_scope
  before insert or update on public.vat_rates
  for each row execute function private.enforce_reference_scope();

alter table public.vat_rates enable row level security;

create policy vat_rates_select on public.vat_rates
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy vat_rates_insert on public.vat_rates
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy vat_rates_update on public.vat_rates
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy vat_rates_delete on public.vat_rates
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.vat_rates from public, anon;
grant select, insert, update, delete on table public.vat_rates to authenticated;
revoke truncate, references, trigger on table public.vat_rates from authenticated;
