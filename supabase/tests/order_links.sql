-- An order becomes one or more invoices and cannot be invoiced for more than was ordered. Rolls back.
-- Needs a draft or open purchase order with a line, and a Purchases invoice type. It does nothing without them.
begin;

do $$
declare
  v_order uuid;
  v_user uuid;
  v_status text;
  v_type uuid;
  v_line uuid;
  v_first uuid;
  v_second uuid;
  v_quantity numeric;
  v_count integer;
  v_header record;
  v_document jsonb;
begin
  select header.id, header.created_by, header.status::text into v_order, v_user, v_status
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where kind.document_kind = 'order' and kind.type = 'Purchases' and header.status in ('draft', 'open')
    and exists (select 1 from public.transaction_lines as line where line.header_id = header.id)
    and not exists (
      select 1 from public.transaction_lines as line
      join public.transaction_lines as drawn on drawn.source_line_id = line.id
      where line.header_id = header.id
    )
  limit 1;
  select id into v_type from public.transaction_types
  where document_kind = 'invoice' and type = 'Purchases'
    and organisation_id = (select organisation_id from public.transaction_headers where id = v_order)
  order by code limit 1;
  if v_order is null or v_type is null then
    raise notice 'No purchase order to test with';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  if v_status = 'draft' then perform public.set_order_status(v_order, 'open'); end if;
  select id, quantity into v_line, v_quantity from public.transaction_lines where header_id = v_order order by line_number limit 1;

  -- The first invoice takes everything, so a second has nothing to take.
  v_first := public.create_from_order(v_order, v_type);
  if (select sum(quantity) from public.transaction_lines where header_id = v_first and source_line_id = v_line) <> v_quantity then
    raise exception 'TEST: the invoice did not start with the ordered quantity';
  end if;
  begin
    perform public.create_from_order(v_order, v_type);
    raise exception 'TEST: a second full invoice was created';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;

  -- Halving the first invoice leaves half for a second one.
  update public.transaction_lines set quantity = quantity / 2 where header_id = v_first and source_line_id = v_line;
  v_second := public.create_from_order(v_order, v_type);
  if (select sum(quantity) from public.transaction_lines where header_id = v_second and source_line_id = v_line) <> v_quantity / 2 then
    raise exception 'TEST: the second invoice did not start with what was left';
  end if;

  begin
    update public.transaction_lines set quantity = quantity + 1 where header_id = v_second and source_line_id = v_line;
    raise exception 'TEST: the order was over invoiced';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;
  begin
    update public.transaction_lines set quantity = quantity / 2 where id = v_line;
    raise exception 'TEST: the order line went below what is invoiced';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;
  begin
    perform public.set_order_status(v_order, 'cancel');
    raise exception 'TEST: an invoiced order was cancelled';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;

  -- Saving the order again keeps its line ids, so the invoices still point at them.
  select * into v_header from public.transaction_headers where id = v_order;
  v_document := jsonb_build_object(
    'id', v_order, 'transactionTypeId', v_header.transaction_type_id, 'transactionDate', v_header.transaction_date,
    'supplierId', v_header.supplier_id, 'exchangeRate', v_header.exchange_rate,
    'lines', (
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'description', line.description, 'quantity', line.quantity, 'price', line.price,
        'glCodeId', line.gl_code_id, 'vatRateId', line.vat_rate_id, 'unitCode', line.unit_code, 'productId', line.product_id
      ) order by line.line_number)
      from public.transaction_lines as line where line.header_id = v_order
    )
  );
  perform public.save_document(v_document);
  select count(*) into v_count from public.transaction_lines where source_line_id = v_line;
  if v_count <> 2 then raise exception 'TEST: saving the order lost its invoice links'; end if;

  -- A line that is invoiced cannot be removed from the order.
  begin
    perform public.save_document(v_document - 'lines' || jsonb_build_object('lines', '[]'::jsonb));
    raise exception 'TEST: an invoiced line was removed';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;
end $$;

rollback;
