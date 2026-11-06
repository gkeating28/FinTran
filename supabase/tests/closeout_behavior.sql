-- Close-out behaviour. Rolls back.
begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'owner-close@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Close owner"}'::jsonb),
  ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'member-close@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Close member"}'::jsonb);

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'), 'einvoice_hmac_ktest', 'close-out test key');

select set_config('request.jwt.claims', json_build_object('sub', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Close Books', 'Close Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', public.create_organisation(current_setting('test.tenant')::uuid, 'Close Branch')::text, true);
reset role;

update public.organisation_defaults
set address_line1 = '1 Dock Road', city = 'Dublin', vat_number = 'IE1234567T',
    peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('test.org')::uuid;

insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
values (
  current_setting('test.tenant')::uuid,
  current_setting('test.org')::uuid,
  'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2',
  'member'
);

insert into public.currencies (tenant_id, organisation_id, code, name, rate, iso_code)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1, 'EUR'
where not exists (
  select 1 from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'
);
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EZ', 'Expense zero', 0, 'Expense', 'Z');
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice');
update public.organisation_defaults
set inbound_invoice_type_id = (
  select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'
)
where organisation_id = current_setting('test.org')::uuid;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, vat_number)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme', id, 'IE7654321A'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';

create or replace function pg_temp.store_inbound(
  p_org uuid,
  p_xml text,
  p_number text,
  p_root text,
  p_semantic jsonb,
  p_receiver text default 'IE1234567T'
)
returns uuid
language plpgsql
as $$
declare
  v_envelope jsonb;
  v_signature text;
  v_id uuid;
begin
  v_envelope := jsonb_build_object(
    'keyId', 'ktest',
    'issuedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'organisationId', p_org,
    'direction', 'inbound',
    'source', 'manual_upload',
    'headerId', null,
    'sha256', encode(extensions.digest(convert_to(p_xml, 'utf8'), 'sha256'), 'hex'),
    'byteSize', octet_length(convert_to(p_xml, 'utf8')),
    'summary', jsonb_build_object(
      'ublRoot', p_root,
      'documentNumber', p_number,
      'issueDate', '2026-11-01',
      'currencyCode', 'EUR',
      'totalAmount', '10.00',
      'amountDue', '10.00',
      'senderScheme', '9935',
      'senderId', 'IE7654321A',
      'receiverScheme', '9935',
      'receiverId', p_receiver,
      'sellerName', 'Acme',
      'sellerVat', 'IE7654321A',
      'buyerName', 'Close Office',
      'buyerVat', p_receiver
    ),
    'semantic', p_semantic,
    'validation', jsonb_build_object('validatorVersion', 'test', 'rulesVersion', '3.0.21', 'results', '[]'::jsonb)
  );
  v_signature := private.einvoice_signature('ktest', v_envelope);
  execute 'set local role authenticated';
  v_id := public.store_e_document(v_envelope, v_signature, p_xml);
  execute 'reset role';
  return v_id;
end;
$$;

do $$
declare
  v_org uuid := current_setting('test.org')::uuid;
  v_first uuid;
  v_second uuid;
  v_credit uuid;
  v_status public.e_document_status;
  v_supplier uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'role', 'authenticated')::text, true);

  v_first := pg_temp.store_inbound(v_org, '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">one</Invoice>', 'INV-9', 'Invoice', '{"BT-1":"INV-9"}'::jsonb);
  v_second := pg_temp.store_inbound(v_org, '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">two</Invoice>', 'INV-9', 'Invoice', '{"BT-1":"INV-9"}'::jsonb);
  select status into v_status from public.e_documents where id = v_second;
  if v_status is distinct from 'duplicate' or (select duplicate_of from public.e_documents where id = v_second) is distinct from v_first then
    raise exception 'closeout: second file status was %', v_status;
  end if;

  begin
    execute 'set local role authenticated';
    perform public.import_e_document(v_second, jsonb_build_object('supplierId', (select id from public.suppliers where code = 'ACME')));
    execute 'reset role';
    raise exception 'closeout: a duplicate was imported';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%valid received%' and sqlerrm not like '%duplicate%' then
        raise exception 'closeout: duplicate import error was %', sqlerrm;
      end if;
  end;

  execute 'set local role authenticated';
  perform public.release_duplicate_e_document(v_second, 'Supplier confirmed this is a new invoice');
  execute 'reset role';
  if (select status from public.e_documents where id = v_second) is distinct from 'valid' then
    raise exception 'closeout: released duplicate was not valid';
  end if;
  if not exists (
    select 1 from public.e_document_events
    where e_document_id = v_second and to_status = 'valid' and detail->>'reason' = 'Supplier confirmed this is a new invoice'
  ) then
    raise exception 'closeout: release reason was not stored';
  end if;

  v_credit := pg_temp.store_inbound(v_org, '<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2">cn</CreditNote>', 'INV-9', 'CreditNote', '{"BT-1":"INV-9"}'::jsonb);
  if (select status from public.e_documents where id = v_credit) is distinct from 'valid' then
    raise exception 'closeout: a credit note with the same number was treated as a duplicate';
  end if;

  begin
    execute 'set local role authenticated';
    perform public.import_e_document(v_first, jsonb_build_object('createSupplier', true, 'supplier', jsonb_build_object('code', 'NEW', 'name', 'New')));
    execute 'reset role';
    raise exception 'closeout: createSupplier was accepted';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%Create the supplier before importing%' then
        raise exception 'closeout: createSupplier error was %', sqlerrm;
      end if;
  end;

  perform pg_temp.store_inbound(
    v_org,
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">charge</Invoice>',
    'INV-CHARGE',
    'Invoice',
    '{"BT-1":"INV-CHARGE","_unsupported":["document charge"]}'::jsonb
  );
  begin
    execute 'set local role authenticated';
    perform public.import_e_document(
      (select id from public.e_documents where document_number = 'INV-CHARGE'),
      jsonb_build_object('supplierId', (select id from public.suppliers where code = 'ACME'))
    );
    execute 'reset role';
    raise exception 'closeout: an unsupported file was imported';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%document charge%' then
        raise exception 'closeout: unsupported error was %', sqlerrm;
      end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.reject_e_document(v_first, 'Not ours');
    execute 'reset role';
    raise exception 'closeout: a member rejected an e-invoice';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%owner or admin%' then
        raise exception 'closeout: member reject error was %', sqlerrm;
      end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.reject_e_document(v_credit, 'Wrong supplier');
  execute 'reset role';
  if (select status from public.e_documents where id = v_credit) is distinct from 'rejected' then
    raise exception 'closeout: an admin could not reject';
  end if;

  update public.organisation_defaults
  set peppol_scheme = '9935', peppol_id = 'IE9999999T', vat_number = 'IE9999999T'
  where organisation_id = current_setting('test.org2')::uuid;
  perform pg_temp.store_inbound(current_setting('test.org2')::uuid, '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">branch</Invoice>', 'BR-1', 'Invoice', '{"BT-1":"BR-1"}'::jsonb, 'IE9999999T');
  begin
    execute 'set local role authenticated';
    perform public.delete_organisation(current_setting('test.org2')::uuid);
    execute 'reset role';
    raise exception 'closeout: an organisation with an e-document was deleted';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%This organisation has e-documents and cannot be deleted.%' then
        raise exception 'closeout: e-document delete error was %', sqlerrm;
      end if;
  end;

  execute 'set local role authenticated';
  perform public.set_organisation_secret(v_org, 'ai_api_key', 'cipher-value-not-the-secret', 'cret');
  execute 'reset role';
  if exists (
    select 1 from public.audit_log
    where organisation_id = v_org and table_name = 'organisation_secrets' and new_values::text like '%cipher-value%'
  ) then
    raise exception 'closeout: the audit log stored a secret value';
  end if;
  if not exists (
    select 1 from public.audit_log
    where organisation_id = v_org and table_name = 'organisation_secrets' and new_values->>'kind' = 'ai_api_key' and new_values->>'hint' = 'cret'
  ) then
    raise exception 'closeout: the audit log did not record the secret kind and hint';
  end if;

  begin
    execute 'set local role authenticated';
    insert into public.ai_settings (organisation_id, tenant_id, enabled, provider_code, model, data_notice_accepted_at)
    values (v_org, current_setting('test.tenant')::uuid, true, 'anthropic', 'claude-haiku-5-5', now());
    execute 'reset role';
  exception
    when others then
      execute 'reset role';
      raise exception 'closeout: enabling Ask Qula with a key and notice failed: %', sqlerrm;
  end;

  begin
    execute 'set local role authenticated';
    update public.ai_settings set enabled = true, provider_code = null where organisation_id = v_org;
    execute 'reset role';
    raise exception 'closeout: Ask Qula was enabled without a provider';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%provider and model%' then
        raise exception 'closeout: enable error was %', sqlerrm;
      end if;
  end;
end $$;

rollback;
