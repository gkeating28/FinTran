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
  elsif new.last_reference is distinct from old.last_reference
    and new.last_reference is distinct from old.last_reference + 1 then
    new.last_reference := old.last_reference;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_type() from public, anon, authenticated;

create or replace function private.enforce_transaction_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  type_org uuid;
  type_kind text;
  supplier_org uuid;
  currency_org uuid;
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

  select organisation_id, type into type_org, type_kind
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_org is null or type_org is distinct from new.organisation_id or type_kind is distinct from 'Purchases' then
    raise exception 'Choose a Purchases transaction type';
  end if;

  select organisation_id into supplier_org
  from public.suppliers
  where id = new.supplier_id;

  if supplier_org is null or supplier_org is distinct from new.organisation_id then
    raise exception 'Supplier must belong to this organisation';
  end if;

  select organisation_id into currency_org
  from public.currencies
  where id = new.currency_id;

  if currency_org is null or currency_org is distinct from new.organisation_id then
    raise exception 'Currency must belong to this organisation';
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
    update public.transaction_types
    set last_reference = last_reference + 1
    where id = new.transaction_type_id
    returning last_reference into new.reference;

    if new.reference is null then
      raise exception 'Choose a Purchases transaction type';
    end if;
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
  related_org uuid;
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

  if new.product_id is not null then
    select organisation_id into related_org from public.products where id = new.product_id;
    if related_org is null or related_org is distinct from header_org then
      raise exception 'Product must belong to this organisation';
    end if;
  end if;

  if new.gl_code_id is not null then
    select organisation_id into related_org from public.gl_codes where id = new.gl_code_id;
    if related_org is null or related_org is distinct from header_org then
      raise exception 'GL code must belong to this organisation';
    end if;
  end if;

  if new.department_id is not null then
    select organisation_id into related_org from public.departments where id = new.department_id;
    if related_org is null or related_org is distinct from header_org then
      raise exception 'Department must belong to this organisation';
    end if;
  end if;

  if new.cost_centre_id is not null then
    select organisation_id into related_org from public.cost_centres where id = new.cost_centre_id;
    if related_org is null or related_org is distinct from header_org then
      raise exception 'Cost centre must belong to this organisation';
    end if;
  end if;

  gross := round(new.quantity * new.price, 4);
  if new.discount_amount > gross then
    raise exception 'Discount cannot be more than quantity times price';
  end if;

  new.nett_amount := gross - new.discount_amount;

  if new.vat_rate_id is null then
    new.vat_amount := 0;
  else
    select organisation_id, vat_type, rate
      into related_org, vat_kind, vat_rate
    from public.vat_rates
    where id = new.vat_rate_id;

    if related_org is null or related_org is distinct from header_org then
      raise exception 'VAT code must belong to this organisation';
    end if;

    if vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;

    new.vat_amount := round(new.nett_amount * vat_rate / 100, 4);
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_line() from public, anon, authenticated;

create or replace function private.refresh_transaction_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  header uuid := coalesce(new.header_id, old.header_id);
begin
  update public.transaction_headers
  set foreign_nett_amount = foreign_nett_amount
  where id = header;

  return null;
end;
$$;

revoke all on function private.refresh_transaction_header() from public, anon, authenticated;

create table public.transaction_headers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  transaction_type_id uuid not null references public.transaction_types (id) on delete restrict,
  reference integer not null,
  transaction_date date not null,
  due_date date,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  supplier_name text not null,
  contact_details text,
  notes text,
  currency_id uuid not null references public.currencies (id) on delete restrict,
  exchange_rate numeric(16, 8) not null,
  order_number text,
  foreign_nett_amount numeric(16, 4) not null default 0,
  foreign_vat_amount numeric(16, 4) not null default 0,
  foreign_total_amount numeric(16, 4) not null default 0,
  home_nett_amount numeric(16, 4) not null default 0,
  home_vat_amount numeric(16, 4) not null default 0,
  home_total_amount numeric(16, 4) not null default 0,
  paid_amount numeric(16, 4) not null default 0,
  flex1 text,
  flex2 text,
  flex3 text,
  flex4 text,
  flex5 text,
  created_at timestamptz not null default now(),
  constraint transaction_headers_reference_check check (reference > 0),
  constraint transaction_headers_supplier_name_check check (char_length(supplier_name) between 1 and 200),
  constraint transaction_headers_contact_details_check check (
    contact_details is null or char_length(contact_details) between 1 and 500
  ),
  constraint transaction_headers_notes_check check (notes is null or char_length(notes) between 1 and 4000),
  constraint transaction_headers_exchange_rate_check check (exchange_rate > 0),
  constraint transaction_headers_order_number_check check (
    order_number is null or char_length(order_number) between 1 and 40
  ),
  constraint transaction_headers_paid_amount_check check (paid_amount >= 0),
  constraint transaction_headers_flex1_check check (flex1 is null or char_length(flex1) between 1 and 200),
  constraint transaction_headers_flex2_check check (flex2 is null or char_length(flex2) between 1 and 200),
  constraint transaction_headers_flex3_check check (flex3 is null or char_length(flex3) between 1 and 200),
  constraint transaction_headers_flex4_check check (flex4 is null or char_length(flex4) between 1 and 200),
  constraint transaction_headers_flex5_check check (flex5 is null or char_length(flex5) between 1 and 200),
  unique (organisation_id, transaction_type_id, reference)
);

create index transaction_headers_tenant_id_idx on public.transaction_headers (tenant_id);
create index transaction_headers_transaction_type_id_idx on public.transaction_headers (transaction_type_id);
create index transaction_headers_supplier_id_idx on public.transaction_headers (supplier_id);
create index transaction_headers_currency_id_idx on public.transaction_headers (currency_id);
create index transaction_headers_transaction_date_idx on public.transaction_headers (transaction_date);

create trigger transaction_headers_scope
  before insert or update on public.transaction_headers
  for each row execute function private.enforce_transaction_header();

create table public.transaction_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  header_id uuid not null references public.transaction_headers (id) on delete cascade,
  transaction_type_id uuid not null references public.transaction_types (id) on delete restrict,
  reference integer not null,
  line_number integer not null,
  product_id uuid references public.products (id) on delete restrict,
  description text not null,
  gl_code_id uuid references public.gl_codes (id) on delete restrict,
  department_id uuid references public.departments (id) on delete restrict,
  cost_centre_id uuid references public.cost_centres (id) on delete restrict,
  vat_rate_id uuid references public.vat_rates (id) on delete restrict,
  quantity numeric(16, 4) not null,
  price numeric(16, 4) not null,
  discount_amount numeric(16, 4) not null default 0,
  nett_amount numeric(16, 4) not null,
  vat_amount numeric(16, 4) not null,
  created_at timestamptz not null default now(),
  constraint transaction_lines_line_number_check check (line_number > 0),
  constraint transaction_lines_description_check check (char_length(description) between 1 and 200),
  constraint transaction_lines_quantity_check check (quantity > 0),
  constraint transaction_lines_price_check check (price >= 0),
  constraint transaction_lines_discount_amount_check check (discount_amount >= 0),
  unique (header_id, line_number)
);

create index transaction_lines_tenant_id_idx on public.transaction_lines (tenant_id);
create index transaction_lines_header_id_idx on public.transaction_lines (header_id);
create index transaction_lines_product_id_idx on public.transaction_lines (product_id);
create index transaction_lines_gl_code_id_idx on public.transaction_lines (gl_code_id);
create index transaction_lines_department_id_idx on public.transaction_lines (department_id);
create index transaction_lines_cost_centre_id_idx on public.transaction_lines (cost_centre_id);
create index transaction_lines_vat_rate_id_idx on public.transaction_lines (vat_rate_id);

create trigger transaction_lines_scope
  before insert or update on public.transaction_lines
  for each row execute function private.enforce_transaction_line();

create trigger transaction_lines_refresh_header
  after insert or update or delete on public.transaction_lines
  for each row execute function private.refresh_transaction_header();

alter table public.transaction_headers enable row level security;
alter table public.transaction_lines enable row level security;

create policy transaction_headers_select on public.transaction_headers
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy transaction_headers_insert on public.transaction_headers
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_headers_update on public.transaction_headers
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_headers_delete on public.transaction_headers
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy transaction_lines_select on public.transaction_lines
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy transaction_lines_insert on public.transaction_lines
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_lines_update on public.transaction_lines
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy transaction_lines_delete on public.transaction_lines
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.transaction_headers from public, anon;
grant select, insert, update, delete on table public.transaction_headers to authenticated;
revoke truncate, references, trigger on table public.transaction_headers from authenticated;

revoke all on table public.transaction_lines from public, anon;
grant select, insert, update, delete on table public.transaction_lines to authenticated;
revoke truncate, references, trigger on table public.transaction_lines from authenticated;

create or replace function public.save_purchase_invoice(p_document jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org uuid;
  tenant uuid;
  header_id uuid;
  supplier_name text;
  line jsonb;
  line_number integer := 0;
begin
  select organisation_id, tenant_id into org, tenant
  from public.transaction_types
  where id = nullif(p_document->>'transactionTypeId', '')::uuid
    and type = 'Purchases';

  if org is null or not (select private.is_org_member(org)) then
    raise exception 'Choose a Purchases transaction type';
  end if;

  select name into supplier_name
  from public.suppliers
  where id = nullif(p_document->>'supplierId', '')::uuid
    and organisation_id = org;

  if supplier_name is null then
    raise exception 'Choose a supplier';
  end if;

  if nullif(btrim(p_document->>'supplierName'), '') is not null then
    supplier_name := btrim(p_document->>'supplierName');
  end if;

  header_id := nullif(p_document->>'id', '')::uuid;

  if header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, supplier_name, contact_details, notes,
      currency_id, exchange_rate, order_number, paid_amount,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      tenant,
      org,
      (p_document->>'transactionTypeId')::uuid,
      0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      (p_document->>'supplierId')::uuid,
      supplier_name,
      p_document->>'contactDetails',
      p_document->>'notes',
      (p_document->>'currencyId')::uuid,
      (p_document->>'exchangeRate')::numeric,
      p_document->>'orderNumber',
      coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      p_document->>'flex1',
      p_document->>'flex2',
      p_document->>'flex3',
      p_document->>'flex4',
      p_document->>'flex5'
    )
    returning id into header_id;
  else
    update public.transaction_headers
    set transaction_date = (p_document->>'transactionDate')::date,
        due_date = nullif(p_document->>'dueDate', '')::date,
        supplier_id = (p_document->>'supplierId')::uuid,
        supplier_name = supplier_name,
        contact_details = p_document->>'contactDetails',
        notes = p_document->>'notes',
        currency_id = (p_document->>'currencyId')::uuid,
        exchange_rate = (p_document->>'exchangeRate')::numeric,
        order_number = p_document->>'orderNumber',
        paid_amount = coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
        flex1 = p_document->>'flex1',
        flex2 = p_document->>'flex2',
        flex3 = p_document->>'flex3',
        flex4 = p_document->>'flex4',
        flex5 = p_document->>'flex5'
    where id = header_id
      and organisation_id = org;

    if not found then
      raise exception 'That invoice could not be updated';
    end if;

    delete from public.transaction_lines where header_id = header_id;
  end if;

  for line in
    select value from jsonb_array_elements(coalesce(p_document->'lines', '[]'::jsonb))
  loop
    line_number := line_number + 1;
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
      quantity, price, discount_amount, nett_amount, vat_amount
    ) values (
      tenant,
      org,
      header_id,
      (p_document->>'transactionTypeId')::uuid,
      0,
      line_number,
      nullif(line->>'productId', '')::uuid,
      coalesce(line->>'description', ''),
      nullif(line->>'glCodeId', '')::uuid,
      nullif(line->>'departmentId', '')::uuid,
      nullif(line->>'costCentreId', '')::uuid,
      nullif(line->>'vatRateId', '')::uuid,
      coalesce(nullif(line->>'quantity', '')::numeric, 0),
      coalesce(nullif(line->>'price', '')::numeric, 0),
      coalesce(nullif(line->>'discountAmount', '')::numeric, 0),
      0,
      0
    );
  end loop;

  return header_id;
end;
$$;

revoke all on function public.save_purchase_invoice(jsonb) from public, anon;
grant execute on function public.save_purchase_invoice(jsonb) to authenticated;
