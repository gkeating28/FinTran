-- EN 16931 phase 4. Credit notes point at a posted invoice. Units default to C62.
begin;
create temp table phase4_users (id uuid primary key);
insert into phase4_users values ('a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase4@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb
from phase4_users;
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase4_users), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Four Books', 'Phase Four Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', (public.create_tenant('Phase Four Other', 'Other Office'))->>'organisation_id', true);
select set_config('test.tenant2', (select tenant_id::text from public.organisations where id = current_setting('test.org2')::uuid), true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1),
  (current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid, 'EUR', 'Euro', 1);
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EIR', 'Eir', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org2')::uuid;
insert into public.customers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'BETA', 'Beta', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PC', 'Purchase credit', 0, 'Purchases'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PO', 'Purchase order', 0, 'Purchases'),
  (current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');
update public.transaction_types
set document_kind = 'credit_note'
where organisation_id = current_setting('test.org')::uuid and code = 'PC';
update public.transaction_types
set document_kind = 'order'
where organisation_id = current_setting('test.org')::uuid and code = 'PO';
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Standard', 23, 'Expense', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Sales standard', 23, 'Sales', 'S');
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '5000', 'Purchases', 'Expense'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income');
insert into public.products (
  tenant_id, organisation_id, code, description, purchase_price, sales_price,
  purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id
)
select
  current_setting('test.tenant')::uuid,
  current_setting('test.org')::uuid,
  'BOOK',
  'Notebook',
  2,
  4,
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '5000'),
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'P23'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'S23');

select set_config('test.type', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);
select set_config('test.credit', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PC'), true);
select set_config('test.order', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PO'), true);
select set_config('test.type2', (select id::text from public.transaction_types where organisation_id = current_setting('test.org2')::uuid and code = 'PI'), true);
select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.currency2', (select id::text from public.currencies where organisation_id = current_setting('test.org2')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid and code = 'VOD'), true);
select set_config('test.other', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid and code = 'EIR'), true);
select set_config('test.supplier2', (select id::text from public.suppliers where organisation_id = current_setting('test.org2')::uuid), true);
select set_config('test.acme', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid and code = 'ACME'), true);
select set_config('test.beta', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid and code = 'BETA'), true);

do $$
declare
  v_invoice uuid;
  v_draft uuid;
  v_order uuid;
  v_credit uuid;
  v_other uuid;
  v_reference text;
  v_date date;
  v_unit text;
  v_note text;
  v_seller text;
begin
  if (select document_kind from public.transaction_types where id = current_setting('test.type')::uuid) <> 'invoice' then
    raise exception 'phase 4: a purchase invoice was not an invoice';
  end if;
  if (select unit_code from public.products where organisation_id = current_setting('test.org')::uuid) <> 'C62' then
    raise exception 'phase 4: a product without a unit was not C62';
  end if;

  begin
    update public.products
    set unit_code = 'NOPE'
    where organisation_id = current_setting('test.org')::uuid;
    raise exception 'phase 4: an unknown product unit was saved';
  exception
    when foreign_key_violation then
      null;
    when others then
      raise exception 'phase 4: product unit error was %', sqlerrm;
  end;

  update public.products
  set unit_code = ''
  where organisation_id = current_setting('test.org')::uuid;
  if (select unit_code from public.products where organisation_id = current_setting('test.org')::uuid) <> 'C62' then
    raise exception 'phase 4: a blank product unit was not put back to C62';
  end if;

  v_invoice := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-12',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 10, 'sellerItemId', 'SKU-1', 'lineNote', ' Ream ')
    )
  ));
  perform public.post_document(v_invoice, null);

  select line.unit_code, line.line_note, line.seller_item_id
    into v_unit, v_note, v_seller
  from public.transaction_lines as line
  where line.header_id = v_invoice;
  if v_unit <> 'C62' or v_note <> 'Ream' or v_seller <> 'SKU-1' then
    raise exception 'phase 4: omitted unit or line text was % / % / %', v_unit, v_note, v_seller;
  end if;

  v_draft := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-13',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Draft', 'quantity', 1, 'price', 1))
  ));

  v_order := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.order'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-14',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Order', 'quantity', 1, 'price', 1))
  ));
  perform public.post_document(v_order, null);

  v_other := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type2'),
    'supplierId', current_setting('test.supplier2'),
    'transactionDate', '2026-10-12',
    'currencyId', current_setting('test.currency2'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Other', 'quantity', 1, 'price', 1))
  ));
  perform public.post_document(v_other, null);

  v_credit := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.credit'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-19',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Credit', 'quantity', 1, 'price', 10))
  ));
  begin
    perform public.post_document(v_credit, null);
    raise exception 'phase 4: a credit note was posted without an invoice';
  exception
    when others then
      if sqlerrm not like '%Enter the invoice%' then
        raise exception 'phase 4: missing invoice error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', current_setting('test.credit'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-19',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'precedingHeaderId', v_draft,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Draft credit', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 4: a draft was accepted as the credited invoice';
  exception
    when others then
      if sqlerrm not like '%posted invoice%' then
        raise exception 'phase 4: draft credit error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', current_setting('test.credit'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-19',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'precedingHeaderId', v_order,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Order credit', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 4: an order was accepted as the credited invoice';
  exception
    when others then
      if sqlerrm not like '%posted invoice%' then
        raise exception 'phase 4: order credit error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', current_setting('test.credit'),
      'supplierId', current_setting('test.other'),
      'transactionDate', '2026-10-19',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'precedingHeaderId', v_invoice,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Wrong supplier', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 4: another supplier was accepted';
  exception
    when others then
      if sqlerrm not like '%same supplier%' then
        raise exception 'phase 4: supplier error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', current_setting('test.credit'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-19',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'precedingHeaderId', v_other,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Other organisation', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 4: another organisation was accepted';
  exception
    when foreign_key_violation then
      null;
    when others then
      raise exception 'phase 4: other organisation error was %', sqlerrm;
  end;

  begin
    update public.transaction_headers
    set preceding_header_id = v_credit
    where id = v_credit;
    raise exception 'phase 4: a document credited itself';
  exception
    when others then
      if sqlerrm not like '%credit itself%' then
        raise exception 'phase 4: self credit error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', current_setting('test.type'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-19',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Bad unit', 'quantity', 1, 'price', 1, 'unitCode', 'NOPE'))
    ));
    raise exception 'phase 4: an unknown line unit was saved';
  exception
    when foreign_key_violation then
      null;
    when others then
      raise exception 'phase 4: line unit error was %', sqlerrm;
  end;

  v_credit := public.save_purchase_invoice(jsonb_build_object(
    'id', v_credit,
    'transactionTypeId', current_setting('test.credit'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-19',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'precedingHeaderId', v_invoice,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Credit', 'quantity', 1, 'price', 10, 'unitCode', 'h87'))
  ));
  select preceding_reference, preceding_date into v_reference, v_date
  from public.transaction_headers where id = v_credit;
  if v_reference <> (select reference::text from public.transaction_headers where id = v_invoice)
     or v_date <> '2026-10-12' then
    raise exception 'phase 4: copied preceding invoice was % on %', v_reference, v_date;
  end if;
  if (select unit_code from public.transaction_lines where header_id = v_credit) <> 'H87' then
    raise exception 'phase 4: the line unit was not stored in upper case';
  end if;
  perform public.post_document(v_credit, null);

  v_credit := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.credit'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'precedingReference', 'EXT-9',
    'precedingDate', '2026-09-01',
    'lines', jsonb_build_array(jsonb_build_object('description', 'External', 'quantity', 1, 'price', 1))
  ));
  perform public.post_document(v_credit, null);
  if (select preceding_reference from public.transaction_headers where id = v_credit) <> 'EXT-9' then
    raise exception 'phase 4: a typed invoice reference was not kept';
  end if;

  begin
    update public.transaction_types
    set document_kind = 'order'
    where id = current_setting('test.type')::uuid;
    raise exception 'phase 4: the document kind changed after a document existed';
  exception
    when others then
      if sqlerrm not like '%cannot change after%' then
        raise exception 'phase 4: kind error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
alter table public.transaction_headers disable trigger transaction_headers_scope;
set local role authenticated;

do $$
declare
  v_invoice uuid;
  v_credit uuid;
begin
  insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind)
  values
    (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice'),
    (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SC', 'Sales credit', 0, 'Sales', 'credit_note');

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    supplier_name, currency_id, exchange_rate, amount_due, customer_id, status
  )
  values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'),
    '2026-10-01',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.acme')::uuid,
    'draft'
  )
  returning id into v_invoice;

  begin
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, line_number, description,
      quantity, price, discount_amount, nett_amount, vat_amount, seller_item_id
    ) values (
      current_setting('test.tenant')::uuid,
      current_setting('test.org')::uuid,
      v_invoice,
      1,
      'Sold',
      1,
      1,
      0,
      1,
      0,
      'SKU-S'
    );
    raise exception 'phase 4: a sales seller item was stored';
  exception
    when others then
      if sqlerrm not like '%only stored on a purchase%' then
        raise exception 'phase 4: sales seller item error was %', sqlerrm;
      end if;
  end;

  update public.transaction_headers
  set reference = 7
  where id = v_invoice;
  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'posted', posted_at = now(), posted_by = (select auth.uid())
  where id = v_invoice;

  begin
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, transaction_date,
      supplier_name, currency_id, exchange_rate, amount_due, customer_id,
      preceding_header_id
    )
    values (
      current_setting('test.tenant')::uuid,
      current_setting('test.org')::uuid,
      (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SC'),
      '2026-10-02',
      'Beta',
      current_setting('test.currency')::uuid,
      1,
      0,
      current_setting('test.beta')::uuid,
      v_invoice
    );
    raise exception 'phase 4: a sales credit for another customer was saved';
  exception
    when others then
      if sqlerrm not like '%same customer%' then
        raise exception 'phase 4: sales customer error was %', sqlerrm;
      end if;
  end;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    supplier_name, currency_id, exchange_rate, amount_due, customer_id,
    preceding_header_id
  )
  values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SC'),
    '2026-10-02',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.acme')::uuid,
    v_invoice
  )
  returning id into v_credit;

  if (select preceding_reference from public.transaction_headers where id = v_credit) <> '7' then
    raise exception 'phase 4: the sales credit did not copy invoice 7';
  end if;

  insert into public.transaction_lines (
    tenant_id, organisation_id, header_id, line_number, description,
    quantity, price, discount_amount, nett_amount, vat_amount
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    v_credit,
    1,
    'Credit',
    1,
    1,
    0,
    1,
    0
  );

  update public.transaction_headers
  set reference = 1,
      preceding_header_id = null,
      preceding_reference = null,
      preceding_date = null
  where id = v_credit;
  perform set_config('test.sales_credit', v_credit::text, true);
end;
$$;

do $$
begin
  begin
    perform public.post_document(current_setting('test.sales_credit')::uuid, null);
    raise exception 'phase 4: a sales credit note was posted without an invoice';
  exception
    when others then
      if sqlerrm not like '%Enter the invoice%' then
        raise exception 'phase 4: sales credit error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
alter table public.transaction_headers enable trigger transaction_headers_scope;
set local role authenticated;

do $$
begin
  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-21',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Sale', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 4: a sales document was stored';
  exception
    when others then
      if sqlerrm not like '%Purchases transaction type%' then
        raise exception 'phase 4: sales storage error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
rollback;
select 'en16931 phase 4 ok' as result;
