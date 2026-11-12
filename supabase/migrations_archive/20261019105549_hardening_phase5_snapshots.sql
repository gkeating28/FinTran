-- Phase 5: VAT percentage on lines, party VAT numbers, and posting snapshots.

alter table public.transaction_lines
  add column vat_percentage numeric(5, 2) not null default 0;

alter table public.transaction_lines
  add constraint transaction_lines_vat_percentage_check
  check (vat_percentage >= 0 and vat_percentage <= 100);

alter table public.transaction_lines disable trigger zz_document_lines;

update public.transaction_lines as line
set vat_percentage = rate.rate
from public.vat_rates as rate
where line.vat_rate_id = rate.id;

alter table public.transaction_lines enable trigger zz_document_lines;

create or replace function private.enforce_transaction_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  header_org uuid;
  header_tenant uuid;
  header_type uuid;
  header_reference integer;
  vat_kind text;
  vat_rate numeric(5, 2);
  gross numeric(16, 4);
  copy_rate boolean;
begin
  select organisation_id, tenant_id, transaction_type_id, reference
    into header_org, header_tenant, header_type, header_reference
  from public.transaction_headers
  where id = new.header_id;

  if header_org is null then
    raise exception 'Choose a transaction';
  end if;

  new.organisation_id := header_org;
  new.tenant_id := header_tenant;
  new.transaction_type_id := header_type;
  new.reference := header_reference;
  new.description := btrim(new.description);

  gross := round(new.quantity * new.price, 4);
  if new.discount_amount > gross then
    raise exception 'Discount cannot be more than quantity times price';
  end if;

  new.nett_amount := gross - new.discount_amount;
  copy_rate := tg_op = 'INSERT' or new.vat_rate_id is distinct from old.vat_rate_id;

  if new.vat_rate_id is null then
    new.vat_percentage := 0;
  elsif copy_rate then
    select vat_type, rate into vat_kind, vat_rate
    from public.vat_rates
    where id = new.vat_rate_id;

    if vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;

    new.vat_percentage := vat_rate;
  else
    select vat_type into vat_kind
    from public.vat_rates
    where id = new.vat_rate_id;

    if vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;
  end if;

  new.vat_amount := round(new.nett_amount * new.vat_percentage / 100, 4);
  return new;
end;
$$;

revoke all on function private.enforce_transaction_line() from public, anon, authenticated;

create or replace function private.guard_posted_vat_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rate is distinct from old.rate or new.vat_type is distinct from old.vat_type then
    if exists (
      select 1
      from public.transaction_lines as line
      join public.transaction_headers as header on header.id = line.header_id
      where line.vat_rate_id = new.id
        and header.status in ('posted', 'void')
    ) then
      raise exception 'This VAT rate is used on posted documents. Create a new VAT code instead.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_posted_vat_rate() from public, anon, authenticated;

create trigger vat_rates_posted_use
  before update on public.vat_rates
  for each row execute function private.guard_posted_vat_rate();

alter table public.customers
  add column vat_number text;

alter table public.customers
  add constraint customers_vat_number_check check (
    vat_number is null or (
      char_length(vat_number) between 1 and 40
      and vat_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'
    )
  );

alter table public.suppliers
  add column vat_number text;

alter table public.suppliers
  add constraint suppliers_vat_number_check check (
    vat_number is null or (
      char_length(vat_number) between 1 and 40
      and vat_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'
    )
  );

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
  new.vat_number := nullif(btrim(new.vat_number), '');
  return new;
end;
$$;

revoke all on function private.enforce_party_scope() from public, anon, authenticated;

alter table public.transaction_headers
  add column issuer_snapshot jsonb,
  add column party_snapshot jsonb;

create or replace function private.organisation_logo_allowed(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organisation uuid;
begin
  if object_name is null
     or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|snapshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then
    return false;
  end if;

  organisation := split_part(object_name, '/', 1)::uuid;
  return private.is_org_member(organisation);
end;
$$;

revoke all on function private.organisation_logo_allowed(text) from public, anon;
grant execute on function private.organisation_logo_allowed(text) to authenticated, supabase_storage_admin;

create or replace function private.organisation_snapshot_allowed(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organisation uuid;
begin
  if object_name is null
     or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/snapshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  organisation := split_part(object_name, '/', 1)::uuid;
  return private.is_org_member(organisation);
end;
$$;

revoke all on function private.organisation_snapshot_allowed(text) from public, anon;
grant execute on function private.organisation_snapshot_allowed(text) to authenticated, supabase_storage_admin;

create policy organisation_logos_snapshot_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organisation-logos'
    and private.organisation_snapshot_allowed(name)
  );

drop function public.post_document(uuid);

create function public.post_document(p_header_id uuid, p_logo_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_supplier uuid;
  v_lines integer;
  v_issuer jsonb;
  v_party jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date, supplier_id
    into v_org, v_status, v_date, v_supplier
  from public.transaction_headers
  where id = p_header_id
  for update;

  if v_org is null then
    raise exception 'That document could not be posted';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft document can be posted';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;
  if p_logo_path is not null
     and p_logo_path is distinct from v_org::text || '/snapshots/' || p_header_id::text then
    raise exception 'The posted logo path is not valid';
  end if;

  select count(*) into v_lines
  from public.transaction_lines
  where header_id = p_header_id;

  if v_lines < 1 then
    raise exception 'Add a line before posting';
  end if;

  select jsonb_build_object(
    'name', organisation.name,
    'address', defaults.address,
    'contactName', defaults.contact_name,
    'contactEmail', defaults.contact_email,
    'website', defaults.website,
    'phone', defaults.phone,
    'vatNumber', defaults.vat_number,
    'companyNumber', defaults.company_number,
    'bankingDetails', defaults.banking_details,
    'logoPath', p_logo_path
  )
  into v_issuer
  from public.organisations as organisation
  left join public.organisation_defaults as defaults
    on defaults.organisation_id = organisation.id
  where organisation.id = v_org;

  select jsonb_build_object(
    'code', supplier.code,
    'name', supplier.name,
    'address', supplier.address,
    'phone', supplier.phone,
    'email', supplier.email,
    'website', supplier.website,
    'contactDetails', supplier.contact_details,
    'vatNumber', supplier.vat_number
  )
  into v_party
  from public.suppliers as supplier
  where supplier.id = v_supplier;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      issuer_snapshot = v_issuer,
      party_snapshot = v_party
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

revoke all on function public.post_document(uuid, text) from public, anon;
grant execute on function public.post_document(uuid, text) to authenticated;

alter table public.transaction_headers disable trigger zz_document_status;

update public.transaction_headers as header
set issuer_snapshot = jsonb_build_object(
      'name', organisation.name,
      'address', defaults.address,
      'contactName', defaults.contact_name,
      'contactEmail', defaults.contact_email,
      'website', defaults.website,
      'phone', defaults.phone,
      'vatNumber', defaults.vat_number,
      'companyNumber', defaults.company_number,
      'bankingDetails', defaults.banking_details,
      'logoPath', defaults.logo_path
    ),
    party_snapshot = (
      select jsonb_build_object(
        'code', supplier.code,
        'name', supplier.name,
        'address', supplier.address,
        'phone', supplier.phone,
        'email', supplier.email,
        'website', supplier.website,
        'contactDetails', supplier.contact_details,
        'vatNumber', supplier.vat_number
      )
      from public.suppliers as supplier
      where supplier.id = header.supplier_id
    )
from public.organisations as organisation
left join public.organisation_defaults as defaults
  on defaults.organisation_id = organisation.id
where header.organisation_id = organisation.id
  and header.status in ('posted', 'void')
  and header.issuer_snapshot is null;

alter table public.transaction_headers enable trigger zz_document_status;
