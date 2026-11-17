-- Payments, receipts and refunds get a form of their own in the form designer. Their layouts use the same settings as a
-- document's, but the header fields, the party fields and the line columns are the ones a payment prints: the line
-- columns describe the documents it settled. The Sales rules about VAT and quantities do not apply to them.

create or replace function private.validate_form_layout(p_layout jsonb, p_type text, p_kind text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  v_key text;
  v_item jsonb;
  v_seen text[] := array[]::text[];
  v_value text;
  v_allowed text[];
  v_payment boolean := p_kind in ('payment', 'receipt');
begin
  if jsonb_typeof(p_layout) is distinct from 'object' or char_length(p_layout::text) > 8000 then
    raise exception 'Form layout must be an object';
  end if;

  for v_key in select jsonb_object_keys(p_layout)
  loop
    if v_key not in (
      'version', 'title', 'pageSize', 'showLogo', 'showVatSummary', 'showBanking',
      'organisationFields', 'partyFields', 'headerFields', 'lineColumns'
    ) then
      raise exception 'Form layout has an unknown setting: %', v_key;
    end if;
  end loop;

  if (p_layout->>'version') is distinct from '1' then
    raise exception 'Form layout version must be 1';
  end if;
  if jsonb_typeof(p_layout->'title') is distinct from 'string'
     or char_length(btrim(p_layout->>'title')) < 1
     or char_length(btrim(p_layout->>'title')) > 80 then
    raise exception 'Form title must be 1 to 80 characters';
  end if;
  if p_layout ? 'pageSize'
     and (p_layout->>'pageSize') not in ('A4', 'A5', 'Letter', 'Legal') then
    raise exception 'Page size must be A4, A5, Letter, or Legal';
  end if;

  foreach v_key in array array['showLogo', 'showVatSummary', 'showBanking']
  loop
    if p_layout ? v_key and jsonb_typeof(p_layout->v_key) is distinct from 'boolean' then
      raise exception 'Form layout settings must be true or false';
    end if;
  end loop;

  foreach v_key in array array['organisationFields', 'partyFields', 'headerFields', 'lineColumns']
  loop
    if jsonb_typeof(p_layout->v_key) is distinct from 'array' then
      raise exception 'Form layout lists must be arrays';
    end if;
    v_seen := array[]::text[];
    v_allowed := case
      -- A payment, receipt or refund prints its own fields: what was paid, how, and which documents it settled.
      when v_payment and v_key = 'partyFields' then array['name','address','vatNumber']
      when v_payment and v_key = 'headerFields' then array[
        'documentNumber','transactionDate','paymentMeans','bankReference','bankAccount','currency'
      ]
      when v_payment and v_key = 'lineColumns' then array['document','date','total','applied']
      else case v_key
      when 'organisationFields' then array[
        'name','address','phone','contactEmail','website','contactName','vatNumber','companyNumber','peppolId','country'
      ]
      when 'partyFields' then array[
        'contactDetails','name','address','phone','email','website','code','peppolId','country','vatNumber'
      ]
      when 'headerFields' then array[
        'reference','documentNumber','transactionDate','terms','dueDate','orderNumber','currency','exchangeRate','paidAmount',
        'flex1','flex2','flex3','flex4','flex5','supplierReference','supplyDate',
        'buyerReference','contractReference','paymentTerms','invoicePeriod','precedingReference'
      ]
      else array[
        'date','item','description','tax','quantity','price','amount','discount','glCode','vatCode','department','costCentre',
        'unit','lineNote','order'
      ]
      end
    end;
    for v_item in select value from jsonb_array_elements(p_layout->v_key)
    loop
      if jsonb_typeof(v_item) is distinct from 'string' then
        raise exception 'Form layout lists must contain field names';
      end if;
      v_value := v_item #>> '{}';
      if v_value = any (v_seen) then
        raise exception 'Form layout repeats the field %', v_value;
      end if;
      if not (v_value = any (v_allowed)) then
        raise exception 'Form layout has an unknown field: %', v_value;
      end if;
      v_seen := v_seen || v_value;
    end loop;
  end loop;

  if v_payment then
    if not (p_layout->'organisationFields' ? 'name') then
      raise exception 'A payment form must show the organisation name';
    end if;
    if not (p_layout->'partyFields' ? 'name') then
      raise exception 'A payment form must show the name of who was paid or who paid';
    end if;
    if not (p_layout->'headerFields' ? 'documentNumber' and p_layout->'headerFields' ? 'transactionDate') then
      raise exception 'A payment form must show the number and date';
    end if;
    if not (p_layout->'lineColumns' ? 'document' and p_layout->'lineColumns' ? 'applied') then
      raise exception 'A payment form must show the document and the amount applied';
    end if;
  elsif p_type = 'Sales' then
    if not (
      p_layout->'organisationFields' ? 'name'
      and p_layout->'organisationFields' ? 'address'
      and p_layout->'organisationFields' ? 'vatNumber'
    ) then
      raise exception 'A sales form must show the organisation name, address, and VAT number';
    end if;
    if not (
      p_layout->'partyFields' ? 'name'
      and p_layout->'partyFields' ? 'address'
    ) then
      raise exception 'A sales form must show the customer name and address';
    end if;
    if not (
      (p_layout->'headerFields' ? 'documentNumber' or p_layout->'headerFields' ? 'reference')
      and p_layout->'headerFields' ? 'transactionDate'
    ) then
      raise exception 'A sales form must show the document number and date';
    end if;
    if not (
      p_layout->'lineColumns' ? 'description'
      and p_layout->'lineColumns' ? 'quantity'
      and p_layout->'lineColumns' ? 'price'
      and p_layout->'lineColumns' ? 'tax'
      and p_layout->'lineColumns' ? 'amount'
    ) then
      raise exception 'A sales form must show the description, quantity, price, tax, and amount';
    end if;
    if (p_layout->>'showVatSummary') is distinct from 'true' then
      raise exception 'A sales form must show the VAT summary';
    end if;
    if p_kind = 'credit_note' and not (p_layout->'headerFields' ? 'precedingReference') then
      raise exception 'A sales credit note form must show the preceding invoice reference';
    end if;
  end if;
end;
$$;
