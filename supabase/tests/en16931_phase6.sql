-- EN 16931 phase 6. JSON export and readiness. Sales stay blocked except inside this rollback.
-- The checks below were run against the live database and rolled back.
begin;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6', 'owner-phase6@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb),
  ('b6b6b6b6-b6b6-4b6b-8b6b-b6b6b6b6b6b6', 'other-phase6@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Other"}'::jsonb);
select set_config('request.jwt.claims', json_build_object('sub', 'a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Six Books', 'Phase Six Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1);
update public.organisation_defaults
set address_line1 = 'Dock 1', city = 'Dublin', vat_number = 'IE1234567T',
    peppol_scheme = '9935', peppol_id = 'IE1234567T', iban = 'IE29AIBK93115212345678'
where organisation_id = current_setting('test.org')::uuid;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city, vat_number, peppol_scheme, peppol_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin', 'IE7654321A', '9935', 'IE7654321A'
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PO', 'Purchase order', 0, 'Purchases', 'order'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PC', 'Purchase credit', 0, 'Purchases', 'credit_note');
select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.pi', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);

do $$
declare
  v_id uuid;
  v_doc jsonb;
  v_warnings integer;
begin
  v_id := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-06',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 10))
  ));
  select count(*) into v_warnings from public.en16931_readiness(v_id) where severity = 'warning';
  if v_warnings < 1 then
    raise exception 'phase 6: a sparse purchase had no warnings';
  end if;
  perform public.post_document(v_id, null);

  v_id := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-07',
    'dueDate', '2026-11-06',
    'orderNumber', 'PO-1',
    'supplierReference', 'SUP-9',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Books', 'quantity', 2, 'price', 10, 'discountAmount', 1))
  ));
  perform public.post_document(v_id, null);
  v_doc := public.en16931_document(v_id);
  if v_doc->>'BT-1' <> 'SUP-9' or v_doc->>'BT-3' <> '380' or v_doc->>'BT-23' is null or v_doc->>'BT-24' is null then
    raise exception 'phase 6: export header was %', v_doc;
  end if;
  if v_doc#>>'{BG-25,0,BG-29,BT-146}' <> '10.0000'
     or v_doc#>>'{BG-25,0,BG-27,0,BT-140}' <> '95'
     or v_doc#>>'{BG-25,0,BT-131}' <> '19.00' then
    raise exception 'phase 6: line export was %', v_doc->'BG-25';
  end if;
  update public.suppliers set address_line1 = 'Changed' where id = current_setting('test.supplier')::uuid;
  if (public.en16931_document(v_id)#>>'{BG-4,BG-5,BT-35}') <> 'Quay 4' then
    raise exception 'phase 6: a posted address was rewritten';
  end if;
end;
$$;

rollback;
select 'en16931 phase 6 ok';
