-- Sales phase 2. save_document fills sales drafts and copies product sales values.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'owner-sales2@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Sales Two Books', 'Sales Two Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1);
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Sales VAT', 23, 'Sales', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Purchase VAT', 23, 'Expense', 'S');
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, payment_terms_days, default_buyer_reference
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme', id, 30, 'PO-9'
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.products (
  tenant_id, organisation_id, code, description, purchase_price, sales_price,
  purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id, unit_code
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'BOOK', 'Book', 4, 9,
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '6000'),
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'P23'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'S23'),
  'HUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice');

select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.customer', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.product', (select id::text from public.products where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.pi', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);
select set_config('test.si', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'), true);
select set_config('test.income', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000'), true);
select set_config('test.sales_vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'S23'), true);

do $$
declare
  v_id uuid;
  v_due date;
  v_terms text;
  v_buyer text;
  v_price numeric;
  v_gl uuid;
  v_vat uuid;
  v_unit text;
begin
  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.si'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-01',
      'currencyId', current_setting('test.eur'),
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Nope', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 2: a sales payload with a supplier was saved';
  exception
    when others then
      if sqlerrm not like '%cannot have a supplier%' then
        raise exception 'phase 2: supplier payload error was %', sqlerrm;
      end if;
  end;

  v_id := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.customer'),
    'transactionDate', '2026-10-01',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Book',
      'productId', current_setting('test.product'),
      'quantity', 2
    ))
  ));
  select due_date, payment_terms, buyer_reference into v_due, v_terms, v_buyer
  from public.transaction_headers where id = v_id;
  if v_due <> '2026-10-31' or v_terms <> 'Payment due within 30 days' or v_buyer <> 'PO-9' then
    raise exception 'phase 2: sales defaults were % / % / %', v_due, v_terms, v_buyer;
  end if;
  select price, gl_code_id, vat_rate_id, unit_code into v_price, v_gl, v_vat, v_unit
  from public.transaction_lines where header_id = v_id;
  if v_price <> 9 or v_gl <> current_setting('test.income')::uuid
     or v_vat <> current_setting('test.sales_vat')::uuid or v_unit <> 'HUR' then
    raise exception 'phase 2: product copy was % / % / % / %', v_price, v_gl, v_vat, v_unit;
  end if;

  v_id := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.customer'),
    'transactionDate', '2026-10-01',
    'dueDate', '2026-11-15',
    'buyerReference', 'KEEP',
    'paymentTerms', 'Net 14',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Book',
      'productId', current_setting('test.product'),
      'quantity', 1,
      'price', 12
    ))
  ));
  select due_date, payment_terms, buyer_reference into v_due, v_terms, v_buyer
  from public.transaction_headers where id = v_id;
  if v_due <> '2026-11-15' or v_terms <> 'Net 14' or v_buyer <> 'KEEP' then
    raise exception 'phase 2: explicit sales terms were replaced with % / % / %', v_due, v_terms, v_buyer;
  end if;
  if (select price from public.transaction_lines where header_id = v_id) <> 12 then
    raise exception 'phase 2: an explicit price was replaced';
  end if;

  perform public.save_document(jsonb_build_object(
    'id', (select id from public.transaction_headers where buyer_reference = 'PO-9'),
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.customer'),
    'transactionDate', '2026-10-10',
    'dueDate', '2026-10-31',
    'buyerReference', 'PO-9',
    'paymentTerms', 'Payment due within 30 days',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Book', 'quantity', 1, 'price', 9))
  ));
  select due_date into v_due
  from public.transaction_headers where buyer_reference = 'PO-9';
  if v_due <> '2026-11-09' then
    raise exception 'phase 2: derived due date stayed %', v_due;
  end if;

  perform public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-02',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 4))
  ));
end;
$$;

rollback;
select 'sales phase 2 ok';
