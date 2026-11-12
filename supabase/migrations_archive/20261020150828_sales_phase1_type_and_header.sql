create or replace function private.enforce_transaction_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  v_documents integer;
  v_layout jsonb;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A transaction type cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.description := btrim(new.description);
  new.flex1_label := nullif(btrim(new.flex1_label), '');
  new.flex2_label := nullif(btrim(new.flex2_label), '');
  new.flex3_label := nullif(btrim(new.flex3_label), '');
  new.flex4_label := nullif(btrim(new.flex4_label), '');
  new.flex5_label := nullif(btrim(new.flex5_label), '');
  new.reference_prefix := nullif(btrim(new.reference_prefix), '');

  if new.reference_prefix is not null and new.reference_prefix !~ '^[A-Za-z0-9./-]{1,10}$' then
    raise exception 'A reference prefix can use letters, digits, and - / . and must be at most 10 characters';
  end if;
  if new.reference_padding is null or new.reference_padding < 0 or new.reference_padding > 10 then
    raise exception 'Reference padding must be from 0 to 10';
  end if;

  if new.type = 'Sales' then
    new.numbering := 'on_post';
  end if;

  if tg_op = 'UPDATE'
     and (new.numbering is distinct from old.numbering
       or new.type is distinct from old.type
       or new.document_kind is distinct from old.document_kind) then
    select count(*) into v_documents
    from public.transaction_headers
    where transaction_type_id = new.id;

    if v_documents > 0 and new.numbering is distinct from old.numbering then
      raise exception 'Numbering cannot change after a document has been entered';
    end if;
    if v_documents > 0 and new.type is distinct from old.type then
      raise exception 'The transaction type cannot change after a document has been entered';
    end if;
    if v_documents > 0 and new.document_kind is distinct from old.document_kind then
      raise exception 'The document kind cannot change after a document has been entered';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.type = 'Sales'
     and (
       old.type is distinct from 'Sales'
       or (new.document_kind = 'credit_note' and old.document_kind is distinct from 'credit_note')
     ) then
    select layout into v_layout
    from public.transaction_forms
    where transaction_type_id = new.id;
    if v_layout is not null then
      perform private.validate_form_layout(v_layout, 'Sales', new.document_kind::text);
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.last_reference := 0;
  elsif new.last_reference is distinct from old.last_reference
    and new.last_reference is distinct from old.last_reference + 1 then
    new.last_reference := old.last_reference;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_type() from public, anon, authenticated;
