-- Phase 3: composite foreign keys keep every reference inside one organisation.

alter table public.currencies add constraint currencies_organisation_id_id_key unique (organisation_id, id);
alter table public.gl_codes add constraint gl_codes_organisation_id_id_key unique (organisation_id, id);
alter table public.departments add constraint departments_organisation_id_id_key unique (organisation_id, id);
alter table public.cost_centres add constraint cost_centres_organisation_id_id_key unique (organisation_id, id);
alter table public.vat_rates add constraint vat_rates_organisation_id_id_key unique (organisation_id, id);
alter table public.products add constraint products_organisation_id_id_key unique (organisation_id, id);
alter table public.customers add constraint customers_organisation_id_id_key unique (organisation_id, id);
alter table public.suppliers add constraint suppliers_organisation_id_id_key unique (organisation_id, id);
alter table public.transaction_types add constraint transaction_types_organisation_id_id_key unique (organisation_id, id);
alter table public.transaction_headers add constraint transaction_headers_organisation_id_id_key unique (organisation_id, id);

alter table public.organisation_defaults drop constraint organisation_defaults_home_currency_id_fkey;
alter table public.organisation_defaults
  add constraint organisation_defaults_home_currency_id_fkey
  foreign key (organisation_id, home_currency_id)
  references public.currencies (organisation_id, id)
  on delete restrict;

alter table public.products drop constraint products_purchase_gl_code_id_fkey;
alter table public.products
  add constraint products_purchase_gl_code_id_fkey
  foreign key (organisation_id, purchase_gl_code_id)
  references public.gl_codes (organisation_id, id)
  on delete restrict;

alter table public.products drop constraint products_sales_gl_code_id_fkey;
alter table public.products
  add constraint products_sales_gl_code_id_fkey
  foreign key (organisation_id, sales_gl_code_id)
  references public.gl_codes (organisation_id, id)
  on delete restrict;

alter table public.products drop constraint products_purchase_vat_code_id_fkey;
alter table public.products
  add constraint products_purchase_vat_code_id_fkey
  foreign key (organisation_id, purchase_vat_code_id)
  references public.vat_rates (organisation_id, id)
  on delete restrict;

alter table public.products drop constraint products_sales_vat_code_id_fkey;
alter table public.products
  add constraint products_sales_vat_code_id_fkey
  foreign key (organisation_id, sales_vat_code_id)
  references public.vat_rates (organisation_id, id)
  on delete restrict;

alter table public.customers drop constraint customers_currency_id_fkey;
alter table public.customers
  add constraint customers_currency_id_fkey
  foreign key (organisation_id, currency_id)
  references public.currencies (organisation_id, id)
  on delete restrict;

alter table public.suppliers drop constraint suppliers_currency_id_fkey;
alter table public.suppliers
  add constraint suppliers_currency_id_fkey
  foreign key (organisation_id, currency_id)
  references public.currencies (organisation_id, id)
  on delete restrict;

alter table public.transaction_forms drop constraint transaction_forms_transaction_type_id_fkey;
alter table public.transaction_forms
  add constraint transaction_forms_transaction_type_id_fkey
  foreign key (organisation_id, transaction_type_id)
  references public.transaction_types (organisation_id, id)
  on delete cascade;

alter table public.transaction_headers drop constraint transaction_headers_transaction_type_id_fkey;
alter table public.transaction_headers
  add constraint transaction_headers_transaction_type_id_fkey
  foreign key (organisation_id, transaction_type_id)
  references public.transaction_types (organisation_id, id)
  on delete restrict;

alter table public.transaction_headers drop constraint transaction_headers_supplier_id_fkey;
alter table public.transaction_headers
  add constraint transaction_headers_supplier_id_fkey
  foreign key (organisation_id, supplier_id)
  references public.suppliers (organisation_id, id)
  on delete restrict;

alter table public.transaction_headers drop constraint transaction_headers_currency_id_fkey;
alter table public.transaction_headers
  add constraint transaction_headers_currency_id_fkey
  foreign key (organisation_id, currency_id)
  references public.currencies (organisation_id, id)
  on delete restrict;

alter table public.transaction_lines drop constraint transaction_lines_header_id_fkey;
alter table public.transaction_lines
  add constraint transaction_lines_header_id_fkey
  foreign key (organisation_id, header_id)
  references public.transaction_headers (organisation_id, id)
  on delete cascade;

alter table public.transaction_lines drop constraint transaction_lines_product_id_fkey;
alter table public.transaction_lines
  add constraint transaction_lines_product_id_fkey
  foreign key (organisation_id, product_id)
  references public.products (organisation_id, id)
  on delete restrict;

alter table public.transaction_lines drop constraint transaction_lines_gl_code_id_fkey;
alter table public.transaction_lines
  add constraint transaction_lines_gl_code_id_fkey
  foreign key (organisation_id, gl_code_id)
  references public.gl_codes (organisation_id, id)
  on delete restrict;

alter table public.transaction_lines drop constraint transaction_lines_department_id_fkey;
alter table public.transaction_lines
  add constraint transaction_lines_department_id_fkey
  foreign key (organisation_id, department_id)
  references public.departments (organisation_id, id)
  on delete restrict;

alter table public.transaction_lines drop constraint transaction_lines_cost_centre_id_fkey;
alter table public.transaction_lines
  add constraint transaction_lines_cost_centre_id_fkey
  foreign key (organisation_id, cost_centre_id)
  references public.cost_centres (organisation_id, id)
  on delete restrict;

alter table public.transaction_lines drop constraint transaction_lines_vat_rate_id_fkey;
alter table public.transaction_lines
  add constraint transaction_lines_vat_rate_id_fkey
  foreign key (organisation_id, vat_rate_id)
  references public.vat_rates (organisation_id, id)
  on delete restrict;

alter table public.transaction_lines drop constraint transaction_lines_transaction_type_id_fkey;
alter table public.transaction_lines
  add constraint transaction_lines_transaction_type_id_fkey
  foreign key (organisation_id, transaction_type_id)
  references public.transaction_types (organisation_id, id)
  on delete restrict;

create or replace function private.enforce_home_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    raise exception 'Defaults cannot be moved to another organisation';
  end if;

  new.address := nullif(btrim(new.address), '');
  new.contact_name := nullif(btrim(new.contact_name), '');
  new.contact_email := nullif(btrim(new.contact_email), '');
  new.website := nullif(btrim(new.website), '');
  new.phone := nullif(btrim(new.phone), '');
  new.vat_number := nullif(btrim(new.vat_number), '');
  new.company_number := nullif(btrim(new.company_number), '');
  new.banking_details := nullif(btrim(new.banking_details), '');
  new.logo_path := nullif(btrim(new.logo_path), '');
  return new;
end;
$$;

revoke all on function private.enforce_home_currency() from public, anon, authenticated;

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

create or replace function private.enforce_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  gl_type text;
  vat_kind text;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A product cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.description := btrim(new.description);

  select account_type into gl_type from public.gl_codes where id = new.purchase_gl_code_id;
  if gl_type is distinct from 'Expense' then
    raise exception 'Purchase GL code must be an Expense account';
  end if;

  select account_type into gl_type from public.gl_codes where id = new.sales_gl_code_id;
  if gl_type is distinct from 'Income' then
    raise exception 'Sales GL code must be an Income account';
  end if;

  select vat_type into vat_kind from public.vat_rates where id = new.purchase_vat_code_id;
  if vat_kind is distinct from 'Expense' then
    raise exception 'Purchase VAT code must be an Expense rate';
  end if;

  select vat_type into vat_kind from public.vat_rates where id = new.sales_vat_code_id;
  if vat_kind is distinct from 'Sales' then
    raise exception 'Sales VAT code must be a Sales rate';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_product() from public, anon, authenticated;

create or replace function private.enforce_transaction_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A form cannot be moved to another transaction type';
  end if;

  if jsonb_typeof(new.layout) is distinct from 'object' or char_length(new.layout::text) > 8000 then
    raise exception 'Form layout must be an object';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_form() from public, anon, authenticated;

create or replace function private.enforce_transaction_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  type_kind text;
  nett numeric(16, 4);
  vat numeric(16, 4);
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id
       or new.reference is distinct from old.reference) then
    raise exception 'A transaction cannot be moved or renumbered';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  select type into type_kind
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_kind is distinct from 'Purchases' then
    raise exception 'Choose a Purchases transaction type';
  end if;

  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;

  new.supplier_name := btrim(new.supplier_name);
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  new.order_number := nullif(btrim(new.order_number), '');
  new.flex1 := nullif(btrim(new.flex1), '');
  new.flex2 := nullif(btrim(new.flex2), '');
  new.flex3 := nullif(btrim(new.flex3), '');
  new.flex4 := nullif(btrim(new.flex4), '');
  new.flex5 := nullif(btrim(new.flex5), '');

  if tg_op = 'INSERT' then
    new.reference := private.issue_reference(new.transaction_type_id);
  end if;

  select coalesce(sum(nett_amount), 0), coalesce(sum(vat_amount), 0)
    into nett, vat
  from public.transaction_lines
  where header_id = new.id;

  new.foreign_nett_amount := nett;
  new.foreign_vat_amount := vat;
  new.foreign_total_amount := nett + vat;
  new.home_nett_amount := round(nett / new.exchange_rate, 4);
  new.home_vat_amount := round(vat / new.exchange_rate, 4);
  new.home_total_amount := round((nett + vat) / new.exchange_rate, 4);

  return new;
end;
$$;

revoke all on function private.enforce_transaction_header() from public, anon, authenticated;

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

  if new.vat_rate_id is null then
    new.vat_amount := 0;
  else
    select vat_type, rate into vat_kind, vat_rate
    from public.vat_rates
    where id = new.vat_rate_id;

    if vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;

    new.vat_amount := round(new.nett_amount * vat_rate / 100, 4);
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_line() from public, anon, authenticated;
