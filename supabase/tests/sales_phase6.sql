-- Sales phase 6. End-to-end EN 16931 exports for sales invoices, a credit note, reverse charge, and a purchase.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c6c6c6c6-c6c6-4c6c-8c6c-c6c6c6c6c6c6', 'owner-sales6@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'c6c6c6c6-c6c6-4c6c-8c6c-c6c6c6c6c6c6', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Export Books', 'Export Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Standard 23', 23, 'Sales', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S13', 'Reduced 13.5', 13.5, 'Sales', 'S');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category, exemption_reason)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'AE0', 'Reverse charge', 0, 'Sales', 'AE', 'Reverse charge');
update public.organisation_defaults
set address_line1 = '1 Dock Road', city = 'Dublin', country_code = 'IE', vat_number = 'IE1234567T',
    peppol_scheme = '9935', peppol_id = 'IE1234567T', iban = 'IE29AIBK93115212345678', bic = 'AIBKIE2D',
    bank_account_name = 'Export Office'
where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city, country_code,
  vat_number, peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme Limited', id,
  '4 Quay', 'Cork', 'IE', 'IE7654321A', '9935', 'IE7654321A', 'PO-44', 30
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city, country_code,
  peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'BERL', 'Berlin GmbH', id,
  '10 Tor', 'Berlin', 'DE', '9935', 'DE123456789', 'PO-EU', 14
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.suppliers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city, country_code,
  vat_number, peppol_scheme, peppol_id
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id,
  'Quay 4', 'Dublin', 'IE', 'IE7654321B', '9935', 'IE7654321B'
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'INV-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SC', 'Sales credit', 0, 'Sales', 'credit_note', 'CR-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', null, 0);

select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.acme', (select id::text from public.customers where code = 'ACME' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.berlin', (select id::text from public.customers where code = 'BERL' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.si', (select id::text from public.transaction_types where code = 'SI' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.sc', (select id::text from public.transaction_types where code = 'SC' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.pi', (select id::text from public.transaction_types where code = 'PI' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.income', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.s23', (select id::text from public.vat_rates where code = 'S23' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.s13', (select id::text from public.vat_rates where code = 'S13' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.ae', (select id::text from public.vat_rates where code = 'AE0' and organisation_id = current_setting('test.org')::uuid), true);

do $$
declare
  v_invoice uuid;
  v_credit uuid;
  v_reverse uuid;
  v_purchase uuid;
  v_doc jsonb;
  v_errors integer;
begin
  v_invoice := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'Books', 'quantity', 2, 'price', 100, 'discountAmount', 10, 'vatRateId', current_setting('test.s23'), 'glCodeId', current_setting('test.income')),
      jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 40, 'vatRateId', current_setting('test.s13'), 'glCodeId', current_setting('test.income'))
    )
  ));
  if (select count(*) from public.en16931_readiness(v_invoice) where severity = 'error') <> 0 then
    raise exception 'phase 6: the sales invoice was not ready: %', (select string_agg(message, ' ') from public.en16931_readiness(v_invoice));
  end if;
  perform public.post_document(v_invoice, null);
  v_doc := public.en16931_document(v_invoice);
  if v_doc->>'BT-1' <> 'INV-00001' or v_doc->>'BT-3' <> '380' then
    raise exception 'phase 6: invoice header was %', v_doc;
  end if;
  if v_doc#>>'{BG-22,BT-106}' is distinct from v_doc#>>'{BG-22,BT-109}'
     or v_doc#>>'{BG-22,BT-112}' is distinct from public.en16931_amount((v_doc#>>'{BG-22,BT-109}')::numeric + (v_doc#>>'{BG-22,BT-110}')::numeric) then
    raise exception 'phase 6: invoice totals did not reconcile %', v_doc->'BG-22';
  end if;
  if jsonb_array_length(v_doc->'BG-23') <> 2 then
    raise exception 'phase 6: expected two VAT categories, got %', v_doc->'BG-23';
  end if;

  v_credit := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.sc'),
    'customerId', current_setting('test.acme'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'precedingHeaderId', v_invoice,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'Books returned', 'quantity', 1, 'price', 50, 'vatRateId', current_setting('test.s23'), 'glCodeId', current_setting('test.income'))
    )
  ));
  perform public.post_document(v_credit, null);
  v_doc := public.en16931_document(v_credit);
  if v_doc->>'BT-3' <> '381' or v_doc#>>'{BG-3,BT-25}' <> 'INV-00001' then
    raise exception 'phase 6: credit note reference was %', v_doc;
  end if;

  v_reverse := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.berlin'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'Consulting', 'quantity', 1, 'price', 80, 'vatRateId', current_setting('test.ae'), 'glCodeId', current_setting('test.income'))
    )
  ));
  select count(*) into v_errors from public.en16931_readiness(v_reverse) where severity = 'error' and business_term = 'BT-48';
  if v_errors < 1 then
    raise exception 'phase 6: reverse charge posted without the buyer VAT number';
  end if;
  update public.customers set vat_number = 'DE123456789' where id = current_setting('test.berlin')::uuid;
  if (select count(*) from public.en16931_readiness(v_reverse) where severity = 'error') <> 0 then
    raise exception 'phase 6: reverse charge was not ready: %', (select string_agg(rule_id || ' ' || message, ' ') from public.en16931_readiness(v_reverse));
  end if;
  perform public.post_document(v_reverse, null);

  v_purchase := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'supplierReference', 'SUP-42',
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 20))
  ));
  perform public.post_document(v_purchase, null);
  v_doc := public.en16931_document(v_purchase);
  if v_doc->>'BT-1' <> 'SUP-42'
     or v_doc#>>'{BG-4,BT-27}' <> 'Vodafone'
     or v_doc#>>'{BG-7,BT-44}' <> 'Export Office' then
    raise exception 'phase 6: purchase parties were %', v_doc;
  end if;
end;
$$;

rollback;
select 'sales phase 6 ok';
