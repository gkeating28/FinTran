-- Phase 7: supplier invoice number, supply date, customer on the header, and code format.

alter table public.transaction_headers
  add column supplier_reference text,
  add column supply_date date,
  add column customer_id uuid;

alter table public.transaction_headers
  add constraint transaction_headers_supplier_reference_check
  check (supplier_reference is null or char_length(supplier_reference) between 1 and 60);

alter table public.transaction_headers alter column supplier_id drop not null;

alter table public.transaction_headers
  add constraint transaction_headers_customer_id_fkey
  foreign key (organisation_id, customer_id)
  references public.customers (organisation_id, id)
  on delete restrict;

create unique index transaction_headers_supplier_reference_idx
  on public.transaction_headers (organisation_id, supplier_id, upper(supplier_reference))
  where supplier_reference is not null and status <> 'void';

create or replace function private.enforce_transaction_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  type_kind text;
  v_numbering public.numbering_rule;
  nett numeric(16, 4);
  vat numeric(16, 4);
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A transaction cannot be moved or renumbered';
  end if;

  if tg_op = 'UPDATE' and new.reference is distinct from old.reference then
    if old.reference is not null
       or current_setting('fintran.status_change', true) is distinct from 'on' then
      raise exception 'A transaction cannot be moved or renumbered';
    end if;
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  select type, numbering into type_kind, v_numbering
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_kind is distinct from 'Purchases' then
    raise exception 'Choose a Purchases transaction type';
  end if;
  if new.supplier_id is null then
    raise exception 'Choose a supplier';
  end if;
  if new.customer_id is not null then
    raise exception 'A purchase document cannot have a customer';
  end if;

  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;

  new.supplier_name := btrim(new.supplier_name);
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  new.order_number := nullif(btrim(new.order_number), '');
  new.supplier_reference := nullif(btrim(new.supplier_reference), '');
  new.flex1 := nullif(btrim(new.flex1), '');
  new.flex2 := nullif(btrim(new.flex2), '');
  new.flex3 := nullif(btrim(new.flex3), '');
  new.flex4 := nullif(btrim(new.flex4), '');
  new.flex5 := nullif(btrim(new.flex5), '');

  if tg_op = 'INSERT' and v_numbering is distinct from 'on_post' then
    new.reference := private.issue_reference(new.transaction_type_id);
  elsif tg_op = 'INSERT' then
    new.reference := null;
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

create or replace function public.save_purchase_invoice(p_document jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_header_id uuid;
  v_header_org uuid;
  v_supplier_name text;
  v_line jsonb;
  v_line_number integer := 0;
  v_status public.document_status;
begin
  select organisation_id, tenant_id into v_org, v_tenant
  from public.transaction_types
  where id = nullif(p_document->>'transactionTypeId', '')::uuid
    and type = 'Purchases';

  if v_org is null then
    raise exception 'Choose a Purchases transaction type';
  end if;

  select name into v_supplier_name
  from public.suppliers
  where id = nullif(p_document->>'supplierId', '')::uuid
    and organisation_id = v_org;

  if v_supplier_name is null then
    raise exception 'Choose a supplier';
  end if;

  if nullif(btrim(p_document->>'supplierName'), '') is not null then
    v_supplier_name := btrim(p_document->>'supplierName');
  end if;

  v_header_id := nullif(p_document->>'id', '')::uuid;

  if v_header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, supplier_name, contact_details, notes,
      currency_id, exchange_rate, order_number, paid_amount,
      supplier_reference, supply_date,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      v_tenant,
      v_org,
      (p_document->>'transactionTypeId')::uuid,
      0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      (p_document->>'supplierId')::uuid,
      v_supplier_name,
      p_document->>'contactDetails',
      p_document->>'notes',
      (p_document->>'currencyId')::uuid,
      (p_document->>'exchangeRate')::numeric,
      p_document->>'orderNumber',
      coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      p_document->>'supplierReference',
      nullif(p_document->>'supplyDate', '')::date,
      p_document->>'flex1',
      p_document->>'flex2',
      p_document->>'flex3',
      p_document->>'flex4',
      p_document->>'flex5'
    )
    returning id into v_header_id;
  else
    select organisation_id, status into v_header_org, v_status
    from public.transaction_headers
    where id = v_header_id;

    if v_header_org is null then
      raise exception 'That invoice could not be updated';
    end if;
    if v_status is distinct from 'draft' then
      raise exception 'Only a draft document can be changed';
    end if;
    if v_header_org is distinct from v_org then
      raise exception 'That invoice belongs to another organisation';
    end if;
    if not exists (
      select 1
      from public.organisation_access
      where organisation_id = v_header_org
        and user_id = (select auth.uid())
    ) then
      raise exception 'You are not a member of this organisation';
    end if;

    update public.transaction_headers
    set transaction_date = (p_document->>'transactionDate')::date,
        due_date = nullif(p_document->>'dueDate', '')::date,
        supplier_id = (p_document->>'supplierId')::uuid,
        supplier_name = v_supplier_name,
        contact_details = p_document->>'contactDetails',
        notes = p_document->>'notes',
        currency_id = (p_document->>'currencyId')::uuid,
        exchange_rate = (p_document->>'exchangeRate')::numeric,
        order_number = p_document->>'orderNumber',
        paid_amount = coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
        supplier_reference = p_document->>'supplierReference',
        supply_date = nullif(p_document->>'supplyDate', '')::date,
        flex1 = p_document->>'flex1',
        flex2 = p_document->>'flex2',
        flex3 = p_document->>'flex3',
        flex4 = p_document->>'flex4',
        flex5 = p_document->>'flex5'
    where id = v_header_id
      and organisation_id = v_org;

    if not found then
      raise exception 'That invoice could not be updated';
    end if;

    delete from public.transaction_lines
    where header_id = v_header_id;
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_document->'lines', '[]'::jsonb))
  loop
    v_line_number := v_line_number + 1;
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
      quantity, price, discount_amount, nett_amount, vat_amount
    ) values (
      v_tenant,
      v_org,
      v_header_id,
      (p_document->>'transactionTypeId')::uuid,
      0,
      v_line_number,
      nullif(v_line->>'productId', '')::uuid,
      coalesce(v_line->>'description', ''),
      nullif(v_line->>'glCodeId', '')::uuid,
      nullif(v_line->>'departmentId', '')::uuid,
      nullif(v_line->>'costCentreId', '')::uuid,
      nullif(v_line->>'vatRateId', '')::uuid,
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      coalesce(nullif(v_line->>'price', '')::numeric, 0),
      coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0),
      0,
      0
    );
  end loop;

  return v_header_id;
end;
$$;

revoke all on function public.save_purchase_invoice(jsonb) from public, anon;
grant execute on function public.save_purchase_invoice(jsonb) to authenticated;


alter table public.gl_codes drop constraint gl_codes_code_check;
alter table public.gl_codes add constraint gl_codes_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.departments drop constraint departments_code_check;
alter table public.departments add constraint departments_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.cost_centres drop constraint cost_centres_code_check;
alter table public.cost_centres add constraint cost_centres_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.vat_rates drop constraint vat_rates_code_check;
alter table public.vat_rates add constraint vat_rates_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.currencies drop constraint currencies_code_check;
alter table public.currencies add constraint currencies_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.customers drop constraint customers_code_check;
alter table public.customers add constraint customers_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.suppliers drop constraint suppliers_code_check;
alter table public.suppliers add constraint suppliers_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.transaction_types drop constraint transaction_types_code_check;
alter table public.transaction_types add constraint transaction_types_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$');
alter table public.products drop constraint products_code_check;
alter table public.products add constraint products_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,29}$');
