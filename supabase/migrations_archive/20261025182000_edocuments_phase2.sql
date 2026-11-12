-- Signed envelope. The Vercel Function and Postgres share a Vault key.
-- Canonical JSON sorts object keys and has no insignificant whitespace.

create or replace function private.canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text;
  v_key text;
  v_item jsonb;
  v_parts text[] := array[]::text[];
  v_num text;
begin
  if p_value is null then
    return 'null';
  end if;
  v_type := jsonb_typeof(p_value);
  if v_type = 'null' then
    return 'null';
  elsif v_type = 'boolean' then
    return p_value::text;
  elsif v_type = 'number' then
    v_num := p_value #>> '{}';
    if position('.' in v_num) > 0 then
      v_num := regexp_replace(v_num, '0+$', '');
      v_num := regexp_replace(v_num, '\.$', '');
    end if;
    return v_num;
  elsif v_type = 'string' then
    return to_json(p_value #>> '{}')::text;
  elsif v_type = 'array' then
    for v_item in select value from jsonb_array_elements(p_value) loop
      v_parts := v_parts || private.canonical_json(v_item);
    end loop;
    return '[' || array_to_string(v_parts, ',') || ']';
  elsif v_type = 'object' then
    for v_key in select key from jsonb_object_keys(p_value) as key order by key loop
      v_parts := v_parts || (to_json(v_key)::text || ':' || private.canonical_json(p_value -> v_key));
    end loop;
    return '{' || array_to_string(v_parts, ',') || '}';
  end if;
  raise exception 'Unsupported JSON value';
end;
$$;

revoke all on function private.canonical_json(jsonb) from public, anon, authenticated;

create or replace function private.signatures_match(p_left text, p_right text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_index integer;
  v_diff integer := 0;
begin
  if p_left is null or p_right is null or length(p_left) <> length(p_right) or length(p_left) = 0 then
    return false;
  end if;
  for v_index in 1..length(p_left) loop
    v_diff := v_diff + abs(ascii(substr(p_left, v_index, 1)) - ascii(substr(p_right, v_index, 1)));
  end loop;
  return v_diff = 0;
end;
$$;

revoke all on function private.signatures_match(text, text) from public, anon, authenticated;

create or replace function private.einvoice_signature(p_key_id text, p_envelope jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_key bytea;
begin
  if p_key_id is null or p_key_id !~ '^[A-Za-z0-9_-]{1,40}$' then
    raise exception 'Unknown signing key';
  end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'einvoice_hmac_' || p_key_id;
  if v_secret is null then
    raise exception 'Unknown signing key';
  end if;
  v_key := decode(v_secret, 'base64');
  return encode(
    extensions.hmac(convert_to(private.canonical_json(p_envelope), 'utf8'), v_key, 'sha256'),
    'hex'
  );
end;
$$;

revoke all on function private.einvoice_signature(text, jsonb) from public, anon, authenticated;

create or replace function private.set_e_document_status(
  p_id uuid,
  p_to public.e_document_status,
  p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.e_documents%rowtype;
begin
  select * into v_row from public.e_documents where id = p_id for update;
  if v_row.id is null then
    raise exception 'That e-document was not found';
  end if;
  if not private.e_document_transition_allowed(v_row.direction, v_row.status, p_to) then
    raise exception 'That e-document status change is not allowed';
  end if;

  update public.e_documents
  set status = p_to,
      duplicate_of = coalesce(nullif(p_detail->>'duplicateOf', '')::uuid, duplicate_of),
      rejection_reason = case
        when p_to = 'rejected' then nullif(btrim(p_detail->>'reason'), '')
        else rejection_reason
      end,
      header_id = coalesce(nullif(p_detail->>'headerId', '')::uuid, header_id),
      validated_at = case
        when p_to in ('valid', 'invalid', 'duplicate') then coalesce(validated_at, now())
        else validated_at
      end,
      updated_at = now(),
      updated_by = (select auth.uid())
  where id = p_id;
end;
$$;

revoke all on function private.set_e_document_status(uuid, public.e_document_status, jsonb) from public, anon;
grant execute on function private.set_e_document_status(uuid, public.e_document_status, jsonb) to authenticated;

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
      and document_number is not distinct from nullif(v_summary->>'documentNumber', '')
      and (
        (
          sender_scheme is not distinct from nullif(v_summary->>'senderScheme', '')
          and lower(sender_id) is not distinct from lower(nullif(v_summary->>'senderId', ''))
          and nullif(v_summary->>'senderId', '') is not null
        )
        or (
          lower(seller_vat_number) is not distinct from lower(nullif(v_summary->>'sellerVat', ''))
          and nullif(v_summary->>'sellerVat', '') is not null
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
  if v_direction is distinct from 'inbound' then
    raise exception 'Only a received e-invoice can be rejected';
  end if;
  perform private.set_e_document_status(p_id, 'rejected', jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

revoke all on function public.reject_e_document(uuid, text) from public, anon;
grant execute on function public.reject_e_document(uuid, text) to authenticated;

create or replace function public.e_document_xml(p_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_xml text;
begin
  select content.xml into v_xml
  from public.e_document_contents as content
  join public.e_documents as document on document.id = content.e_document_id
  where content.e_document_id = p_id
    and private.is_org_member(document.organisation_id);
  return v_xml;
end;
$$;

revoke all on function public.e_document_xml(uuid) from public, anon;
grant execute on function public.e_document_xml(uuid) to authenticated;
