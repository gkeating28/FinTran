-- E-document repository. Rolls back, including the test signing key.
begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'owner-edoc@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"E-doc owner"}'::jsonb),
  ('e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'other-edoc@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"E-doc other"}'::jsonb);

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'einvoice_hmac_ktest', 'e-document test key');

select set_config('request.jwt.claims', json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('E-doc Books', 'E-doc Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);

select set_config('request.jwt.claims', json_build_object('sub', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'role', 'authenticated')::text, true);
select set_config('test.org2', (public.create_tenant('E-doc Other', 'E-doc Elsewhere'))->>'organisation_id', true);
select set_config('request.jwt.claims', json_build_object('sub', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'role', 'authenticated')::text, true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SZ', 'Sales zero', 0, 'Sales', 'Z'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EZ', 'Expense zero', 0, 'Expense', 'Z');
update public.organisation_defaults
set address_line1 = '1 Dock Road', city = 'Dublin', vat_number = 'IE1234567T',
    peppol_scheme = '9935', peppol_id = 'IE1234567T'
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
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'INV-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SO', 'Sales order', 0, 'Sales', 'order', 'ORD-', 5);
update public.organisation_defaults
set inbound_invoice_type_id = (
  select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'
)
where organisation_id = current_setting('test.org')::uuid;

select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'), true);
select set_config('test.customer', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid and code = 'ACME'), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid and code = 'VOD'), true);
select set_config('test.si', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'), true);
select set_config('test.so', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SO'), true);
select set_config('test.pi', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);
select set_config('test.income', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000'), true);
select set_config('test.expense_vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'EZ'), true);
select set_config('test.sales_vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'SZ'), true);
reset role;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'save_purchase_invoice'
  ) then
    raise exception 'edoc: save_purchase_invoice still exists';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transaction_lines' and column_name = 'reference'
  ) then
    raise exception 'edoc: transaction_lines.reference still exists';
  end if;
  if not exists (select 1 from public.ref_countries where code = 'XI' and vat_prefix_only) then
    raise exception 'edoc: XI is not a VAT-only prefix';
  end if;
  if (select count(*) from public.ref_countries where vat_prefix_only) <> 2 then
    raise exception 'edoc: VAT-only prefixes should be EL and XI';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_email_lower_idx') then
    raise exception 'edoc: profiles email index is missing';
  end if;
  if private.canonical_json('{"b":1,"a":{"d":[true,null,"x"],"c":"hi"}}'::jsonb)
       is distinct from '{"a":{"c":"hi","d":[true,null,"x"]},"b":1}' then
    raise exception 'edoc: canonical JSON did not sort keys';
  end if;
end;
$$;

do $$
declare
  v_owner text := 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
  v_other text := 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
  v_org text := current_setting('test.org');
  v_envelope jsonb;
  v_signature text;
  v_xml text;
  v_id uuid;
  v_again uuid;
  v_status public.e_document_status;
  v_duplicate uuid;
  v_count integer;
  v_header uuid;
  v_seen integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.si'),
      'customerId', current_setting('test.customer'),
      'transactionDate', '2026-10-20',
      'currencyId', current_setting('test.eur'),
      'exchangeRate', 1.1,
      'lines', jsonb_build_array(jsonb_build_object(
        'description', 'Rate', 'quantity', 1, 'price', 10,
        'vatRateId', current_setting('test.sales_vat'), 'glCodeId', current_setting('test.income')
      ))
    ));
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%home currency exchange rate must be 1%' then
        raise exception 'edoc: home rate error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.si'),
      'customerId', current_setting('test.customer'),
      'transactionDate', '2026-10-20',
      'currencyId', current_setting('test.eur'),
      'exchangeRate', 1,
      'supplierReference', 'SUP-1',
      'lines', jsonb_build_array(jsonb_build_object(
        'description', 'Sale', 'quantity', 1, 'price', 10,
        'vatRateId', current_setting('test.sales_vat'), 'glCodeId', current_setting('test.income')
      ))
    ));
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%only stored on a purchase%' then
        raise exception 'edoc: sales supplier reference error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.si'),
      'customerId', current_setting('test.customer'),
      'transactionDate', '2026-10-20',
      'currencyId', current_setting('test.eur'),
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object(
        'description', 'Discount', 'quantity', 1, 'price', 10, 'discountAmount', 50,
        'vatRateId', current_setting('test.sales_vat'), 'glCodeId', current_setting('test.income')
      ))
    ));
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%Discount cannot be more than quantity times price%' then
        raise exception 'edoc: discount error was %', sqlerrm;
      end if;
  end;

  begin
    update public.suppliers set country_code = 'XI' where id = current_setting('test.supplier')::uuid;
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%postal country%' then
        raise exception 'edoc: XI postal error was %', sqlerrm;
      end if;
  end;
  update public.suppliers set vat_number = 'XI123456789' where id = current_setting('test.supplier')::uuid;
  if (select vat_number from public.suppliers where id = current_setting('test.supplier')::uuid) is distinct from 'XI123456789' then
    raise exception 'edoc: XI VAT number was refused';
  end if;

  v_header := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.customer'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Goods', 'quantity', 1, 'price', 10,
      'vatRateId', current_setting('test.sales_vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  begin
    perform public.post_document(v_header, 'other-org/snapshots/' || v_header::text);
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%logo path is not valid%' then
        raise exception 'edoc: logo path error was %', sqlerrm;
      end if;
  end;
  perform public.post_document(v_header, null);
  execute 'reset role';

  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">1</Invoice>';
  v_envelope := jsonb_build_object(
    'keyId', 'ktest',
    'issuedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'organisationId', v_org,
    'direction', 'inbound',
    'source', 'manual_upload',
    'headerId', null,
    'sha256', encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex'),
    'byteSize', octet_length(convert_to(v_xml, 'utf8')),
    'summary', jsonb_build_object(
      'ublRoot', 'Invoice', 'customizationId', 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
      'profileId', 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
      'documentNumber', 'INV-1', 'issueDate', '2026-10-20', 'currencyCode', 'EUR',
      'totalAmount', '10.00', 'amountDue', '10.00',
      'senderScheme', '9935', 'senderId', 'IE7654321A', 'receiverScheme', '9935', 'receiverId', 'IE1234567T',
      'sellerName', 'Acme', 'sellerVat', 'IE7654321A', 'buyerName', 'E-doc Office', 'buyerVat', 'IE1234567T'
    ),
    'semantic', jsonb_build_object('BT-1', 'INV-1'),
    'validation', jsonb_build_object('validatorVersion', 'test', 'rulesVersion', '3.0.21', 'results', '[]'::jsonb)
  );
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  v_id := public.store_e_document(v_envelope, v_signature, v_xml);
  v_again := public.store_e_document(v_envelope, v_signature, v_xml);
  execute 'reset role';
  if v_again is distinct from v_id then
    raise exception 'edoc: storing the same file twice created another row';
  end if;
  select status into v_status from public.e_documents where id = v_id;
  if v_status is distinct from 'valid' then
    raise exception 'edoc: first file status was %', v_status;
  end if;

  begin
    execute 'set local role authenticated';
    perform public.store_e_document(v_envelope, 'ab', v_xml);
    execute 'reset role';
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%signature does not match%' then
        raise exception 'edoc: bad signature error was %', sqlerrm;
      end if;
  end;

  v_envelope := jsonb_set(v_envelope, '{keyId}', '"nosuch"');
  begin
    perform private.einvoice_signature('nosuch', v_envelope);
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%Unknown signing key%' then
        raise exception 'edoc: unknown key error was %', sqlerrm;
      end if;
  end;

  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">old</Invoice>';
  v_envelope := jsonb_build_object(
    'keyId', 'ktest',
    'issuedAt', to_char((now() - interval '11 minutes') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'organisationId', v_org, 'direction', 'inbound', 'source', 'manual_upload', 'headerId', null,
    'sha256', encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex'),
    'byteSize', octet_length(convert_to(v_xml, 'utf8')),
    'summary', jsonb_build_object(
      'ublRoot', 'Invoice', 'documentNumber', 'OLD', 'issueDate', '2026-10-20', 'currencyCode', 'EUR',
      'totalAmount', '10.00', 'amountDue', '10.00', 'senderScheme', '9935', 'senderId', 'IE7654321A',
      'receiverScheme', '9935', 'receiverId', 'IE1234567T', 'sellerName', 'Acme', 'sellerVat', 'IE7654321A',
      'buyerName', 'E-doc Office', 'buyerVat', 'IE1234567T'
    ),
    'semantic', jsonb_build_object('BT-1', 'OLD'),
    'validation', jsonb_build_object('validatorVersion', 'test', 'rulesVersion', '3.0.21', 'results', '[]'::jsonb)
  );
  v_signature := private.einvoice_signature('ktest', v_envelope);
  begin
    execute 'set local role authenticated';
    perform public.store_e_document(v_envelope, v_signature, v_xml);
    execute 'reset role';
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%envelope has expired%' then
        raise exception 'edoc: expired envelope error was %', sqlerrm;
      end if;
  end;

  v_envelope := jsonb_set(
    v_envelope,
    '{issuedAt}',
    to_jsonb(to_char((now() + interval '90 seconds') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  );
  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">soon</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_envelope := jsonb_set(v_envelope, '{summary,documentNumber}', '"SOON"');
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  perform public.store_e_document(v_envelope, v_signature, v_xml);
  execute 'reset role';

  select count(*) into v_count from public.e_documents where organisation_id = v_org::uuid;
  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">wrong</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{issuedAt}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_envelope := jsonb_set(v_envelope, '{summary,receiverId}', '"IE0000000X"');
  v_envelope := jsonb_set(v_envelope, '{summary,documentNumber}', '"WRONG"');
  v_signature := private.einvoice_signature('ktest', v_envelope);
  begin
    execute 'set local role authenticated';
    perform public.store_e_document(v_envelope, v_signature, v_xml);
    execute 'reset role';
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%addressed to a different organisation%' then
        raise exception 'edoc: wrong buyer error was %', sqlerrm;
      end if;
  end;
  if (select count(*) from public.e_documents where organisation_id = v_org::uuid) <> v_count then
    raise exception 'edoc: a wrongly addressed file was stored';
  end if;

  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">bad</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{summary,receiverId}', '"IE1234567T"');
  v_envelope := jsonb_set(v_envelope, '{summary,documentNumber}', '"DUP"');
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_envelope := jsonb_set(
    v_envelope,
    '{validation,results}',
    jsonb_build_array(jsonb_build_object('layer', 'peppol', 'ruleId', 'PEPPOL-TEST', 'severity', 'fatal', 'message', 'Example failure'))
  );
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  v_id := public.store_e_document(v_envelope, v_signature, v_xml);
  execute 'reset role';
  select status into v_status from public.e_documents where id = v_id;
  if v_status is distinct from 'invalid' then
    raise exception 'edoc: fatal file status was %', v_status;
  end if;

  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">dup</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_envelope := jsonb_set(v_envelope, '{validation,results}', '[]'::jsonb);
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  v_again := public.store_e_document(v_envelope, v_signature, v_xml);
  execute 'reset role';
  select status, duplicate_of into v_status, v_duplicate from public.e_documents where id = v_again;
  if v_status is distinct from 'duplicate' or v_duplicate is distinct from v_id then
    raise exception 'edoc: duplicate of an invalid file was % of %', v_status, v_duplicate;
  end if;

  begin
    update public.e_document_contents set xml = xml || ' ' where e_document_id = v_id;
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%cannot be changed%' then
        raise exception 'edoc: content update error was %', sqlerrm;
      end if;
  end;
  begin
    delete from public.e_document_contents where e_document_id = v_id;
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%cannot be changed%' then
        raise exception 'edoc: content delete error was %', sqlerrm;
      end if;
  end;
  begin
    update public.e_documents set status = 'generated' where id = v_id;
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%not allowed%' then
        raise exception 'edoc: status transition error was %', sqlerrm;
      end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from public.e_documents;
  if v_seen <> 0 or public.e_document_xml(v_id) is not null then
    raise exception 'edoc: another organisation could see an e-document';
  end if;
  execute 'reset role';

  begin
    delete from public.organisations where id = v_org::uuid;
    raise exception 'edoc: expected a refusal';
  exception
    when foreign_key_violation then null;
    when others then
      if sqlerrm not like '%violates foreign key%' and sqlerrm not like '%still referenced%' then
        raise exception 'edoc: organisation delete error was %', sqlerrm;
      end if;
  end;
end;
$$;

do $$
declare
  v_owner text := 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
  v_org text := current_setting('test.org');
  v_header uuid;
  v_draft uuid;
  v_purchase uuid;
  v_imported uuid;
  v_semantic jsonb;
  v_envelope jsonb;
  v_signature text;
  v_xml text;
  v_id uuid;
  v_nett numeric;
  v_iban text;
  v_name text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_header := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.customer'),
    'transactionDate', '2026-10-21',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Posted', 'quantity', 1, 'price', 20,
      'vatRateId', current_setting('test.sales_vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  perform public.post_document(v_header, null);
  v_semantic := public.en16931_document(v_header);
  v_draft := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.si'),
    'customerId', current_setting('test.customer'),
    'transactionDate', '2026-10-21',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Draft', 'quantity', 1, 'price', 20,
      'vatRateId', current_setting('test.sales_vat'), 'glCodeId', current_setting('test.income')
    ))
  ));
  v_purchase := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-21',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'supplierReference', 'PUR-1',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Purchase', 'quantity', 1, 'price', 20,
      'vatRateId', current_setting('test.expense_vat')
    ))
  ));
  perform public.post_document(v_purchase, null);
  execute 'reset role';

  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">out</Invoice>';
  v_envelope := jsonb_build_object(
    'keyId', 'ktest',
    'issuedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'organisationId', v_org, 'direction', 'outbound', 'source', 'generated', 'headerId', v_header,
    'sha256', encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex'),
    'byteSize', octet_length(convert_to(v_xml, 'utf8')),
    'summary', jsonb_build_object(
      'ublRoot', 'Invoice', 'documentNumber', 'OUT-1', 'issueDate', '2026-10-21', 'currencyCode', 'EUR',
      'totalAmount', '20.00', 'amountDue', '20.00', 'senderScheme', '9935', 'senderId', 'IE1234567T',
      'receiverScheme', '9935', 'receiverId', 'IE7654321A', 'sellerName', 'E-doc Office', 'sellerVat', 'IE1234567T',
      'buyerName', 'Acme', 'buyerVat', 'IE7654321A'
    ),
    'semantic', v_semantic,
    'validation', jsonb_build_object('validatorVersion', 'test', 'rulesVersion', '3.0.21', 'results', '[]'::jsonb)
  );
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  perform public.store_e_document(v_envelope, v_signature, v_xml);
  execute 'reset role';

  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">out2</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_signature := private.einvoice_signature('ktest', v_envelope);
  begin
    execute 'set local role authenticated';
    perform public.store_e_document(v_envelope, v_signature, v_xml);
    execute 'reset role';
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%already has a valid e-invoice%' then
        raise exception 'edoc: second outbound error was %', sqlerrm;
      end if;
  end;

  v_envelope := jsonb_set(v_envelope, '{semantic,BT-1}', '"CHANGED"');
  v_signature := private.einvoice_signature('ktest', v_envelope);
  begin
    execute 'set local role authenticated';
    perform public.store_e_document(v_envelope, v_signature, v_xml);
    execute 'reset role';
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%does not match the posted document%' and sqlerrm not like '%already has a valid e-invoice%' then
        raise exception 'edoc: semantic mismatch error was %', sqlerrm;
      end if;
  end;

  v_envelope := jsonb_set(v_envelope, '{headerId}', to_jsonb(v_draft::text));
  v_envelope := jsonb_set(v_envelope, '{semantic}', coalesce(v_semantic, '{}'::jsonb));
  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">draft</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_signature := private.einvoice_signature('ktest', v_envelope);
  begin
    execute 'set local role authenticated';
    perform public.store_e_document(v_envelope, v_signature, v_xml);
    execute 'reset role';
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%posted sales invoice or credit note%' then
        raise exception 'edoc: draft outbound error was %', sqlerrm;
      end if;
  end;

  v_envelope := jsonb_set(v_envelope, '{headerId}', to_jsonb(v_purchase::text));
  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">purchase</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_signature := private.einvoice_signature('ktest', v_envelope);
  begin
    execute 'set local role authenticated';
    perform public.store_e_document(v_envelope, v_signature, v_xml);
    execute 'reset role';
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%posted sales invoice or credit note%' then
        raise exception 'edoc: purchase outbound error was %', sqlerrm;
      end if;
  end;

  v_semantic := jsonb_build_object(
    'BT-1', 'SUP-1', 'BT-2', '2026-10-20', 'BT-5', 'EUR', 'BT-9', '2026-11-20',
    'BG-4', jsonb_build_object(
      'BT-27', 'Harbour Supplies', 'BT-31', 'IE7654321B',
      'BT-34', jsonb_build_object('scheme', '9935', 'value', 'IE7654321B'),
      'BG-5', jsonb_build_object('BT-35', 'Quay 4', 'BT-37', 'Dublin', 'BT-40', 'IE')
    ),
    'BG-16', jsonb_build_object('BG-17', jsonb_build_object('BT-84', 'IE29AIBK93115212345678')),
    'BG-22', jsonb_build_object('BT-109', '10.00', 'BT-110', '0.00', 'BT-112', '10.00'),
    'BG-25', jsonb_build_array(jsonb_build_object(
      'BT-126', '1', 'BT-129', '1', 'BT-130', 'C62',
      'BG-29', jsonb_build_object('BT-146', '10.00'),
      'BG-30', jsonb_build_object('BT-151', 'Z', 'BT-152', '0.00'),
      'BG-31', jsonb_build_object('BT-153', 'Widgets', 'BT-155', 'W1')
    ))
  );
  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">in</Invoice>';
  v_envelope := jsonb_build_object(
    'keyId', 'ktest',
    'issuedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'organisationId', v_org, 'direction', 'inbound', 'source', 'manual_upload', 'headerId', null,
    'sha256', encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex'),
    'byteSize', octet_length(convert_to(v_xml, 'utf8')),
    'summary', jsonb_build_object(
      'ublRoot', 'Invoice', 'documentNumber', 'SUP-1', 'issueDate', '2026-10-20', 'currencyCode', 'EUR',
      'totalAmount', '10.00', 'amountDue', '10.00', 'senderScheme', '9935', 'senderId', 'IE7654321B',
      'receiverScheme', '9935', 'receiverId', 'IE1234567T', 'sellerName', 'Harbour Supplies', 'sellerVat', 'IE7654321B',
      'buyerName', 'E-doc Office', 'buyerVat', 'IE1234567T'
    ),
    'semantic', v_semantic,
    'validation', jsonb_build_object('validatorVersion', 'test', 'rulesVersion', '3.0.21', 'results', '[]'::jsonb)
  );
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  v_id := public.store_e_document(v_envelope, v_signature, v_xml);
  begin
    perform public.import_e_document(v_id, jsonb_build_object(
      'supplierId', current_setting('test.sales_vat'),
      'lines', jsonb_build_array(jsonb_build_object('lineNumber', '1', 'vatRateId', current_setting('test.sales_vat'), 'price', '1.00'))
    ));
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%Expense VAT rate%' and sqlerrm not like '%Choose a supplier%' then
        raise exception 'edoc: wrong VAT import error was %', sqlerrm;
      end if;
  end;
  v_imported := public.import_e_document(v_id, jsonb_build_object(
    'createSupplier', 'true',
    'supplier', jsonb_build_object('code', 'NEW1', 'name', ''),
    'totalAmount', '1.00',
    'lines', jsonb_build_array(jsonb_build_object(
      'lineNumber', '1', 'vatRateId', current_setting('test.expense_vat'), 'price', '1.00'
    ))
  ));
  execute 'reset role';
  select foreign_nett_amount, party_name into v_nett, v_name from public.transaction_headers where id = v_imported;
  if v_nett is distinct from 10 or v_name is distinct from 'Harbour Supplies' then
    raise exception 'edoc: import used the request figures (% %)', v_nett, v_name;
  end if;
  select name, vat_number, peppol_id, address_line1
    into v_name, v_iban, v_signature, v_xml
  from public.suppliers where organisation_id = v_org::uuid and code = 'NEW1';
  if v_name is distinct from 'Harbour Supplies'
     or v_iban is distinct from 'IE7654321B'
     or v_signature is distinct from 'IE7654321B'
     or v_xml is distinct from 'Quay 4' then
    raise exception 'edoc: created supplier was % % % %', v_name, v_iban, v_signature, v_xml;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'suppliers' and column_name = 'iban'
  ) then
    raise exception 'edoc: suppliers.iban exists; the seller account must not be stored there';
  end if;
  execute 'set local role authenticated';
  begin
    perform public.import_e_document(v_id, jsonb_build_object(
      'createSupplier', 'true',
      'supplier', jsonb_build_object('code', 'NEW2'),
      'lines', jsonb_build_array(jsonb_build_object('lineNumber', '1', 'vatRateId', current_setting('test.expense_vat')))
    ));
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%Only a valid received e-invoice can be imported%' then
        raise exception 'edoc: second import error was %', sqlerrm;
      end if;
  end;
  perform public.save_document(jsonb_build_object(
    'id', v_imported,
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', (select id from public.suppliers where organisation_id = v_org::uuid and code = 'NEW1'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.eur'),
    'exchangeRate', 1,
    'supplierReference', 'SUP-1',
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Widgets', 'quantity', 1, 'price', 12,
      'vatRateId', current_setting('test.expense_vat')
    ))
  ));
  begin
    perform public.post_document(v_imported, null);
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%Totals differ from the e-invoice%' then
        raise exception 'edoc: totals guard error was %', sqlerrm;
      end if;
  end;
  execute 'reset role';

  v_semantic := jsonb_set(v_semantic, '{_unsupported}', jsonb_build_array('document charge'));
  v_xml := '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">charge</Invoice>';
  v_envelope := jsonb_set(v_envelope, '{semantic}', v_semantic);
  v_envelope := jsonb_set(v_envelope, '{summary,documentNumber}', '"SUP-2"');
  v_envelope := jsonb_set(v_envelope, '{issuedAt}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  v_envelope := jsonb_set(v_envelope, '{sha256}', to_jsonb(encode(extensions.digest(convert_to(v_xml, 'utf8'), 'sha256'), 'hex')));
  v_envelope := jsonb_set(v_envelope, '{byteSize}', to_jsonb(octet_length(convert_to(v_xml, 'utf8'))));
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  v_id := public.store_e_document(v_envelope, v_signature, v_xml);
  begin
    perform public.import_e_document(v_id, jsonb_build_object(
      'supplierId', (select id from public.suppliers where organisation_id = v_org::uuid and code = 'NEW1'),
      'lines', jsonb_build_array(jsonb_build_object('lineNumber', '1', 'vatRateId', current_setting('test.expense_vat')))
    ));
    raise exception 'edoc: expected a refusal';
  exception
    when others then
      if sqlerrm not like '%document charge%' then
        raise exception 'edoc: unsupported import error was %', sqlerrm;
      end if;
  end;
  execute 'reset role';
end;
$$;

rollback;
