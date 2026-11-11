-- A line can carry the buyer's purchase order line reference (BT-132), and a printed form can show the order a line came from.

alter table public.transaction_lines add column order_line_reference text;

alter table public.transaction_lines
  add constraint transaction_lines_order_line_reference_check
  check (order_line_reference is null or char_length(order_line_reference) between 1 and 60);

comment on column public.transaction_lines.order_line_reference is
  'The line of the buyer''s purchase order this line answers (BT-132). The header order_number names the order.';

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

-- The printed form may show an Order column on its lines.
select private.reword_function('private.validate_form_layout(jsonb, text, text)', array[
  $a$'unit','lineNote'$a$, $b$'unit','lineNote','order'$b$
]);

select private.reword_function('public.save_document(jsonb)', array[
  $a$unit_code, line_note, seller_item_id$a$,
  $b$unit_code, line_note, seller_item_id, order_line_reference$b$,
  $a$v_line_unit, nullif(v_line->>'lineNote', ''), nullif(v_line->>'sellerItemId', '')$a$,
  $b$v_line_unit, nullif(v_line->>'lineNote', ''), nullif(v_line->>'sellerItemId', ''),
      nullif(btrim(v_line->>'orderLineReference'), '')$b$
]);

-- A document made from an order keeps the customer's order line reference entered on the order line.
select private.reword_function('public.create_from_order(uuid, uuid)', array[
  $a$'sellerItemId', line.seller_item_id$a$,
  $b$'sellerItemId', line.seller_item_id,
      'orderLineReference', line.order_line_reference$b$
]);

select private.reword_function('public.en16931_source(uuid)', array[
  $a$'sellerItem', seller_item_id,$a$,
  $b$'sellerItem', seller_item_id,
    'orderLine', order_line_reference,$b$
]);

select private.reword_function('public.en16931_document(uuid)', array[
  $a$'BT-126', v_line->>'line', 'BT-127', nullif(v_line->>'note', ''),$a$,
  $b$'BT-126', v_line->>'line', 'BT-127', nullif(v_line->>'note', ''),
      'BT-132', nullif(v_line->>'orderLine', ''),$b$
]);

drop function private.reword_function(text, text[]);
