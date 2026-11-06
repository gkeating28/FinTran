-- A received e-invoice can name the Purchases document type on the import.

create or replace function public.import_e_document(p_id uuid, p_choices jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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
    raise exception 'This e-invoice uses features Qula Tran cannot import yet: %', v_unsupported;
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
        raise exception 'This e-invoice uses features Qula Tran cannot import yet: line charge';
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

  perform private.set_e_document_status(p_id, 'imported', jsonb_build_object('headerId', v_header));
  return v_header;
end;
$$;

revoke all on function public.import_e_document(uuid, jsonb) from public, anon;
grant execute on function public.import_e_document(uuid, jsonb) to authenticated;
