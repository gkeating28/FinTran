-- An order is opened and closed, never posted. An invoice is never opened. Rolls back.
-- Needs one draft order with a line and one draft invoice in the database. It does nothing when there is no order.
begin;

do $$
declare
  v_order uuid;
  v_invoice uuid;
  v_user uuid;
  v_status text;
begin
  select header.id, header.created_by into v_order, v_user
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where kind.document_kind in ('order', 'requisition') and header.status = 'draft'
    and exists (select 1 from public.transaction_lines as line where line.header_id = header.id)
  limit 1;
  if v_order is null then
    raise notice 'No draft order to test with';
    return;
  end if;
  select header.id into v_invoice
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where kind.document_kind = 'invoice' and header.status = 'draft'
  limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  begin
    perform public.post_document(v_order);
    raise exception 'TEST: an order was posted';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;

  if v_invoice is not null then
    begin
      perform public.set_order_status(v_invoice, 'open');
      raise exception 'TEST: an invoice was opened';
    exception when others then
      if sqlerrm like 'TEST:%' then raise; end if;
    end;
  end if;

  begin
    perform public.set_order_status(v_order, 'close');
    raise exception 'TEST: a draft order was closed';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;

  perform public.set_order_status(v_order, 'open');
  select status::text into v_status from public.transaction_headers where id = v_order;
  if v_status <> 'open' then raise exception 'TEST: the order did not open'; end if;

  -- An open order can still be changed, but not deleted and not moved by a plain update.
  update public.transaction_headers set notes = 'Changed while open' where id = v_order;
  begin
    update public.transaction_headers set status = 'closed' where id = v_order;
    raise exception 'TEST: the status was changed by a plain update';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;
  begin
    delete from public.transaction_headers where id = v_order;
    raise exception 'TEST: an open order was deleted';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;

  perform public.set_order_status(v_order, 'close');
  begin
    update public.transaction_headers set notes = 'Changed while closed' where id = v_order;
    raise exception 'TEST: a closed order was changed';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;
  begin
    update public.transaction_lines set description = 'Changed while closed' where header_id = v_order;
    raise exception 'TEST: lines on a closed order were changed';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;

  perform public.set_order_status(v_order, 'reopen');
  update public.transaction_lines set description = description where header_id = v_order;

  perform public.set_order_status(v_order, 'cancel');
  begin
    perform public.set_order_status(v_order, 'reopen');
    raise exception 'TEST: a cancelled order was reopened';
  exception when others then
    if sqlerrm like 'TEST:%' then raise; end if;
  end;
end $$;

rollback;
