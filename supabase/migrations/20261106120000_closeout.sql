-- Close-out schema: duplicates, secrets, Ask Qula, and Access Point settings.

create or replace function public.store_e_document(
  p_envelope jsonb,
  p_signature text,
  p_xml text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_id text := p_envelope->>'keyId';
  v_issued timestamptz := nullif(p_envelope->>'issuedAt', '')::timestamptz;
  v_org uuid := nullif(p_envelope->>'organisationId', '')::uuid;
  v_direction public.e_document_direction := nullif(p_envelope->>'direction', '')::public.e_document_direction;
  v_source text := p_envelope->>'source';
  v_header uuid := nullif(p_envelope->>'headerId', '')::uuid;
  v_sha text := p_envelope->>'sha256';
  v_size integer := nullif(p_envelope->>'byteSize', '')::integer;
  v_summary jsonb := coalesce(p_envelope->'summary', '{}'::jsonb);
  v_semantic jsonb := p_envelope->'semantic';
  v_validation jsonb := coalesce(p_envelope->'validation', '{}'::jsonb);
  v_expected text;
  v_existing uuid;
  v_id uuid;
  v_tenant uuid;
  v_scheme text;
  v_peppol text;
  v_vat text;
  v_status public.e_document_status;
  v_duplicate uuid;
  v_fatal boolean;
  v_header_status public.document_status;
  v_header_kind public.document_kind;
  v_header_type text;
  v_result jsonb;
begin
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_issued is null or v_issued < now() - interval '10 minutes' or v_issued > now() + interval '2 minutes' then
    raise exception 'The envelope has expired';
  end if;
  if v_direction is null or v_source not in ('generated', 'manual_upload') then
    raise exception 'The envelope is not valid';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'The envelope is not valid';
  end if;
  if p_xml is null or octet_length(convert_to(p_xml, 'utf8')) > 4194304 or octet_length(convert_to(p_xml, 'utf8')) <> v_size then
    raise exception 'The e-document file is too large';
  end if;

  v_expected := private.einvoice_signature(v_key_id, p_envelope);
  if not private.signatures_match(lower(p_signature), v_expected) then
    raise exception 'The envelope signature does not match';
  end if;
  if encode(extensions.digest(convert_to(p_xml, 'utf8'), 'sha256'), 'hex') is distinct from v_sha then
    raise exception 'The e-document file does not match its recorded hash';
  end if;

  if v_direction = 'inbound' then
    select id into v_existing
    from public.e_documents
    where organisation_id = v_org and direction = 'inbound' and sha256 = v_sha;
    if v_existing is not null then
      return v_existing;
    end if;

    select peppol_scheme, peppol_id, vat_number
      into v_scheme, v_peppol, v_vat
    from public.organisation_defaults
    where organisation_id = v_org;

    if v_scheme is not null and v_peppol is not null then
      if v_summary->>'receiverScheme' is distinct from v_scheme
         or lower(coalesce(v_summary->>'receiverId', '')) is distinct from lower(v_peppol) then
        raise exception 'This e-invoice is addressed to a different organisation';
      end if;
    elsif v_vat is not null then
      if lower(coalesce(v_summary->>'buyerVat', '')) is distinct from lower(v_vat) then
        raise exception 'This e-invoice is addressed to a different organisation';
      end if;
    else
      raise exception 'Set a Peppol ID or VAT number before receiving an e-invoice';
    end if;
  else
    select header.status, kind.document_kind, kind.type
      into v_header_status, v_header_kind, v_header_type
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    where header.id = v_header and header.organisation_id = v_org;

    if v_header_status is distinct from 'posted'
       or v_header_type is distinct from 'Sales'
       or v_header_kind not in ('invoice', 'credit_note') then
      raise exception 'An outbound e-invoice needs a posted sales invoice or credit note';
    end if;
    if v_semantic is distinct from public.en16931_document(v_header) then
      raise exception 'The e-invoice does not match the posted document';
    end if;
    if exists (
      select 1 from public.e_documents
      where header_id = v_header and direction = 'outbound' and status = 'valid'
    ) then
      raise exception 'This document already has a valid e-invoice';
    end if;
  end if;

  select tenant_id into v_tenant from public.organisations where id = v_org;
  v_fatal := exists (
    select 1 from jsonb_array_elements(coalesce(v_validation->'results', '[]'::jsonb)) as item
    where item->>'severity' = 'fatal'
  );

  insert into public.e_documents (
    tenant_id, organisation_id, direction, status, source, ubl_root,
    customization_id, profile_id, header_id, sha256, byte_size,
    sender_scheme, sender_id, receiver_scheme, receiver_id,
    document_number, issue_date, currency_code, total_amount, amount_due,
    seller_name, seller_vat_number, buyer_name, buyer_vat_number,
    semantic, validator_version, rules_version, created_by, updated_by
  ) values (
    v_tenant,
    v_org,
    v_direction,
    case when v_direction = 'outbound' then 'generated'::public.e_document_status else 'received'::public.e_document_status end,
    v_source,
    v_summary->>'ublRoot',
    nullif(v_summary->>'customizationId', ''),
    nullif(v_summary->>'profileId', ''),
    v_header,
    v_sha,
    v_size,
    nullif(v_summary->>'senderScheme', ''),
    nullif(v_summary->>'senderId', ''),
    nullif(v_summary->>'receiverScheme', ''),
    nullif(v_summary->>'receiverId', ''),
    nullif(v_summary->>'documentNumber', ''),
    nullif(v_summary->>'issueDate', '')::date,
    nullif(v_summary->>'currencyCode', ''),
    nullif(v_summary->>'totalAmount', '')::numeric,
    nullif(v_summary->>'amountDue', '')::numeric,
    nullif(v_summary->>'sellerName', ''),
    nullif(v_summary->>'sellerVat', ''),
    nullif(v_summary->>'buyerName', ''),
    nullif(v_summary->>'buyerVat', ''),
    v_semantic,
    nullif(v_validation->>'validatorVersion', ''),
    nullif(v_validation->>'rulesVersion', ''),
    (select auth.uid()),
    (select auth.uid())
  )
  returning id into v_id;

  insert into public.e_document_contents (e_document_id, organisation_id, xml)
  values (v_id, v_org, p_xml);

  insert into public.e_document_validation_results (
    e_document_id, organisation_id, layer, rule_id, severity, location, message
  )
  select
    v_id,
    v_org,
    item->>'layer',
    item->>'ruleId',
    item->>'severity',
    nullif(item->>'location', ''),
    item->>'message'
  from jsonb_array_elements(coalesce(v_validation->'results', '[]'::jsonb)) as item;

  if v_fatal then
    v_status := 'invalid';
  elsif v_direction = 'inbound' then
    select id into v_duplicate
    from public.e_documents
    where organisation_id = v_org
      and direction = 'inbound'
      and id <> v_id
      and status <> 'rejected'
      and ubl_root is not distinct from nullif(v_summary->>'ublRoot', '')
      and document_number is not distinct from nullif(v_summary->>'documentNumber', '')
      and nullif(v_summary->>'documentNumber', '') is not null
      and (
        (
          nullif(sender_id, '') is not null
          and nullif(v_summary->>'senderId', '') is not null
          and sender_scheme is not distinct from nullif(v_summary->>'senderScheme', '')
          and lower(sender_id) is not distinct from lower(v_summary->>'senderId')
        )
        or (
          (nullif(sender_id, '') is null or nullif(v_summary->>'senderId', '') is null)
          and nullif(seller_vat_number, '') is not null
          and lower(seller_vat_number) is not distinct from lower(nullif(v_summary->>'sellerVat', ''))
        )
      )
    order by created_at
    limit 1;
    if v_duplicate is not null then
      v_status := 'duplicate';
    else
      v_status := 'valid';
    end if;
  else
    v_status := 'valid';
  end if;

  perform private.set_e_document_status(
    v_id,
    v_status,
    jsonb_strip_nulls(jsonb_build_object('duplicateOf', v_duplicate))
  );
  return v_id;
end;
$$;

revoke all on function public.store_e_document(jsonb, text, text) from public, anon;
grant execute on function public.store_e_document(jsonb, text, text) to authenticated;

create or replace function public.import_e_document(p_id uuid, p_choices jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_doc public.e_documents%rowtype;
  v_type uuid;
  v_kind public.document_kind;
  v_currency uuid;
  v_rate numeric;
  v_supplier uuid := nullif(p_choices->>'supplierId', '')::uuid;
  v_supplier_currency uuid;
  v_code text;
  v_line jsonb;
  v_choice jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_vat uuid;
  v_vat_category text;
  v_vat_rate numeric;
  v_vat_type text;
  v_price numeric;
  v_base numeric;
  v_discount numeric;
  v_allowance jsonb;
  v_unsupported text;
  v_header uuid;
  v_payload jsonb;
begin
  select * into v_doc from public.e_documents where id = p_id;
  if v_doc.id is null or not private.is_org_member(v_doc.organisation_id) then
    raise exception 'That e-document was not found';
  end if;
  if v_doc.direction is distinct from 'inbound' or v_doc.status is distinct from 'valid' then
    raise exception 'Only a valid received e-invoice can be imported';
  end if;
  if v_doc.semantic is null then
    raise exception 'This e-invoice could not be read';
  end if;

  select string_agg(value, ', ') into v_unsupported
  from jsonb_array_elements_text(coalesce(v_doc.semantic->'_unsupported', '[]'::jsonb));
  if v_unsupported is not null then
    raise exception 'This e-invoice uses features Qula Tran cannot import yet: %', v_unsupported;
  end if;

  if v_doc.ubl_root = 'CreditNote' then
    select inbound_credit_note_type_id into v_type
    from public.organisation_defaults where organisation_id = v_doc.organisation_id;
    v_kind := 'credit_note';
  else
    select inbound_invoice_type_id into v_type
    from public.organisation_defaults where organisation_id = v_doc.organisation_id;
    v_kind := 'invoice';
  end if;
  if v_type is null then
    raise exception 'Choose the default Purchases document type before importing';
  end if;

  select id into v_currency
  from public.currencies
  where organisation_id = v_doc.organisation_id
    and (iso_code = v_doc.currency_code or code = v_doc.currency_code);
  if v_currency is null then
    raise exception 'Add the invoice currency to this organisation before importing';
  end if;
  select rate into v_rate from public.currencies where id = v_currency;

  if coalesce(p_choices->>'createSupplier', '') = 'true' then
    raise exception 'Create the supplier before importing';
  end if;

  if v_supplier is null then
    raise exception 'Choose a supplier';
  end if;
  select currency_id into v_supplier_currency
  from public.suppliers
  where id = v_supplier and organisation_id = v_doc.organisation_id;
  if v_supplier_currency is null then
    raise exception 'Choose a supplier from this organisation';
  end if;
  if v_supplier_currency is distinct from v_currency then
    raise exception 'The supplier currency must match the e-invoice currency';
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(v_doc.semantic->'BG-25', '[]'::jsonb))
  loop
    select value into v_choice
    from jsonb_array_elements(coalesce(p_choices->'lines', '[]'::jsonb)) as value
    where value->>'lineNumber' = v_line->>'BT-126'
    limit 1;

    v_vat := nullif(v_choice->>'vatRateId', '')::uuid;
    if v_vat is null then
      raise exception 'Choose an Expense VAT rate for each line';
    end if;
    select vat_category, rate, vat_type into v_vat_category, v_vat_rate, v_vat_type
    from public.vat_rates
    where id = v_vat and organisation_id = v_doc.organisation_id;
    if v_vat_type is distinct from 'Expense'
       or v_vat_category is distinct from nullif(v_line #>> '{BG-30,BT-151}', '')
       or v_vat_rate is distinct from nullif(v_line #>> '{BG-30,BT-152}', '')::numeric then
      raise exception 'Choose an Expense VAT rate that matches the e-invoice category and percentage';
    end if;

    v_price := nullif(v_line #>> '{BG-29,BT-146}', '')::numeric;
    v_base := nullif(v_line #>> '{BG-29,BT-149}', '')::numeric;
    if v_base is not null and v_base <> 0 and v_price is not null then
      v_price := v_price / v_base;
    end if;
    v_discount := 0;
    for v_allowance in
      select value from jsonb_array_elements(coalesce(v_line->'BG-27', '[]'::jsonb))
    loop
      if coalesce(v_allowance->>'charge', '') = 'true' then
        raise exception 'This e-invoice uses features Qula Tran cannot import yet: line charge';
      end if;
      v_discount := v_discount + coalesce(nullif(v_allowance->>'BT-136', '')::numeric, 0);
    end loop;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', coalesce(nullif(v_line #>> '{BG-31,BT-153}', ''), 'Item'),
      'quantity', coalesce(v_line->>'BT-129', '1'),
      'price', coalesce(v_price, 0),
      'discountAmount', v_discount,
      'unitCode', coalesce(nullif(v_line->>'BT-130', ''), 'C62'),
      'vatRateId', v_vat,
      'glCodeId', nullif(v_choice->>'glCodeId', ''),
      'departmentId', nullif(v_choice->>'departmentId', ''),
      'costCentreId', nullif(v_choice->>'costCentreId', ''),
      'sellerItemId', nullif(v_line #>> '{BG-31,BT-155}', ''),
      'lineNote', nullif(v_line->>'BT-127', '')
    ));
  end loop;

  v_payload := jsonb_build_object(
    'transactionTypeId', v_type,
    'transactionDate', v_doc.issue_date,
    'dueDate', nullif(v_doc.semantic->>'BT-9', ''),
    'supplierId', v_supplier,
    'partyName', coalesce(v_doc.seller_name, 'Supplier'),
    'currencyId', v_currency,
    'exchangeRate', v_rate,
    'orderNumber', nullif(v_doc.semantic->>'BT-13', ''),
    'supplierReference', v_doc.document_number,
    'precedingReference', nullif(v_doc.semantic #>> '{BG-3,BT-25}', ''),
    'precedingDate', nullif(v_doc.semantic #>> '{BG-3,BT-26}', ''),
    'buyerReference', nullif(v_doc.semantic->>'BT-10', ''),
    'contractReference', nullif(v_doc.semantic->>'BT-12', ''),
    'paymentTerms', nullif(v_doc.semantic->>'BT-20', ''),
    'notes', nullif(v_doc.semantic->>'BT-22', ''),
    'invoicePeriodStart', nullif(v_doc.semantic #>> '{BG-14,BT-73}', ''),
    'invoicePeriodEnd', nullif(v_doc.semantic #>> '{BG-14,BT-74}', ''),
    'lines', v_lines
  );

  begin
    v_header := public.save_document(v_payload);
  exception
    when unique_violation then
      raise exception 'This supplier invoice number is already used on another document';
  end;

  perform private.set_e_document_status(p_id, 'imported', jsonb_build_object('headerId', v_header));
  return v_header;
end;
$$;

revoke all on function public.import_e_document(uuid, jsonb) from public, anon;
grant execute on function public.import_e_document(uuid, jsonb) to authenticated;

-- Close-out: duplicate release, reject permission, organisation delete, secrets, Ask Qula, Access Point.

create or replace function private.e_document_transition_allowed(
  p_direction public.e_document_direction,
  p_from public.e_document_status,
  p_to public.e_document_status
)
returns boolean
language sql
immutable
as $$
  select case
    when p_direction = 'outbound' and p_from = 'generated' and p_to in ('valid', 'invalid') then true
    when p_direction = 'inbound' and p_from = 'received' and p_to in ('valid', 'invalid', 'duplicate') then true
    when p_direction = 'inbound' and p_from = 'duplicate' and p_to in ('valid', 'rejected') then true
    when p_direction = 'inbound' and p_from = 'valid' and p_to in ('imported', 'rejected') then true
    when p_direction = 'inbound' and p_from = 'invalid' and p_to = 'rejected' then true
    else false
  end;
$$;

revoke all on function private.e_document_transition_allowed(public.e_document_direction, public.e_document_status, public.e_document_status)
  from public, anon, authenticated;

create or replace function public.reject_e_document(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_direction public.e_document_direction;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A rejection needs a reason';
  end if;
  select organisation_id, direction into v_org, v_direction
  from public.e_documents where id = p_id;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That e-document was not found';
  end if;
  if not private.has_org_role(v_org, array['owner', 'admin']) then
    raise exception 'Only an owner or admin can reject an e-invoice';
  end if;
  if v_direction is distinct from 'inbound' then
    raise exception 'Only a received e-invoice can be rejected';
  end if;
  perform private.set_e_document_status(p_id, 'rejected', jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

revoke all on function public.reject_e_document(uuid, text) from public, anon;
grant execute on function public.reject_e_document(uuid, text) to authenticated;

create or replace function public.release_duplicate_e_document(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.e_document_status;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A release needs a reason';
  end if;
  select organisation_id, status into v_org, v_status from public.e_documents where id = p_id;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That e-document was not found';
  end if;
  if not private.has_org_role(v_org, array['owner', 'admin']) then
    raise exception 'Only an owner or admin can release a duplicate';
  end if;
  if v_status is distinct from 'duplicate' then
    raise exception 'Only a duplicate e-invoice can be released';
  end if;
  perform private.set_e_document_status(p_id, 'valid', jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

revoke all on function public.release_duplicate_e_document(uuid, text) from public, anon;
grant execute on function public.release_duplicate_e_document(uuid, text) to authenticated;

create or replace function public.delete_organisation(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_organisations integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before deleting an organisation';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner'])) then
    raise exception 'You need an owner role to delete an organisation';
  end if;

  select tenant_id into v_tenant
  from public.organisations
  where id = p_organisation_id;

  if v_tenant is null then
    raise exception 'That organisation could not be deleted';
  end if;
  if exists (
    select 1 from public.transaction_headers where organisation_id = p_organisation_id
  ) then
    raise exception 'This organisation has documents and cannot be deleted.';
  end if;
  if exists (
    select 1 from public.e_documents where organisation_id = p_organisation_id
  ) then
    raise exception 'This organisation has e-documents and cannot be deleted.';
  end if;

  select count(*) into v_organisations
  from public.organisations
  where tenant_id = v_tenant;

  if v_organisations <= 1 then
    raise exception 'A tenant must keep at least one organisation';
  end if;

  perform set_config('fintran.deleting_organisation', 'on', true);
  delete from public.organisations where id = p_organisation_id;
  perform set_config('fintran.deleting_organisation', 'off', true);
end;
$$;

revoke all on function public.delete_organisation(uuid) from public, anon;
grant execute on function public.delete_organisation(uuid) to authenticated;

create table public.organisation_secrets (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('ai_api_key', 'ap_api_key', 'ap_webhook_secret')),
  ciphertext text not null,
  hint text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  primary key (organisation_id, kind)
);

alter table public.organisation_secrets enable row level security;
revoke all on public.organisation_secrets from public, anon, authenticated;

create or replace function public.set_organisation_secret(
  p_organisation_id uuid,
  p_kind text,
  p_ciphertext text,
  p_hint text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organisation_id, array['owner', 'admin']) then
    raise exception 'Only an owner or admin can store a secret';
  end if;
  if p_kind not in ('ai_api_key', 'ap_api_key', 'ap_webhook_secret') then
    raise exception 'That secret is not recognised';
  end if;
  insert into public.organisation_secrets (
    organisation_id, tenant_id, kind, ciphertext, hint, created_by, updated_by
  )
  select p_organisation_id, tenant_id, p_kind, p_ciphertext, nullif(p_hint, ''), auth.uid(), auth.uid()
  from public.organisations where id = p_organisation_id
  on conflict (organisation_id, kind) do update
    set ciphertext = excluded.ciphertext,
        hint = excluded.hint,
        updated_at = now(),
        updated_by = auth.uid();
  insert into public.audit_log (table_name, row_id, action, new_values, changed_by, tenant_id, organisation_id)
  select 'organisation_secrets', p_organisation_id::text, 'UPDATE',
    jsonb_build_object('kind', p_kind, 'hint', nullif(p_hint, '')),
    auth.uid(), tenant_id, id
  from public.organisations where id = p_organisation_id;
end;
$$;

create or replace function public.clear_organisation_secret(p_organisation_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organisation_id, array['owner', 'admin']) then
    raise exception 'Only an owner or admin can remove a secret';
  end if;
  delete from public.organisation_secrets
  where organisation_id = p_organisation_id and kind = p_kind;
  insert into public.audit_log (table_name, row_id, action, new_values, changed_by, tenant_id, organisation_id)
  select 'organisation_secrets', p_organisation_id::text, 'DELETE',
    jsonb_build_object('kind', p_kind),
    auth.uid(), tenant_id, id
  from public.organisations where id = p_organisation_id;
end;
$$;

create or replace function public.organisation_secret_status(p_organisation_id uuid)
returns table (kind text, hint text, updated_at timestamptz, updated_by uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organisation_id) then
    raise exception 'That organisation was not found';
  end if;
  return query
    select secrets.kind, secrets.hint, secrets.updated_at, secrets.updated_by
    from public.organisation_secrets as secrets
    where secrets.organisation_id = p_organisation_id;
end;
$$;

create or replace function public.organisation_secret_ciphertext(p_organisation_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  if not private.is_org_member(p_organisation_id) then
    raise exception 'That organisation was not found';
  end if;
  select ciphertext into v_value
  from public.organisation_secrets
  where organisation_id = p_organisation_id and kind = p_kind;
  return v_value;
end;
$$;

revoke all on function public.set_organisation_secret(uuid, text, text, text) from public, anon;
revoke all on function public.clear_organisation_secret(uuid, text) from public, anon;
revoke all on function public.organisation_secret_status(uuid) from public, anon;
revoke all on function public.organisation_secret_ciphertext(uuid, text) from public, anon;
grant execute on function public.set_organisation_secret(uuid, text, text, text) to authenticated;
grant execute on function public.clear_organisation_secret(uuid, text) to authenticated;
grant execute on function public.organisation_secret_status(uuid) to authenticated;
grant execute on function public.organisation_secret_ciphertext(uuid, text) to authenticated;

create table public.ai_providers (
  code text primary key,
  name text not null,
  needs_base_url boolean not null
);

insert into public.ai_providers (code, name, needs_base_url) values
  ('anthropic', 'Anthropic', false),
  ('openai', 'OpenAI', false),
  ('azure_openai', 'Azure OpenAI', true),
  ('openai_compatible', 'OpenAI-compatible endpoint', true),
  ('mock', 'Mock', false);

alter table public.ai_providers enable row level security;
create policy ai_providers_read on public.ai_providers for select to authenticated using (true);
revoke insert, update, delete on public.ai_providers from authenticated, anon, public;

create table public.ai_settings (
  organisation_id uuid primary key references public.organisations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  enabled boolean not null default false,
  provider_code text references public.ai_providers (code),
  model text check (model is null or char_length(model) between 1 and 100),
  config jsonb not null default '{}'::jsonb,
  data_notice_accepted_at timestamptz,
  data_notice_accepted_by uuid references public.profiles (id) on delete set null,
  user_hourly_limit integer not null default 30 check (user_hourly_limit between 1 and 500),
  organisation_monthly_limit integer check (organisation_monthly_limit is null or organisation_monthly_limit > 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.ai_settings enable row level security;
create policy ai_settings_select on public.ai_settings for select to authenticated
  using (private.is_org_member(organisation_id));
create policy ai_settings_write on public.ai_settings for all to authenticated
  using (private.has_org_role(organisation_id, array['owner', 'admin']))
  with check (private.has_org_role(organisation_id, array['owner', 'admin']));

create table public.ai_usage (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now(),
  provider_code text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  tool_calls integer not null default 0,
  outcome text not null check (outcome in ('ok', 'error', 'limited', 'fallback'))
);

alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (private.has_org_role(organisation_id, array['owner', 'admin']));
revoke insert, update, delete on public.ai_usage from authenticated, anon, public;

create or replace function public.record_ai_usage(
  p_organisation_id uuid,
  p_provider_code text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_tool_calls integer,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organisation_id) then
    raise exception 'That organisation was not found';
  end if;
  if p_outcome not in ('ok', 'error', 'limited', 'fallback') then
    raise exception 'That usage outcome is not recognised';
  end if;
  insert into public.ai_usage (
    organisation_id, tenant_id, user_id, provider_code, model,
    input_tokens, output_tokens, tool_calls, outcome
  )
  select p_organisation_id, tenant_id, auth.uid(), p_provider_code, p_model,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_tool_calls, 0), p_outcome
  from public.organisations where id = p_organisation_id;
end;
$$;

revoke all on function public.record_ai_usage(uuid, text, text, integer, integer, integer, text) from public, anon;
grant execute on function public.record_ai_usage(uuid, text, text, integer, integer, integer, text) to authenticated;

create table public.access_point_providers (
  code text primary key,
  name text not null,
  environments text[] not null,
  active boolean not null default true
);

insert into public.access_point_providers (code, name, environments) values
  ('mock', 'Mock', array['sandbox', 'production']);

alter table public.access_point_providers enable row level security;
create policy access_point_providers_read on public.access_point_providers for select to authenticated using (true);
revoke insert, update, delete on public.access_point_providers from authenticated, anon, public;

create table public.access_point_settings (
  organisation_id uuid primary key references public.organisations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider_code text not null references public.access_point_providers (code),
  environment text not null check (environment in ('sandbox', 'production')),
  config jsonb not null default '{}'::jsonb,
  status text not null default 'configured' check (status in ('configured', 'verified', 'suspended')),
  last_test_at timestamptz,
  last_test_result text,
  participant_registered boolean not null default false,
  participant_registered_at timestamptz,
  webhook_token text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.access_point_settings enable row level security;
create policy access_point_settings_select on public.access_point_settings for select to authenticated
  using (private.is_org_member(organisation_id));
create policy access_point_settings_write on public.access_point_settings for all to authenticated
  using (private.has_org_role(organisation_id, array['owner', 'admin']))
  with check (private.has_org_role(organisation_id, array['owner', 'admin']));
