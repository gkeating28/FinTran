-- Hardening phase 4. Order quantity rules: who closed an order, credit notes that return quantity, the new "used"
-- calculation, and reopening. Builds its own tenant and rolls back.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d401', 'owner-harden4@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d401', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Harden Four Books', 'Harden Four Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'Z0', 'Zero', 0, 'Sales', 'Z');
update public.organisation_defaults
set address_line1 = 'Dock 1', city = 'Dublin', vat_number = 'IE1234567T', peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city,
  vat_number, peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme', id,
  '1 Quay', 'Dublin', 'IE7654321A', '9935', 'IE7654321A', 'PO-1', 0
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PO', 'Purchase order', 0, 'Purchases', 'order', 'PO-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PC', 'Purchase credit', 0, 'Purchases', 'credit_note', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SO', 'Sales order', 0, 'Sales', 'order', 'SO-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'INV-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SC', 'Sales credit', 0, 'Sales', 'credit_note', 'CR-', 5);

create function pg_temp.id_of(p_table text, p_code text) returns text language plpgsql as $$
declare v_id text;
begin
  execute format('select id::text from public.%I where organisation_id = $1 and code = $2', p_table)
    into v_id using current_setting('test.org')::uuid, p_code;
  return v_id;
end $$;

-- An order with the given line quantities, activated.
create function pg_temp.new_order(p_type text, p_quantities numeric[]) returns uuid language plpgsql as $$
declare
  v_id uuid;
  v_sales boolean := p_type = 'SO';
begin
  v_id := public.save_document(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type),
    'supplierId', case when v_sales then null else pg_temp.id_of('suppliers', 'VOD') end,
    'customerId', case when v_sales then pg_temp.id_of('customers', 'ACME') end,
    'transactionDate', '2026-11-12',
    'currencyId', pg_temp.id_of('currencies', 'EUR'),
    'exchangeRate', 1,
    'lines', (select jsonb_agg(jsonb_build_object(
        'description', 'Item ' || ordinality, 'quantity', quantity, 'price', 10,
        'vatRateId', case when v_sales then pg_temp.id_of('vat_rates', 'Z0') end,
        'glCodeId', pg_temp.id_of('gl_codes', case when v_sales then '4000' else '6000' end)
      ) order by ordinality) from unnest(p_quantities) with ordinality as item(quantity, ordinality))
  ));
  perform public.set_order_status(v_id, 'open');
  return v_id;
end $$;

-- An invoice drawing the given quantity from each line of an order. Null takes what is left.
create function pg_temp.invoice_from(p_order uuid, p_type text, p_quantity numeric) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.create_from_order(p_order, pg_temp.id_of('transaction_types', p_type)::uuid);
  if p_type = 'PI' then
    update public.transaction_headers set supplier_reference = 'SUP-' || left(v_id::text, 8) where id = v_id;
  end if;
  if p_quantity is not null then
    update public.transaction_lines set quantity = p_quantity where header_id = v_id;
  end if;
  return v_id;
end $$;

-- A credit note against the first line of an invoice.
create function pg_temp.credit(p_invoice uuid, p_type text, p_quantity numeric, p_returns boolean, p_linked boolean default true) returns uuid language plpgsql as $$
declare
  v_line record;
  v_sales boolean := p_type = 'SC';
begin
  select * into v_line from public.transaction_lines where header_id = p_invoice order by line_number limit 1;
  return public.save_document(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type),
    'supplierId', case when v_sales then null else pg_temp.id_of('suppliers', 'VOD') end,
    'customerId', case when v_sales then pg_temp.id_of('customers', 'ACME') end,
    'supplierReference', case when v_sales then null else 'CR-' || left(gen_random_uuid()::text, 8) end,
    'transactionDate', '2026-11-12',
    'currencyId', pg_temp.id_of('currencies', 'EUR'),
    'exchangeRate', 1,
    'precedingHeaderId', p_invoice,
    'precedingReference', (select coalesce(nullif(document_number, ''), supplier_reference, 'INV') from public.transaction_headers where id = p_invoice),
    'precedingDate', '2026-11-12',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Credit', 'quantity', p_quantity, 'price', 10,
      'vatRateId', v_line.vat_rate_id, 'glCodeId', v_line.gl_code_id,
      'creditedLineId', case when p_linked then v_line.id end,
      'returnsToOrder', p_returns
    ))
  ));
end $$;

create function pg_temp.state(p_order uuid) returns text language sql as $$
  select status::text || ':' || closed_by_system::text from public.transaction_headers where id = p_order;
$$;

-- "invoiced/reserved/left" for the first line of an order.
create function pg_temp.usage(p_order uuid) returns text language sql as $$
  select trim_scale(usage.invoiced)::text || '/' || trim_scale(usage.reserved)::text || '/' || trim_scale(usage.remaining)::text
  from public.order_line_usage as usage
  join public.transaction_lines as line on line.id = usage.line_id
  where usage.header_id = p_order order by line.line_number limit 1;
$$;

create function pg_temp.expect(p_what text, p_got text, p_want text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'phase 4: %: got %, wanted %', p_what, p_got, p_want; end if;
end $$;

do $$
declare
  v_order uuid;
  v_first uuid;
  v_second uuid;
  v_credit uuid;
  v_other uuid;
  v_reason text;
begin
  ---------------------------------------------------------------------------------------------------------------
  -- 1. Auto close, Reserved, and reopening on a void.
  v_order := pg_temp.new_order('PO', array[10, 4]);
  v_first := pg_temp.invoice_from(v_order, 'PI', null);
  update public.transaction_lines set quantity = 6 where header_id = v_first and line_number = 1;
  perform pg_temp.expect('a draft invoice reserves quantity', pg_temp.usage(v_order), '0/6/4');
  perform public.post_document(v_first, null);
  perform pg_temp.expect('a part invoiced order stays active', pg_temp.state(v_order), 'open:false');
  perform pg_temp.expect('posted quantity is Invoiced', pg_temp.usage(v_order), '6/0/4');

  v_second := pg_temp.invoice_from(v_order, 'PI', null);
  perform pg_temp.expect('a draft for the rest does not close the order', pg_temp.state(v_order), 'open:false');
  perform pg_temp.expect('the rest is Reserved', pg_temp.usage(v_order), '6/4/0');
  perform public.post_document(v_second, null);
  perform pg_temp.expect('a fully invoiced order closes by itself', pg_temp.state(v_order), 'closed:true');
  select new_values->>'reason' into v_reason from public.audit_log
  where table_name = 'transaction_headers' and row_id = v_order::text and new_values->>'status' = 'closed'
  order by changed_at desc, id desc limit 1;
  if v_reason is null or v_reason not like 'Posted invoices cover every line%' then
    raise exception 'phase 4: the automatic close has no reason in the audit log: %', v_reason;
  end if;

  perform public.void_document(v_second, 'Wrong invoice');
  perform pg_temp.expect('voiding one invoice reopens the order', pg_temp.state(v_order), 'open:false');
  perform pg_temp.expect('the voided quantity is Left', pg_temp.usage(v_order), '6/0/4');
  select new_values->>'reason' into v_reason from public.audit_log
  where table_name = 'transaction_headers' and row_id = v_order::text and new_values->>'status' = 'open' and new_values ? 'reason'
  order by changed_at desc, id desc limit 1;
  if v_reason is null or v_reason not like '%was voided%' then
    raise exception 'phase 4: the automatic reopen has no reason in the audit log: %', v_reason;
  end if;

  ---------------------------------------------------------------------------------------------------------------
  -- 2. An order closed by hand stays closed after a void.
  v_order := pg_temp.new_order('PO', array[5]);
  v_first := pg_temp.invoice_from(v_order, 'PI', 3);
  perform public.post_document(v_first, null);
  perform public.set_order_status(v_order, 'close');
  perform pg_temp.expect('closing by hand is not a system close', pg_temp.state(v_order), 'closed:false');
  perform public.void_document(v_first, 'Wrong invoice');
  perform pg_temp.expect('a hand-closed order stays closed after a void', pg_temp.state(v_order), 'closed:false');
  perform pg_temp.expect('and it has quantity left', pg_temp.usage(v_order), '0/0/5');

  -- A system close that a person reopens and closes again becomes a hand close.
  v_order := pg_temp.new_order('PO', array[5]);
  v_first := pg_temp.invoice_from(v_order, 'PI', null);
  perform public.post_document(v_first, null);
  perform pg_temp.expect('closed by the system', pg_temp.state(v_order), 'closed:true');
  perform public.set_order_status(v_order, 'reopen');
  perform pg_temp.expect('reopening by hand clears the flag', pg_temp.state(v_order), 'open:false');
  perform public.set_order_status(v_order, 'close');
  perform public.void_document(v_first, 'Wrong invoice');
  perform pg_temp.expect('now closed by hand, it stays closed', pg_temp.state(v_order), 'closed:false');

  ---------------------------------------------------------------------------------------------------------------
  -- 3. Sales: a returning credit note reopens the order once posted. A draft does not. A price-only credit does not.
  v_order := pg_temp.new_order('SO', array[10]);
  v_first := pg_temp.invoice_from(v_order, 'SI', null);
  perform public.post_document(v_first, null);
  perform pg_temp.expect('the sales order closed by itself', pg_temp.state(v_order), 'closed:true');

  v_credit := pg_temp.credit(v_first, 'SC', 3, true);
  perform pg_temp.expect('a draft credit note does not reopen the order', pg_temp.state(v_order), 'closed:true');
  perform pg_temp.expect('a draft credit note gives nothing back', pg_temp.usage(v_order), '10/0/0');
  perform public.post_document(v_credit, null);
  perform pg_temp.expect('a posted returning credit note reopens the order', pg_temp.state(v_order), 'open:false');
  perform pg_temp.expect('and gives its quantity back', pg_temp.usage(v_order), '7/0/3');

  v_credit := pg_temp.credit(v_first, 'SC', 2, false);
  perform public.post_document(v_credit, null);
  perform pg_temp.expect('a price-only credit gives nothing back', pg_temp.usage(v_order), '7/0/3');

  -- Crediting more than the invoice line is refused. 5 of 10 are credited, so 6 more is too many, across drafts too.
  begin
    perform pg_temp.credit(v_first, 'SC', 6, false);
    raise exception 'phase 4: an over-credit was saved';
  exception when others then
    if sqlerrm not like '%credit more than was invoiced%Invoiced 10, already credited 5, so 5 is left%' then
      raise exception 'phase 4: over-credit error was %', sqlerrm;
    end if;
  end;
  v_credit := pg_temp.credit(v_first, 'SC', 4, false);
  begin
    perform pg_temp.credit(v_first, 'SC', 2, false);
    raise exception 'phase 4: a draft credit note was not counted against the invoice line';
  exception when others then
    if sqlerrm not like '%already credited 9, so 1 is left%' then raise exception 'phase 4: draft over-credit error was %', sqlerrm; end if;
  end;
  delete from public.transaction_headers where id = v_credit;

  -- The over-invoicing check uses the new calculation: 3 came back, so 3 can be invoiced again and 4 cannot.
  begin
    perform pg_temp.invoice_from(v_order, 'SI', 4);
    raise exception 'phase 4: more than was left was invoiced';
  exception when others then
    if sqlerrm not like '%invoice more than was ordered%' then raise exception 'phase 4: over-invoice error was %', sqlerrm; end if;
  end;
  v_second := pg_temp.invoice_from(v_order, 'SI', null);
  perform pg_temp.expect('Create invoice starts with what came back', (select trim_scale(quantity)::text from public.transaction_lines where header_id = v_second), '3');
  perform public.post_document(v_second, null);
  perform pg_temp.expect('invoicing what came back closes the order again', pg_temp.state(v_order), 'closed:true');

  -- A credit line must point at a line on the credit note's own invoice, and Return to order needs an order line.
  begin
    perform pg_temp.credit(v_first, 'SC', 1, true, false);
    raise exception 'phase 4: Return to order was saved without a credited line';
  exception when others then
    if sqlerrm not like '%Return to order needs the invoice line%' then raise exception 'phase 4: unlinked return error was %', sqlerrm; end if;
  end;
  v_other := public.save_document(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', 'SI'), 'customerId', pg_temp.id_of('customers', 'ACME'),
    'transactionDate', '2026-11-12', 'currencyId', pg_temp.id_of('currencies', 'EUR'), 'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'No order', 'quantity', 2, 'price', 10,
      'vatRateId', pg_temp.id_of('vat_rates', 'Z0'), 'glCodeId', pg_temp.id_of('gl_codes', '4000')))
  ));
  perform public.post_document(v_other, null);
  begin
    perform pg_temp.credit(v_other, 'SC', 1, true);
    raise exception 'phase 4: Return to order was saved for an invoice line with no order';
  exception when others then
    if sqlerrm not like '%only for a line whose invoice line came from an order%' then raise exception 'phase 4: no-order return error was %', sqlerrm; end if;
  end;
  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', pg_temp.id_of('transaction_types', 'SC'), 'customerId', pg_temp.id_of('customers', 'ACME'),
      'transactionDate', '2026-11-12', 'currencyId', pg_temp.id_of('currencies', 'EUR'), 'exchangeRate', 1,
      'precedingHeaderId', v_other, 'precedingReference', 'X', 'precedingDate', '2026-11-12',
      'lines', jsonb_build_array(jsonb_build_object('description', 'Wrong invoice', 'quantity', 1, 'price', 10,
        'vatRateId', pg_temp.id_of('vat_rates', 'Z0'), 'glCodeId', pg_temp.id_of('gl_codes', '4000'),
        'creditedLineId', (select id from public.transaction_lines where header_id = v_first limit 1)))
    ));
    raise exception 'phase 4: a credit line pointed at another invoice';
  exception when others then
    if sqlerrm not like '%only credit a line on the invoice the credit note applies to%' then raise exception 'phase 4: wrong invoice error was %', sqlerrm; end if;
  end;
  ---------------------------------------------------------------------------------------------------------------
  -- 4. Voiding a returning credit note. Allowed while the quantity is still free, refused once it is invoiced again.
  v_order := pg_temp.new_order('PO', array[5]);
  v_first := pg_temp.invoice_from(v_order, 'PI', null);
  perform public.post_document(v_first, null);
  v_credit := pg_temp.credit(v_first, 'PC', 2, true);
  perform public.post_document(v_credit, null);
  perform pg_temp.expect('a purchase credit note reopens the order too', pg_temp.state(v_order), 'open:false');
  perform public.void_document(v_credit, 'Entered twice');
  perform pg_temp.expect('voiding it while the quantity is free closes the order again', pg_temp.state(v_order), 'closed:true');

  v_credit := pg_temp.credit(v_first, 'PC', 2, true);
  perform public.post_document(v_credit, null);
  v_second := pg_temp.invoice_from(v_order, 'PI', null);
  perform public.post_document(v_second, null);
  perform pg_temp.expect('re-invoiced, the order is closed', pg_temp.state(v_order), 'closed:true');
  begin
    perform public.void_document(v_credit, 'Entered twice');
    raise exception 'phase 4: a credit note was voided after its quantity was invoiced again';
  exception when others then
    if sqlerrm not like '%has since been invoiced again. It cannot be voided%' then raise exception 'phase 4: void credit error was %', sqlerrm; end if;
  end;
  perform pg_temp.expect('the refused void changed nothing', (select status::text from public.transaction_headers where id = v_credit), 'posted');
end
$$;

select 'hardening phase 4 ok' as result;
rollback;
