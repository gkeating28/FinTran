-- Leftovers before the e-document repository.
-- Line reference is an unused copy of the header number and is not filled when a
-- sales document is numbered on posting. Northern Ireland's XI prefix is VAT only.

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
  vat_kind text;
  vat_rate numeric(5, 2);
  v_category text;
  v_exemption_code text;
  v_exemption_reason text;
  v_direction text;
  copy_rate boolean;
begin
  select organisation_id, tenant_id, transaction_type_id
    into header_org, header_tenant, header_type
  from public.transaction_headers
  where id = new.header_id;

  if header_org is null then
    raise exception 'Choose a transaction';
  end if;

  new.organisation_id := header_org;
  new.tenant_id := header_tenant;
  new.transaction_type_id := header_type;
  new.description := btrim(new.description);

  if new.discount_amount > new.quantity * new.price then
    raise exception 'Discount cannot be more than quantity times price';
  end if;

  new.nett_amount := round(new.quantity * new.price - new.discount_amount, 2);
  copy_rate := tg_op = 'INSERT' or new.vat_rate_id is distinct from old.vat_rate_id;

  select type into v_direction
  from public.transaction_types
  where id = new.transaction_type_id;

  if new.vat_rate_id is null then
    new.vat_percentage := 0;
    new.vat_category := 'O';
    new.exemption_code := null;
    new.exemption_reason := null;
  elsif copy_rate then
    select vat_type, rate, vat_rates.vat_category, exemption_code, exemption_reason
      into vat_kind, vat_rate, v_category, v_exemption_code, v_exemption_reason
    from public.vat_rates
    where id = new.vat_rate_id;

    if v_direction = 'Sales' and vat_kind is distinct from 'Sales' then
      raise exception 'Sales VAT code must be a Sales rate';
    end if;
    if v_direction is distinct from 'Sales' and vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;

    new.vat_percentage := vat_rate;
    new.vat_category := v_category;
    new.exemption_code := v_exemption_code;
    new.exemption_reason := v_exemption_reason;
  else
    select vat_type into vat_kind
    from public.vat_rates
    where id = new.vat_rate_id;

    if v_direction = 'Sales' and vat_kind is distinct from 'Sales' then
      raise exception 'Sales VAT code must be a Sales rate';
    end if;
    if v_direction is distinct from 'Sales' and vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;
  end if;

  new.vat_amount := round(new.nett_amount * new.vat_percentage / 100, 2);
  return new;
end;
$$;

revoke all on function private.enforce_transaction_line() from public, anon, authenticated;

alter table public.transaction_lines drop column reference;

update public.ref_countries
set vat_prefix_only = true
where code = 'XI';

comment on column public.ref_countries.vat_prefix_only is
  'True for EL and XI. A postal address cannot use a VAT-prefix-only code. Postal Northern Ireland is GB.';

create or replace function private.enforce_home_exchange_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home uuid;
begin
  select home_currency_id into v_home
  from public.organisation_defaults
  where organisation_id = new.organisation_id;

  if v_home is not null and new.currency_id = v_home and new.exchange_rate is distinct from 1 then
    raise exception 'The home currency exchange rate must be 1';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_home_exchange_rate() from public, anon, authenticated;

drop trigger if exists transaction_headers_home_rate on public.transaction_headers;
create trigger transaction_headers_home_rate
  before insert or update of currency_id, exchange_rate, organisation_id
  on public.transaction_headers
  for each row execute function private.enforce_home_exchange_rate();

update public.transaction_headers as header
set exchange_rate = 1
from public.organisation_defaults as defaults
where defaults.organisation_id = header.organisation_id
  and header.currency_id = defaults.home_currency_id
  and header.exchange_rate is distinct from 1;

create index if not exists currencies_iso_code_idx on public.currencies (iso_code);
create index if not exists customers_country_code_idx on public.customers (country_code);
create index if not exists customers_peppol_scheme_idx on public.customers (peppol_scheme);
create index if not exists organisation_defaults_country_code_idx on public.organisation_defaults (country_code);
create index if not exists products_unit_code_idx on public.products (unit_code);
create index if not exists suppliers_country_code_idx on public.suppliers (country_code);
create index if not exists suppliers_peppol_scheme_idx on public.suppliers (peppol_scheme);
create index if not exists transaction_headers_customer_id_idx on public.transaction_headers (customer_id);
create index if not exists transaction_headers_payment_means_code_idx on public.transaction_headers (payment_means_code);
create index if not exists transaction_headers_preceding_header_id_idx on public.transaction_headers (preceding_header_id);
create index if not exists transaction_lines_exemption_code_idx on public.transaction_lines (exemption_code);
create index if not exists transaction_lines_unit_code_idx on public.transaction_lines (unit_code);
create index if not exists transaction_lines_vat_category_idx on public.transaction_lines (vat_category);
create index if not exists transaction_vat_breakdown_exemption_code_idx on public.transaction_vat_breakdown (exemption_code);
create index if not exists transaction_vat_breakdown_organisation_id_idx on public.transaction_vat_breakdown (organisation_id);
create index if not exists transaction_vat_breakdown_vat_category_idx on public.transaction_vat_breakdown (vat_category);
create index if not exists vat_rates_exemption_code_idx on public.vat_rates (exemption_code);
create index if not exists vat_rates_vat_category_idx on public.vat_rates (vat_category);

create or replace function public.save_document(p_document jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_direction text;
  v_header_id uuid;
  v_header_org uuid;
  v_party_name text;
  v_party_currency uuid;
  v_currency uuid;
  v_line jsonb;
  v_line_number integer := 0;
  v_status public.document_status;
  v_product_id uuid;
  v_purchase_price numeric;
  v_sales_price numeric;
  v_purchase_gl uuid;
  v_sales_gl uuid;
  v_purchase_vat uuid;
  v_sales_vat uuid;
  v_unit text;
  v_price numeric;
  v_gl uuid;
  v_vat uuid;
  v_line_unit text;
begin
  select organisation_id, tenant_id, type
    into v_org, v_tenant, v_direction
  from public.transaction_types
  where id = nullif(p_document->>'transactionTypeId', '')::uuid;

  if v_org is null or v_direction not in ('Sales', 'Purchases') then
    raise exception 'Choose a transaction type';
  end if;

  if v_direction = 'Sales' and nullif(p_document->>'supplierId', '') is not null then
    raise exception 'A sales document cannot have a supplier';
  end if;
  if v_direction = 'Purchases' and nullif(p_document->>'customerId', '') is not null then
    raise exception 'A purchase document cannot have a customer';
  end if;

  if v_direction = 'Sales' then
    select name, currency_id into v_party_name, v_party_currency
    from public.customers
    where id = nullif(p_document->>'customerId', '')::uuid
      and organisation_id = v_org;
    if v_party_name is null then
      raise exception 'Choose a customer';
    end if;
  else
    select name, currency_id into v_party_name, v_party_currency
    from public.suppliers
    where id = nullif(p_document->>'supplierId', '')::uuid
      and organisation_id = v_org;
    if v_party_name is null then
      raise exception 'Choose a supplier';
    end if;
  end if;

  if nullif(btrim(p_document->>'partyName'), '') is not null then
    v_party_name := btrim(p_document->>'partyName');
  elsif nullif(btrim(p_document->>'supplierName'), '') is not null then
    v_party_name := btrim(p_document->>'supplierName');
  end if;

  if coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0)
       is distinct from round(coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0), 2) then
    raise exception 'Amounts can have at most 2 decimal places.';
  end if;

  v_currency := nullif(p_document->>'currencyId', '')::uuid;
  if v_currency is null then
    v_currency := v_party_currency;
  end if;

  v_header_id := nullif(p_document->>'id', '')::uuid;

  if v_header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, customer_id, party_name, contact_details, notes,
      currency_id, exchange_rate, order_number, paid_amount, rounding_amount,
      supplier_reference, supply_date,
      preceding_header_id, preceding_reference, preceding_date,
      buyer_reference, contract_reference, payment_terms,
      invoice_period_start, invoice_period_end, payment_means_code,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      v_tenant,
      v_org,
      (p_document->>'transactionTypeId')::uuid,
      0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      nullif(p_document->>'supplierId', '')::uuid,
      nullif(p_document->>'customerId', '')::uuid,
      v_party_name,
      p_document->>'contactDetails',
      p_document->>'notes',
      v_currency,
      (p_document->>'exchangeRate')::numeric,
      p_document->>'orderNumber',
      coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
      p_document->>'supplierReference',
      nullif(p_document->>'supplyDate', '')::date,
      nullif(p_document->>'precedingHeaderId', '')::uuid,
      nullif(p_document->>'precedingReference', ''),
      nullif(p_document->>'precedingDate', '')::date,
      nullif(p_document->>'buyerReference', ''),
      nullif(p_document->>'contractReference', ''),
      nullif(p_document->>'paymentTerms', ''),
      nullif(p_document->>'invoicePeriodStart', '')::date,
      nullif(p_document->>'invoicePeriodEnd', '')::date,
      nullif(p_document->>'paymentMeansCode', ''),
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
        supplier_id = nullif(p_document->>'supplierId', '')::uuid,
        customer_id = nullif(p_document->>'customerId', '')::uuid,
        party_name = v_party_name,
        contact_details = p_document->>'contactDetails',
        notes = p_document->>'notes',
        currency_id = v_currency,
        exchange_rate = (p_document->>'exchangeRate')::numeric,
        order_number = p_document->>'orderNumber',
        paid_amount = coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
        rounding_amount = coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
        supplier_reference = p_document->>'supplierReference',
        supply_date = nullif(p_document->>'supplyDate', '')::date,
        preceding_header_id = nullif(p_document->>'precedingHeaderId', '')::uuid,
        preceding_reference = nullif(p_document->>'precedingReference', ''),
        preceding_date = nullif(p_document->>'precedingDate', '')::date,
        buyer_reference = nullif(p_document->>'buyerReference', ''),
        contract_reference = nullif(p_document->>'contractReference', ''),
        payment_terms = nullif(p_document->>'paymentTerms', ''),
        invoice_period_start = nullif(p_document->>'invoicePeriodStart', '')::date,
        invoice_period_end = nullif(p_document->>'invoicePeriodEnd', '')::date,
        payment_means_code = nullif(p_document->>'paymentMeansCode', ''),
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
    if coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0)
         is distinct from round(coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0), 2) then
      raise exception 'Amounts can have at most 2 decimal places.';
    end if;
    v_product_id := nullif(v_line->>'productId', '')::uuid;
    v_price := nullif(v_line->>'price', '')::numeric;
    v_gl := nullif(v_line->>'glCodeId', '')::uuid;
    v_vat := nullif(v_line->>'vatRateId', '')::uuid;
    v_line_unit := nullif(v_line->>'unitCode', '');

    if v_product_id is not null then
      select purchase_price, sales_price, purchase_gl_code_id, sales_gl_code_id,
             purchase_vat_code_id, sales_vat_code_id, unit_code
        into v_purchase_price, v_sales_price, v_purchase_gl, v_sales_gl,
             v_purchase_vat, v_sales_vat, v_unit
      from public.products
      where id = v_product_id
        and organisation_id = v_org;

      if not found then
        raise exception 'Choose a product from this organisation';
      end if;

      if v_direction = 'Sales' then
        if v_price is null then v_price := v_sales_price; end if;
        if v_gl is null then v_gl := v_sales_gl; end if;
        if v_vat is null then v_vat := v_sales_vat; end if;
      else
        if v_price is null then v_price := v_purchase_price; end if;
        if v_gl is null then v_gl := v_purchase_gl; end if;
        if v_vat is null then v_vat := v_purchase_vat; end if;
      end if;
      if v_line_unit is null then
        v_line_unit := v_unit;
      end if;
    end if;

    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, line_number,
      product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
      quantity, price, discount_amount, nett_amount, vat_amount,
      unit_code, line_note, seller_item_id
    ) values (
      v_tenant,
      v_org,
      v_header_id,
      (p_document->>'transactionTypeId')::uuid,
      v_line_number,
      v_product_id,
      coalesce(v_line->>'description', ''),
      v_gl,
      nullif(v_line->>'departmentId', '')::uuid,
      nullif(v_line->>'costCentreId', '')::uuid,
      v_vat,
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      coalesce(v_price, 0),
      coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0),
      0,
      0,
      v_line_unit,
      nullif(v_line->>'lineNote', ''),
      nullif(v_line->>'sellerItemId', '')
    );
  end loop;

  return v_header_id;
end;
$$;


revoke all on function public.save_document(jsonb) from public, anon;
grant execute on function public.save_document(jsonb) to authenticated;
