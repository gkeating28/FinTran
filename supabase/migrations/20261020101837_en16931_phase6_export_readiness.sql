-- EN 16931 phase 6 reader. The export and posting functions follow in the next migrations.
-- EN 16931 phase 6: semantic JSON export and the readiness check.
-- Sales documents stay blocked in the app. Sales posting rules are proved in a rolled-back test.
-- Existing posted snapshots are not rewritten.

create or replace function public.en16931_source(p_header_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_header public.transaction_headers%rowtype;
  v_direction text;
  v_kind text;
  v_currency text;
  v_home text;
  v_seller jsonb;
  v_buyer jsonb;
  v_org jsonb;
  v_counterparty jsonb;
  v_lines jsonb;
  v_breakdown jsonb;
  v_line_nett numeric;
  v_breakdown_vat numeric;
begin
  select * into v_header
  from public.transaction_headers
  where id = p_header_id;

  if v_header.id is null then
    return null;
  end if;

  select type, document_kind::text into v_direction, v_kind
  from public.transaction_types
  where id = v_header.transaction_type_id;

  select iso_code into v_currency
  from public.currencies
  where id = v_header.currency_id
    and organisation_id = v_header.organisation_id;

  select currencies.iso_code into v_home
  from public.organisation_defaults as defaults
  join public.currencies as currencies
    on currencies.id = defaults.home_currency_id
   and currencies.organisation_id = defaults.organisation_id
  where defaults.organisation_id = v_header.organisation_id;

  select coalesce(sum(nett_amount), 0), coalesce(jsonb_agg(jsonb_build_object(
    'line', line_number,
    'note', line_note,
    'quantity', quantity,
    'unit', unit_code,
    'nett', nett_amount,
    'price', price,
    'discount', discount_amount,
    'category', vat_category,
    'rate', vat_percentage,
    'description', description,
    'sellerItem', seller_item_id,
    'productCode', (select code from public.products where id = transaction_lines.product_id)
  ) order by line_number), '[]'::jsonb)
    into v_line_nett, v_lines
  from public.transaction_lines
  where header_id = v_header.id;

  select coalesce(sum(vat_amount), 0), coalesce(jsonb_agg(jsonb_build_object(
    'category', vat_category,
    'rate', vat_percentage,
    'taxable', taxable_amount,
    'vat', vat_amount,
    'exemptionCode', exemption_code,
    'exemptionReason', exemption_reason
  ) order by vat_category, vat_percentage), '[]'::jsonb)
    into v_breakdown_vat, v_breakdown
  from public.transaction_vat_breakdown
  where header_id = v_header.id;

  if v_header.status in ('posted', 'void') then
    v_org := jsonb_strip_nulls(jsonb_build_object(
      'name', v_header.issuer_snapshot->>'name',
      'line1', v_header.issuer_snapshot->>'addressLine1',
      'line2', v_header.issuer_snapshot->>'addressLine2',
      'line3', v_header.issuer_snapshot->>'addressLine3',
      'city', v_header.issuer_snapshot->>'city',
      'postCode', v_header.issuer_snapshot->>'postCode',
      'county', v_header.issuer_snapshot->>'county',
      'country', v_header.issuer_snapshot->>'countryCode',
      'vat', v_header.issuer_snapshot->>'vatNumber',
      'company', v_header.issuer_snapshot->>'companyNumber',
      'peppolScheme', v_header.issuer_snapshot->>'peppolScheme',
      'peppolId', v_header.issuer_snapshot->>'peppolId',
      'phone', v_header.issuer_snapshot->>'phone',
      'email', v_header.issuer_snapshot->>'contactEmail',
      'contact', v_header.issuer_snapshot->>'contactName',
      'iban', v_header.issuer_snapshot->>'iban',
      'bic', v_header.issuer_snapshot->>'bic',
      'accountName', v_header.issuer_snapshot->>'bankAccountName'
    ));
    v_counterparty := jsonb_strip_nulls(jsonb_build_object(
      'name', v_header.party_snapshot->>'name',
      'code', v_header.party_snapshot->>'code',
      'line1', v_header.party_snapshot->>'addressLine1',
      'line2', v_header.party_snapshot->>'addressLine2',
      'line3', v_header.party_snapshot->>'addressLine3',
      'city', v_header.party_snapshot->>'city',
      'postCode', v_header.party_snapshot->>'postCode',
      'county', v_header.party_snapshot->>'county',
      'country', v_header.party_snapshot->>'countryCode',
      'vat', v_header.party_snapshot->>'vatNumber',
      'company', v_header.party_snapshot->>'companyNumber',
      'peppolScheme', v_header.party_snapshot->>'peppolScheme',
      'peppolId', v_header.party_snapshot->>'peppolId',
      'phone', v_header.party_snapshot->>'phone',
      'email', v_header.party_snapshot->>'email',
      'contact', v_header.party_snapshot->>'contactDetails'
    ));
  else
    select jsonb_strip_nulls(jsonb_build_object(
      'name', organisation.name,
      'line1', defaults.address_line1,
      'line2', defaults.address_line2,
      'line3', defaults.address_line3,
      'city', defaults.city,
      'postCode', defaults.post_code,
      'county', defaults.county,
      'country', defaults.country_code,
      'vat', defaults.vat_number,
      'company', defaults.company_number,
      'peppolScheme', defaults.peppol_scheme,
      'peppolId', defaults.peppol_id,
      'phone', defaults.phone,
      'email', defaults.contact_email,
      'contact', defaults.contact_name,
      'iban', defaults.iban,
      'bic', defaults.bic,
      'accountName', defaults.bank_account_name,
      'needsReview', defaults.address_needs_review
    )) into v_org
    from public.organisations as organisation
    join public.organisation_defaults as defaults
      on defaults.organisation_id = organisation.id
    where organisation.id = v_header.organisation_id;

    if v_direction = 'Sales' then
      select jsonb_strip_nulls(jsonb_build_object(
        'name', customers.name,
        'code', customers.code,
        'line1', customers.address_line1,
        'line2', customers.address_line2,
        'line3', customers.address_line3,
        'city', customers.city,
        'postCode', customers.post_code,
        'county', customers.county,
        'country', customers.country_code,
        'vat', customers.vat_number,
        'company', customers.company_number,
        'peppolScheme', customers.peppol_scheme,
        'peppolId', customers.peppol_id,
        'phone', customers.phone,
        'email', customers.email,
        'contact', customers.contact_details,
        'needsReview', customers.address_needs_review
      )) into v_counterparty
      from public.customers
      where id = v_header.customer_id
        and organisation_id = v_header.organisation_id;
    else
      select jsonb_strip_nulls(jsonb_build_object(
        'name', suppliers.name,
        'code', suppliers.code,
        'line1', suppliers.address_line1,
        'line2', suppliers.address_line2,
        'line3', suppliers.address_line3,
        'city', suppliers.city,
        'postCode', suppliers.post_code,
        'county', suppliers.county,
        'country', suppliers.country_code,
        'vat', suppliers.vat_number,
        'company', suppliers.company_number,
        'peppolScheme', suppliers.peppol_scheme,
        'peppolId', suppliers.peppol_id,
        'phone', suppliers.phone,
        'email', suppliers.email,
        'contact', suppliers.contact_details,
        'needsReview', suppliers.address_needs_review
      )) into v_counterparty
      from public.suppliers
      where id = v_header.supplier_id
        and organisation_id = v_header.organisation_id;
    end if;
  end if;

  if v_direction = 'Sales' then
    v_seller := v_org;
    v_buyer := v_counterparty;
  else
    v_seller := v_counterparty;
    v_buyer := v_org;
  end if;

  return jsonb_build_object(
    'direction', v_direction,
    'kind', v_kind,
    'status', v_header.status,
    'invoiceNumber', case
      when v_direction = 'Sales' then v_header.reference::text
      else nullif(btrim(v_header.supplier_reference), '')
    end,
    'issueDate', v_header.transaction_date,
    'currency', v_currency,
    'homeCurrency', v_home,
    'dueDate', v_header.due_date,
    'buyerReference', nullif(btrim(v_header.buyer_reference), ''),
    'contractReference', nullif(btrim(v_header.contract_reference), ''),
    'orderNumber', nullif(btrim(v_header.order_number), ''),
    'paymentTerms', nullif(btrim(v_header.payment_terms), ''),
    'notes', nullif(btrim(v_header.notes), ''),
    'supplyDate', v_header.supply_date,
    'periodStart', v_header.invoice_period_start,
    'periodEnd', v_header.invoice_period_end,
    'precedingReference', nullif(btrim(v_header.preceding_reference), ''),
    'precedingDate', v_header.preceding_date,
    'paymentMeans', nullif(btrim(v_header.payment_means_code), ''),
    'nett', v_header.foreign_nett_amount,
    'vat', v_header.foreign_vat_amount,
    'total', v_header.foreign_total_amount,
    'homeVat', v_header.home_vat_amount,
    'paid', v_header.paid_amount,
    'rounding', v_header.rounding_amount,
    'due', v_header.amount_due,
    'lineNettSum', v_line_nett,
    'breakdownVatSum', v_breakdown_vat,
    'seller', coalesce(v_seller, '{}'::jsonb),
    'buyer', coalesce(v_buyer, '{}'::jsonb),
    'lines', v_lines,
    'breakdown', v_breakdown
  );
end;
$$;

revoke all on function public.en16931_source(uuid) from public, anon;
grant execute on function public.en16931_source(uuid) to authenticated;

create or replace function public.en16931_amount(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    else to_char(round(p_value, 2), 'FM999999999999990.00')
  end;
$$;

create or replace function public.en16931_price(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    else to_char(round(p_value, 4), 'FM999999999999990.0000')
  end;
$$;

revoke all on function public.en16931_amount(numeric) from public, anon;
revoke all on function public.en16931_price(numeric) from public, anon;
grant execute on function public.en16931_amount(numeric), public.en16931_price(numeric) to authenticated;

