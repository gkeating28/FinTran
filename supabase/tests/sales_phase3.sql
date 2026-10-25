-- Sales phase 3. Voiding, credit limits, posting checks, and gapless numbering.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'owner-sales3@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Sales Three Books', 'Sales Three Office'))->>'organisation_id', true);
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
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'Z0', 'Zero', 0, 'Sales', 'Z');
update public.organisation_defaults
set address_line1 = 'Dock 1', city = 'Dublin', vat_number = 'IE1234567T',
    peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city,
  vat_number, peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme', id,
  '1 Quay', 'Dublin', 'IE7654321A', '9935', 'IE7654321A', 'PO-1', 0
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city,
  vat_number, peppol_scheme, peppol_id, default_buyer_reference
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'BETA', 'Beta', id,
  '2 Quay', 'Dublin', 'IE7654321B', '9935', 'IE7654321B', 'PO-2'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'USD';
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PC', 'Purchase credit', 0, 'Purchases', 'credit_note', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'INV-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SC', 'Sales credit', 0, 'Sales', 'credit_note', 'CR-', 5);

select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'), true);
select set_config('test.usd', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'USD'), true);
select set_config('test.acme', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid and code = 'ACME'), true);
select set_config('test.beta', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid and code = 'BETA'), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.pi', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);
select set_config('test.pc', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PC'), true);
select set_config('test.si', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'), true);
select set_config('test.sc', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SC'), true);
select set_config('test.income', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000'), true);
select set_config('test.expense', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '6000'), true);
select set_config('test.vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'Z0'), true);

do $$
declare
  v_invoice uuid;
  v_draft uuid;
  v_credit uuid;
  v_purchase uuid;
  v_last integer;
  v_number text;
begin
  v_draft := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Gap', 'quantity', 1, 'price', 10,
      'vatRateId', current_setting('test.vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  delete from public.transaction_headers where id = v_draft;
  if (select last_reference from public.transaction_types where id = current_setting('test.si')::uuid) <> 0 then
    raise exception 'phase 3: deleting a sales draft used a number';
  end if;

  v_invoice := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Goods', 'quantity', 1, 'price', 100,
      'vatRateId', current_setting('test.vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  perform public.post_document(v_invoice, null);
  select document_number into v_number from public.transaction_headers where id = v_invoice;
  if v_number <> 'INV-00001' then
    raise exception 'phase 3: first number was %', v_number;
  end if;

  begin
    perform public.void_document(v_invoice, 'Wrong');
    raise exception 'phase 3: a sales invoice was voided';
  exception
    when others then
      if sqlerrm not like '%Issue a credit note instead%' then
        raise exception 'phase 3: void error was %', sqlerrm;
      end if;
  end;

  v_purchase := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'supplierReference', 'SUP-1',
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 100))
  ));
  perform public.post_document(v_purchase, null);
  perform public.void_document(v_purchase, 'Re-enter');
  if (select status from public.transaction_headers where id = v_purchase) <> 'void' then
    raise exception 'phase 3: a purchase was not voided';
  end if;

  v_draft := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.beta'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.usd'),
    'exchangeRate', 1,
    'buyerReference', '',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Not ready', 'quantity', 1, 'price', 5,
      'vatRateId', current_setting('test.vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  -- Beta has a buyer reference default, so clear the fields that readiness needs.
  update public.customers
  set peppol_scheme = null, peppol_id = null, default_buyer_reference = null
  where id = current_setting('test.beta')::uuid;
  update public.transaction_headers
  set buyer_reference = null, order_number = null
  where id = v_draft;
  select last_reference into v_last from public.transaction_types where id = current_setting('test.si')::uuid;
  begin
    perform public.post_document(v_draft, null);
    raise exception 'phase 3: an unready sales document was posted';
  exception
    when others then
      if sqlerrm not like '%not ready to post%' then
        raise exception 'phase 3: readiness error was %', sqlerrm;
      end if;
  end;
  if (select last_reference from public.transaction_types where id = current_setting('test.si')::uuid) <> v_last then
    raise exception 'phase 3: a failed post advanced the number';
  end if;

  v_credit := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.sc'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'precedingHeaderId', v_invoice,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Credit', 'quantity', 1, 'price', 60,
      'vatRateId', current_setting('test.vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  perform public.post_document(v_credit, null);

  v_credit := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.sc'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'precedingHeaderId', v_invoice,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Credit', 'quantity', 1, 'price', 60,
      'vatRateId', current_setting('test.vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  begin
    perform public.post_document(v_credit, null);
    raise exception 'phase 3: credits above the invoice total were posted';
  exception
    when others then
      if sqlerrm not like '%above the original invoice total%' then
        raise exception 'phase 3: credit limit error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.sc'),
      'customerId', current_setting('test.beta'),
      'transactionDate', '2026-10-20',
      'currencyId', current_setting('test.usd'),
      'exchangeRate', 1,
      'precedingHeaderId', v_invoice,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Other', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 3: a credit for another customer was saved';
  exception
    when others then
      if sqlerrm not like '%same customer%' then
        raise exception 'phase 3: other customer error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.sc'),
      'customerId', current_setting('test.acme'),
      'transactionDate', '2026-10-20',
      'currencyId', current_setting('test.eur'),
      'exchangeRate', 1,
      'precedingHeaderId', v_draft,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Draft', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 3: a credit against a draft was saved';
  exception
    when others then
      if sqlerrm not like '%posted invoice%' then
        raise exception 'phase 3: draft credit error was %', sqlerrm;
      end if;
  end;

  v_draft := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'No GL', 'quantity', 1, 'price', 10,
      'vatRateId', current_setting('test.vat')
    ))
  ));
  begin
    perform public.post_document(v_draft, null);
    raise exception 'phase 3: a sales line without a GL code was posted';
  exception
    when others then
      if sqlerrm not like '%Income GL code%' then
        raise exception 'phase 3: missing GL error was %', sqlerrm;
      end if;
  end;

  v_draft := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Expense GL', 'quantity', 1, 'price', 10,
      'vatRateId', current_setting('test.vat'), 'glCodeId', current_setting('test.expense')
    ))
  ));
  begin
    perform public.post_document(v_draft, null);
    raise exception 'phase 3: a sales line with an Expense GL code was posted';
  exception
    when others then
      if sqlerrm not like '%Income GL code%' then
        raise exception 'phase 3: expense GL error was %', sqlerrm;
      end if;
  end;

  v_draft := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.acme'),
    'transactionDate', current_date + 2,
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Future', 'quantity', 1, 'price', 10,
      'vatRateId', current_setting('test.vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  begin
    perform public.post_document(v_draft, null);
    raise exception 'phase 3: a future sales document was posted';
  exception
    when others then
      if sqlerrm not like '%more than one day%' then
        raise exception 'phase 3: future date error was %', sqlerrm;
      end if;
  end;
end;
$$;

rollback;
select 'sales phase 3 ok';
