-- Payments release B, phase 3: documents learn about allocations (QULAPLUS_PAYMENTS_SPEC.md, 3.6 to 3.9).
--
-- Posting fixes the paid amount for e-invoices, then a credit note with a preceding invoice is applied to it.
-- Voiding is refused while a document has an effective allocation, and drops planned ones.
-- An imported e-invoice keeps the supplier's stated paid amount as information.

CREATE OR REPLACE FUNCTION public.post_document(p_header_id uuid, p_logo_path text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_supplier uuid;
  v_type uuid;
  v_reference integer;
  v_numbering public.numbering_rule;
  v_direction text;
  v_lines integer;
  v_issuer jsonb;
  v_party jsonb;
  v_iban text;
  v_customer uuid;
  v_errors text;
  v_kind text;
  v_preceding uuid;
  v_credit_total numeric;
  v_open numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date, supplier_id, customer_id, transaction_type_id, reference
    into v_org, v_status, v_date, v_supplier, v_customer, v_type, v_reference
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

  select numbering, type into v_numbering, v_direction
  from public.transaction_types
  where id = v_type;

  if v_numbering = 'on_post' and v_reference is null then
    perform 1
    from public.transaction_types
    where id = v_type
    for update;
  end if;

  select defaults.iban into v_iban
  from public.organisation_defaults as defaults
  where defaults.organisation_id = v_org;

  if v_direction = 'Sales' and v_iban is not null then
    update public.transaction_headers
    set payment_means_code = '58'
    where id = p_header_id
      and payment_means_code is null;
  end if;

  if v_direction = 'Sales' then
    select string_agg(format('%s: %s', ready.rule_id, ready.message), ' ' order by ready.rule_id)
      into v_errors
    from public.en16931_readiness(p_header_id) as ready
    where ready.severity = 'error';
    if v_errors is not null then
      raise exception 'This sales document is not ready to post. %', v_errors;
    end if;
  end if;

  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  select jsonb_build_object(
    'name', organisation.name,
    'address', private.postal_address_text(
      defaults.address_line1, defaults.address_line2, defaults.address_line3,
      defaults.city, defaults.post_code, defaults.county, seller_country.name
    ),
    'addressLine1', defaults.address_line1,
    'addressLine2', defaults.address_line2,
    'addressLine3', defaults.address_line3,
    'city', defaults.city,
    'postCode', defaults.post_code,
    'county', defaults.county,
    'countryCode', defaults.country_code,
    'countryName', seller_country.name,
    'contactName', defaults.contact_name,
    'contactEmail', defaults.contact_email,
    'website', defaults.website,
    'phone', defaults.phone,
    'vatNumber', defaults.vat_number,
    'companyNumber', defaults.company_number,
    'peppolScheme', defaults.peppol_scheme,
    'peppolId', defaults.peppol_id,
    'iban', defaults.iban,
    'bic', defaults.bic,
    'bankAccountName', defaults.bank_account_name,
    'bankingDetails', defaults.banking_details,
    'logoPath', p_logo_path
  )
  into v_issuer
  from public.organisations as organisation
  left join public.organisation_defaults as defaults
    on defaults.organisation_id = organisation.id
  left join public.ref_countries as seller_country
    on seller_country.code = defaults.country_code
  where organisation.id = v_org;

  if v_direction = 'Sales' then
    select jsonb_build_object(
      'code', customers.code,
      'name', customers.name,
      'address', private.postal_address_text(
        customers.address_line1, customers.address_line2, customers.address_line3,
        customers.city, customers.post_code, customers.county, party_country.name
      ),
      'addressLine1', customers.address_line1,
      'addressLine2', customers.address_line2,
      'addressLine3', customers.address_line3,
      'city', customers.city,
      'postCode', customers.post_code,
      'county', customers.county,
      'countryCode', customers.country_code,
      'countryName', party_country.name,
      'phone', customers.phone,
      'email', customers.email,
      'website', customers.website,
      'contactDetails', customers.contact_details,
      'vatNumber', customers.vat_number,
      'companyNumber', customers.company_number,
      'peppolScheme', customers.peppol_scheme,
      'peppolId', customers.peppol_id
    )
    into v_party
    from public.customers as customers
    left join public.ref_countries as party_country
      on party_country.code = customers.country_code
    where customers.id = v_customer;
  else
  select jsonb_build_object(
    'code', supplier.code,
    'name', supplier.name,
    'address', private.postal_address_text(
      supplier.address_line1, supplier.address_line2, supplier.address_line3,
      supplier.city, supplier.post_code, supplier.county, party_country.name
    ),
    'addressLine1', supplier.address_line1,
    'addressLine2', supplier.address_line2,
    'addressLine3', supplier.address_line3,
    'city', supplier.city,
    'postCode', supplier.post_code,
    'county', supplier.county,
    'countryCode', supplier.country_code,
    'countryName', party_country.name,
    'phone', supplier.phone,
    'email', supplier.email,
    'website', supplier.website,
    'contactDetails', supplier.contact_details,
    'vatNumber', supplier.vat_number,
    'companyNumber', supplier.company_number,
    'peppolScheme', supplier.peppol_scheme,
    'peppolId', supplier.peppol_id
  )
  into v_party
  from public.suppliers as supplier
  left join public.ref_countries as party_country
    on party_country.code = supplier.country_code
  where supplier.id = v_supplier;
  end if;

  select kind.document_kind::text, header.preceding_header_id, header.foreign_total_amount
    into v_kind, v_preceding, v_credit_total
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = p_header_id;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      issuer_snapshot = v_issuer,
      party_snapshot = v_party,
      reference = v_reference,
      -- Fixed before anything is allocated, so the e-invoice of a credit note is not changed by its own application.
      paid_at_posting = paid_amount
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);

  -- A credit note with a preceding invoice is applied to it, up to what is still open on the invoice. The invoice is
  -- locked after the credit note, the same order every allocation uses. If it is already settled the credit note stays
  -- on account.
  if v_kind = 'credit_note' and v_preceding is not null then
    select header.foreign_total_amount + header.rounding_amount - header.paid_amount
      into v_open
    from public.transaction_headers as header
    where header.id = v_preceding and header.organisation_id = v_org and header.status = 'posted'
    for update;
    if coalesce(v_open, 0) > 0 then
      insert into public.allocations (tenant_id, organisation_id, source_header_id, target_header_id, amount)
      select tenant_id, organisation_id, id, v_preceding, least(v_credit_total, v_open)
      from public.transaction_headers
      where id = p_header_id;
    end if;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.void_document(p_header_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_direction text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before voiding a document';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a reason for voiding this document';
  end if;

  select header.organisation_id, header.status, header.transaction_date, kind.type
    into v_org, v_status, v_date, v_direction
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = p_header_id
  for update of header;

  if v_org is null then
    raise exception 'That document could not be voided';
  end if;
  if v_direction = 'Sales' then
    raise exception 'A posted sales document cannot be voided. Issue a credit note instead.';
  end if;
  if not (select private.has_org_role(v_org, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to void a document';
  end if;
  if v_status is distinct from 'posted' then
    raise exception 'Only a posted document can be voided';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;

  if exists (
    select 1 from public.allocations
    where removed_at is null and not pending
      and (source_header_id = p_header_id or target_header_id = p_header_id)
  ) then
    raise exception 'Remove this document''s allocations before voiding it.';
  end if;
  -- Planned allocations belong to draft payments and have no effect yet. The draft shows the money as unallocated.
  delete from public.allocations where pending and target_header_id = p_header_id;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'void',
      voided_at = now(),
      voided_by = (select auth.uid()),
      void_reason = v_reason
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

CREATE OR REPLACE FUNCTION public.import_e_document(p_id uuid, p_choices jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_doc public.e_documents%rowtype;
  v_type uuid;
  v_kind public.document_kind;
  v_currency uuid;
  v_rate numeric;
  v_supplier uuid := nullif(p_choices->>'supplierId', '')::uuid;
  v_supplier_currency uuid;
  v_code text;
  v_line jsonb;
  v_choice jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_vat uuid;
  v_vat_category text;
  v_vat_rate numeric;
  v_vat_type text;
  v_price numeric;
  v_base numeric;
  v_discount numeric;
  v_allowance jsonb;
  v_unsupported text;
  v_header uuid;
  v_payload jsonb;
  v_stated numeric;
begin
  select * into v_doc from public.e_documents where id = p_id;
  if v_doc.id is null or not private.is_org_member(v_doc.organisation_id) then
    raise exception 'That e-document was not found';
  end if;
  if v_doc.direction is distinct from 'inbound' or v_doc.status is distinct from 'valid' then
    raise exception 'Only a valid received e-invoice can be imported';
  end if;
  if v_doc.semantic is null then
    raise exception 'This e-invoice could not be read';
  end if;

  select string_agg(value, ', ') into v_unsupported
  from jsonb_array_elements_text(coalesce(v_doc.semantic->'_unsupported', '[]'::jsonb));
  if v_unsupported is not null then
    raise exception 'This e-invoice uses features Qula Plus cannot import yet: %', v_unsupported;
  end if;

  v_kind := case when v_doc.ubl_root = 'CreditNote' then 'credit_note'::public.document_kind else 'invoice'::public.document_kind end;
  v_type := nullif(p_choices->>'transactionTypeId', '')::uuid;
  if v_type is not null then
    if not exists (
      select 1 from public.transaction_types
      where id = v_type
        and organisation_id = v_doc.organisation_id
        and type = 'Purchases'
        and document_kind = v_kind
    ) then
      raise exception 'Choose a Purchases document type';
    end if;
  elsif v_kind = 'credit_note' then
    select inbound_credit_note_type_id into v_type
    from public.organisation_defaults where organisation_id = v_doc.organisation_id;
  else
    select inbound_invoice_type_id into v_type
    from public.organisation_defaults where organisation_id = v_doc.organisation_id;
  end if;
  if v_type is null then
    raise exception 'Choose a Purchases document type';
  end if;

  select id into v_currency
  from public.currencies
  where organisation_id = v_doc.organisation_id
    and (iso_code = v_doc.currency_code or code = v_doc.currency_code);
  if v_currency is null then
    raise exception 'Add the invoice currency to this organisation before importing';
  end if;
  select rate into v_rate from public.currencies where id = v_currency;

  if coalesce(p_choices->>'createSupplier', '') = 'true' then
    raise exception 'Create the supplier before importing';
  end if;

  if v_supplier is null then
    raise exception 'Choose a supplier';
  end if;
  select currency_id into v_supplier_currency
  from public.suppliers
  where id = v_supplier and organisation_id = v_doc.organisation_id;
  if v_supplier_currency is null then
    raise exception 'Choose a supplier from this organisation';
  end if;
  if v_supplier_currency is distinct from v_currency then
    raise exception 'The supplier currency must match the e-invoice currency';
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(v_doc.semantic->'BG-25', '[]'::jsonb))
  loop
    select value into v_choice
    from jsonb_array_elements(coalesce(p_choices->'lines', '[]'::jsonb)) as value
    where value->>'lineNumber' = v_line->>'BT-126'
    limit 1;

    v_vat := nullif(v_choice->>'vatRateId', '')::uuid;
    if v_vat is null then
      raise exception 'Choose an Expense VAT rate for each line';
    end if;
    select vat_category, rate, vat_type into v_vat_category, v_vat_rate, v_vat_type
    from public.vat_rates
    where id = v_vat and organisation_id = v_doc.organisation_id;
    if v_vat_type is distinct from 'Expense'
       or v_vat_category is distinct from nullif(v_line #>> '{BG-30,BT-151}', '')
       or v_vat_rate is distinct from nullif(v_line #>> '{BG-30,BT-152}', '')::numeric then
      raise exception 'Choose an Expense VAT rate that matches the e-invoice category and percentage';
    end if;

    v_price := nullif(v_line #>> '{BG-29,BT-146}', '')::numeric;
    v_base := nullif(v_line #>> '{BG-29,BT-149}', '')::numeric;
    if v_base is not null and v_base <> 0 and v_price is not null then
      v_price := v_price / v_base;
    end if;
    v_discount := 0;
    for v_allowance in
      select value from jsonb_array_elements(coalesce(v_line->'BG-27', '[]'::jsonb))
    loop
      if coalesce(v_allowance->>'charge', '') = 'true' then
        raise exception 'This e-invoice uses features Qula Plus cannot import yet: line charge';
      end if;
      v_discount := v_discount + coalesce(nullif(v_allowance->>'BT-136', '')::numeric, 0);
    end loop;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', coalesce(nullif(v_line #>> '{BG-31,BT-153}', ''), 'Item'),
      'quantity', coalesce(v_line->>'BT-129', '1'),
      'price', coalesce(v_price, 0),
      'discountAmount', v_discount,
      'unitCode', coalesce(nullif(v_line->>'BT-130', ''), 'C62'),
      'vatRateId', v_vat,
      'glCodeId', nullif(v_choice->>'glCodeId', ''),
      'departmentId', nullif(v_choice->>'departmentId', ''),
      'costCentreId', nullif(v_choice->>'costCentreId', ''),
      'sellerItemId', nullif(v_line #>> '{BG-31,BT-155}', ''),
      'lineNote', nullif(v_line->>'BT-127', '')
    ));
  end loop;

  v_payload := jsonb_build_object(
    'transactionTypeId', v_type,
    'transactionDate', v_doc.issue_date,
    'dueDate', nullif(v_doc.semantic->>'BT-9', ''),
    'supplierId', v_supplier,
    'partyName', coalesce(v_doc.seller_name, 'Supplier'),
    'currencyId', v_currency,
    'exchangeRate', v_rate,
    'orderNumber', nullif(v_doc.semantic->>'BT-13', ''),
    'supplierReference', v_doc.document_number,
    'precedingReference', nullif(v_doc.semantic #>> '{BG-3,BT-25}', ''),
    'precedingDate', nullif(v_doc.semantic #>> '{BG-3,BT-26}', ''),
    'buyerReference', nullif(v_doc.semantic->>'BT-10', ''),
    'contractReference', nullif(v_doc.semantic->>'BT-12', ''),
    'paymentTerms', nullif(v_doc.semantic->>'BT-20', ''),
    'notes', nullif(v_doc.semantic->>'BT-22', ''),
    'invoicePeriodStart', nullif(v_doc.semantic #>> '{BG-14,BT-73}', ''),
    'invoicePeriodEnd', nullif(v_doc.semantic #>> '{BG-14,BT-74}', ''),
    'lines', v_lines
  );

  begin
    v_header := public.save_document(v_payload);
  exception
    when unique_violation then
      raise exception 'This supplier invoice number is already used on another document';
  end;

  -- What the supplier says is paid is kept as information. It is never counted as paid.
  v_stated := nullif(v_doc.semantic #>> '{BG-22,BT-113}', '')::numeric;
  if coalesce(v_stated, 0) > 0 then
    update public.transaction_headers set supplier_stated_paid_amount = v_stated where id = v_header;
  end if;

  perform private.set_e_document_status(p_id, 'imported', jsonb_build_object('headerId', v_header));
  return v_header;
end;
$$;
