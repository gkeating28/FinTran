-- The purchase order reference on a document is the buyer's order number. The seller's own order number is the sales order reference.
-- A sales invoice made from a sales order used to put the sales order number in the purchase order reference. It now keeps the two apart.

alter table public.transaction_headers add column sales_order_reference text;

alter table public.transaction_headers
  add constraint transaction_headers_sales_order_reference_check
  check (sales_order_reference is null or char_length(sales_order_reference) between 1 and 200);

comment on column public.transaction_headers.sales_order_reference is
  'The seller''s own order number or numbers (BT-14). The buyer''s purchase order number is order_number (BT-13).';

-- A document can draw on several orders, so the reference can list several numbers.
alter table public.transaction_headers drop constraint transaction_headers_order_number_check;
alter table public.transaction_headers
  add constraint transaction_headers_order_number_check
  check (order_number is null or char_length(order_number) between 1 and 200);

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

select private.reword_function('public.save_document(jsonb)', array[
  'currency_id, exchange_rate, order_number, paid_amount, rounding_amount,',
  'currency_id, exchange_rate, order_number, sales_order_reference, paid_amount, rounding_amount,',
  $a$(p_document->>'exchangeRate')::numeric, p_document->>'orderNumber',$a$,
  $b$(p_document->>'exchangeRate')::numeric, p_document->>'orderNumber', nullif(btrim(p_document->>'salesOrderReference'), ''),$b$,
  $a$      order_number = p_document->>'orderNumber',$a$,
  $b$      order_number = p_document->>'orderNumber',
      sales_order_reference = nullif(btrim(p_document->>'salesOrderReference'), ''),$b$
]);

-- From a purchase order the invoice's purchase order reference is that order's number.
-- From a sales order it is the customer's order number entered on the sales order, and the sales order number is the sales order reference.
select private.reword_function('public.create_from_order(uuid, uuid)', array[
  $a$    'orderNumber', case when v_source.kind = 'order' then v_source.document_number else v_source.order_number end,$a$,
  $b$    'orderNumber', case when v_source.kind = 'order' and v_source.direction = 'Purchases' then v_source.document_number else v_source.order_number end,
    'salesOrderReference', case when v_source.kind = 'order' and v_source.direction = 'Sales' then v_source.document_number end,$b$
]);

select private.reword_function('public.en16931_source(uuid)', array[
  $a$    'orderNumber', nullif(btrim(v_header.order_number), ''),$a$,
  $b$    'orderNumber', nullif(btrim(v_header.order_number), ''),
    'salesOrderReference', nullif(btrim(v_header.sales_order_reference), ''),$b$
]);

select private.reword_function('public.en16931_document(uuid)', array[
  $a$    'BT-13', nullif(v_source->>'orderNumber', ''),$a$,
  $b$    'BT-13', nullif(v_source->>'orderNumber', ''),
    'BT-14', nullif(v_source->>'salesOrderReference', ''),$b$
]);

drop function private.reword_function(text, text[]);
