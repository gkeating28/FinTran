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

  if org is null then
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
