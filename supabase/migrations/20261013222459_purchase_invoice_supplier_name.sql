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
  v_supplier_name text;
  v_line jsonb;
  v_line_number integer := 0;
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
      p_document->>'flex1',
      p_document->>'flex2',
      p_document->>'flex3',
      p_document->>'flex4',
      p_document->>'flex5'
    )
    returning id into v_header_id;
  else
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
