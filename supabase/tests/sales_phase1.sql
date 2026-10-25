-- Sales phase 1. Party name, sales headers, VAT direction, and formatted document numbers.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'owner-sales1@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Sales One Books', 'Sales One Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'USD', 'US dollar', 1.1)
on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Sales VAT', 23, 'Sales', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Purchase VAT', 23, 'Expense', 'S');
update public.organisation_defaults
set address_line1 = 'Dock 1', city = 'Dublin', vat_number = 'IE1234567T',
    peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('test.org')::uuid;

insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id,
  address_line1, city, vat_number, peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme', id,
  '1 Quay', 'Dublin', 'IE7654321A', '9935', 'IE7654321A', 'PO-1', 30
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.products (
  tenant_id, organisation_id, code, description,
  purchase_price, sales_price, purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id, unit_code
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'BOOK', 'Book',
  4, 9,
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '6000'),
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'P23'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'S23'),
  'HUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SO', 'Sales order', 0, 'Sales', 'order');

select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'), true);
select set_config('test.usd', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'USD'), true);
select set_config('test.customer', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.pi', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);
select set_config('test.si', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'), true);
select set_config('test.so', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SO'), true);
select set_config('test.sales_vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'S23'), true);
select set_config('test.purchase_vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'P23'), true);

do $$
declare
  v_id uuid;
  v_name text;
  v_number text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transaction_headers' and column_name = 'supplier_name'
  ) then
    raise exception 'phase 1: supplier_name still exists';
  end if;

  v_id := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'partyName', 'Vodafone Ireland',
    'transactionDate', '2026-10-06',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 10))
  ));
  select party_name, document_number into v_name, v_number
  from public.transaction_headers where id = v_id;
  if v_name <> 'Vodafone Ireland' or v_number <> '1' then
    raise exception 'phase 1: purchase party was % / %', v_name, v_number;
  end if;

  begin
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, transaction_date,
      party_name, currency_id, exchange_rate, customer_id, supplier_id
    ) values (
      current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.si')::uuid,
      '2026-10-06', 'Acme', current_setting('test.eur')::uuid, 1,
      current_setting('test.customer')::uuid, current_setting('test.supplier')::uuid
    );
    raise exception 'phase 1: a sales header with a supplier was saved';
  exception
    when others then
      if sqlerrm not like '%cannot have a supplier%' then
        raise exception 'phase 1: supplier-on-sales error was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, transaction_date,
      party_name, currency_id, exchange_rate
    ) values (
      current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.si')::uuid,
      '2026-10-06', 'Acme', current_setting('test.eur')::uuid, 1
    );
    raise exception 'phase 1: a sales header without a customer was saved';
  exception
    when others then
      if sqlerrm not like '%Choose a customer%' then
        raise exception 'phase 1: missing customer error was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, transaction_date,
      party_name, currency_id, exchange_rate, customer_id
    ) values (
      current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.si')::uuid,
      '2026-10-06', 'Acme', current_setting('test.usd')::uuid, 1, current_setting('test.customer')::uuid
    );
    raise exception 'phase 1: a sales header in the wrong currency was saved';
  exception
    when others then
      if sqlerrm not like '%must match the party currency%' then
        raise exception 'phase 1: currency error was %', sqlerrm;
      end if;
  end;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, customer_id
  ) values (
    current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.so')::uuid,
    '2026-10-06', 'Acme', current_setting('test.eur')::uuid, 1, current_setting('test.customer')::uuid
  )
  returning id into v_id;
  if v_id is null then
    raise exception 'phase 1: a sales order was not saved';
  end if;
  begin
    perform public.en16931_document(v_id);
    raise exception 'phase 1: a sales order was exported';
  exception
    when others then
      if sqlerrm not like '%An order is not exported%' then
        raise exception 'phase 1: order export error was %', sqlerrm;
      end if;
  end;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, customer_id
  ) values (
    current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.si')::uuid,
    '2026-10-06', 'Acme', current_setting('test.eur')::uuid, 1, current_setting('test.customer')::uuid
  )
  returning id into v_id;

  begin
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, line_number, description,
      quantity, price, discount_amount, nett_amount, vat_amount, vat_rate_id
    ) values (
      current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v_id, 1, 'Sold',
      1, 10, 0, 0, 0, current_setting('test.purchase_vat')::uuid
    );
    raise exception 'phase 1: an expense VAT rate was saved on a sales line';
  exception
    when others then
      if sqlerrm not like '%Sales rate%' then
        raise exception 'phase 1: sales VAT error was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, line_number, description,
      quantity, price, discount_amount, nett_amount, vat_amount, vat_rate_id
    )
    select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, id, 1, 'Bought',
      1, 10, 0, 0, 0, current_setting('test.sales_vat')::uuid
    from public.transaction_headers
    where organisation_id = current_setting('test.org')::uuid
      and transaction_type_id = current_setting('test.pi')::uuid;
    raise exception 'phase 1: a sales VAT rate was saved on a purchase line';
  exception
    when others then
      if sqlerrm not like '%Expense rate%' then
        raise exception 'phase 1: purchase VAT error was %', sqlerrm;
      end if;
  end;

  update public.transaction_types
  set reference_prefix = 'INV-', reference_padding = 5
  where id = current_setting('test.si')::uuid;
  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_types set last_reference = 41 where id = current_setting('test.si')::uuid;
  -- The type trigger only allows last_reference to advance by one, so walk it forward.
  perform 1;
end;
$$;

do $$
declare
  v_step integer;
  v_id uuid;
  v_number text;
begin
  for v_step in 1..41 loop
    update public.transaction_types
    set last_reference = v_step
    where id = current_setting('test.si')::uuid;
  end loop;

  insert into public.transaction_lines (
    tenant_id, organisation_id, header_id, line_number, description,
    quantity, price, discount_amount, nett_amount, vat_amount, vat_rate_id, gl_code_id
  )
  select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, id, 1, 'Sold',
    1, 10, 0, 0, 0, current_setting('test.sales_vat')::uuid,
    (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000')
  from public.transaction_headers
  where organisation_id = current_setting('test.org')::uuid
    and transaction_type_id = current_setting('test.si')::uuid
    and status = 'draft'
  limit 1;

  select id into v_id
  from public.transaction_headers
  where organisation_id = current_setting('test.org')::uuid
    and transaction_type_id = current_setting('test.si')::uuid
    and status = 'draft'
  limit 1;

  perform public.post_document(v_id, null);
  select document_number into v_number from public.transaction_headers where id = v_id;
  if v_number <> 'INV-00042' then
    raise exception 'phase 1: document number was %', v_number;
  end if;

  update public.transaction_types
  set reference_prefix = 'BILL-'
  where id = current_setting('test.si')::uuid;
  select document_number into v_number from public.transaction_headers where id = v_id;
  if v_number <> 'INV-00042' then
    raise exception 'phase 1: a later prefix change rewrote %', v_number;
  end if;
end;
$$;

rollback;
select 'sales phase 1 ok';
