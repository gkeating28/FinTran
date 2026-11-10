-- An order closes by itself once posted invoices cover every line. A draft invoice does not close it. Rolls back.
-- Needs a draft or active purchase order with a line and nothing invoiced, and a Purchases invoice type.
begin;

do $$
declare
  v_order uuid;
  v_user uuid;
  v_status text;
  v_type uuid;
  v_first uuid;
  v_second uuid;
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

  -- Half is invoiced and posted: the order stays active.
  v_first := public.create_from_order(v_order, v_type);
  update public.transaction_lines set quantity = quantity / 2 where header_id = v_first;
  perform public.post_document(v_first);
  if (select status::text from public.transaction_headers where id = v_order) <> 'open' then
    raise exception 'TEST: a part invoiced order was closed';
  end if;

  -- The rest is on a draft invoice: the order still stays active.
  v_second := public.create_from_order(v_order, v_type);
  if (select status::text from public.transaction_headers where id = v_order) <> 'open' then
    raise exception 'TEST: a draft invoice closed the order';
  end if;

  -- Posting the rest closes it.
  perform public.post_document(v_second);
  if (select status::text from public.transaction_headers where id = v_order) <> 'closed' then
    raise exception 'TEST: a fully invoiced order was not closed';
  end if;
end $$;

rollback;
