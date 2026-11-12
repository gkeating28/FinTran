-- Order lifecycle, part 4.
-- The status after draft is shown to people as Active, so the messages say active and activate. The stored value stays 'open'.
-- An order closes by itself once posted invoices cover every line.

create or replace function private.reword_function(p_signature text, p_pairs text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_definition text := pg_get_functiondef(p_signature::regprocedure);
  v_next text;
  v_index integer := 1;
begin
  while v_index < array_length(p_pairs, 1) loop
    v_next := replace(v_definition, p_pairs[v_index], p_pairs[v_index + 1]);
    if v_next = v_definition then
      raise exception '% does not contain: %', p_signature, p_pairs[v_index];
    end if;
    v_definition := v_next;
    v_index := v_index + 2;
  end loop;
  execute v_definition;
end;
$$;

select private.reword_function('private.enforce_document_status()', array[
  'An order status is changed with Open, Close, Reopen or Cancel', 'An order status is changed with Activate, Close, Reopen or Cancel',
  'An order is opened and closed. It is not posted.', 'An order is activated and closed. It is not posted.',
  'Only an order or a requisition can be opened and closed', 'Only an order or a requisition can be activated and closed'
]);

select private.reword_function('public.set_order_status(uuid, text)', array[
  'Only an order or a requisition can be opened and closed', 'Only an order or a requisition can be activated and closed',
  'Only a draft order can be opened', 'Only a draft order can be activated',
  'Add a line before opening', 'Add a line before activating',
  'Only an open order can be closed', 'Only an active order can be closed',
  'Only an open order can be cancelled', 'Only an active order can be cancelled'
]);

select private.reword_function('private.enforce_source_line()', array[
  'The order must be open before it is invoiced', 'The order must be active before it is invoiced'
]);

select private.reword_function('public.create_from_order(uuid, uuid)', array[
  'Open it first. Only an open order or requisition can be turned into another document.',
  'Activate it first. Only an active order or requisition can be turned into another document.'
]);

select private.reword_function('public.save_document(jsonb)', array[
  'Only a draft document or an open order can be changed', 'Only a draft document or an active order can be changed'
]);

drop function private.reword_function(text, text[]);

-- When an invoice is posted, each active order it draws on is closed if posted invoices now cover every line.
-- A draft invoice does not close an order, because a draft can still be changed or removed.
create or replace function private.close_invoiced_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_setting text;
begin
  for v_order in
    select distinct source.header_id
    from public.transaction_lines as line
    join public.transaction_lines as source on source.id = line.source_line_id
    join public.transaction_headers as header on header.id = source.header_id
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    where line.header_id = new.id
      and header.status = 'open'
      and kind.document_kind = 'order'
  loop
    if not exists (
      select 1
      from public.transaction_lines as source
      where source.header_id = v_order
        and source.quantity > 0
        and source.quantity > coalesce((
          select sum(drawn.quantity)
          from public.transaction_lines as drawn
          join public.transaction_headers as header on header.id = drawn.header_id
          where drawn.source_line_id = source.id and header.status = 'posted'
        ), 0)
    ) then
      v_setting := current_setting('fintran.status_change', true);
      perform set_config('fintran.status_change', 'on', true);
      update public.transaction_headers set status = 'closed' where id = v_order and status = 'open';
      perform set_config('fintran.status_change', coalesce(nullif(v_setting, ''), 'off'), true);
    end if;
  end loop;
  return new;
end;
$$;

create trigger zzzz_close_invoiced_orders
after update on public.transaction_headers
for each row
when (old.status = 'draft' and new.status = 'posted')
execute function private.close_invoiced_orders();
