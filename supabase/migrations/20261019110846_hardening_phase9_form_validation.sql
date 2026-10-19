-- Phase 9: a saved form layout is checked in the database.

create or replace function private.validate_form_layout(p_layout jsonb, p_type text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_item jsonb;
  v_seen text[] := array[]::text[];
  v_value text;
  v_allowed text[];
begin
  if jsonb_typeof(p_layout) is distinct from 'object' or char_length(p_layout::text) > 8000 then
    raise exception 'Form layout must be an object';
  end if;

  for v_key in select jsonb_object_keys(p_layout)
  loop
    if v_key not in (
      'version', 'title', 'pageSize', 'showLogo', 'showVatSummary', 'showBanking',
      'organisationFields', 'partyFields', 'headerFields', 'lineColumns'
    ) then
      raise exception 'Form layout has an unknown setting: %', v_key;
    end if;
  end loop;

  if (p_layout->>'version') is distinct from '1' then
    raise exception 'Form layout version must be 1';
  end if;
  if jsonb_typeof(p_layout->'title') is distinct from 'string'
     or char_length(btrim(p_layout->>'title')) < 1
     or char_length(btrim(p_layout->>'title')) > 80 then
    raise exception 'Form title must be 1 to 80 characters';
  end if;
  if p_layout ? 'pageSize'
     and (p_layout->>'pageSize') not in ('A4', 'A5', 'Letter', 'Legal') then
    raise exception 'Page size must be A4, A5, Letter, or Legal';
  end if;

  foreach v_key in array array['showLogo', 'showVatSummary', 'showBanking']
  loop
    if p_layout ? v_key and jsonb_typeof(p_layout->v_key) is distinct from 'boolean' then
      raise exception 'Form layout settings must be true or false';
    end if;
  end loop;

  foreach v_key in array array['organisationFields', 'partyFields', 'headerFields', 'lineColumns']
  loop
    if jsonb_typeof(p_layout->v_key) is distinct from 'array' then
      raise exception 'Form layout lists must be arrays';
    end if;
    v_seen := array[]::text[];
    v_allowed := case v_key
      when 'organisationFields' then array['name','address','phone','contactEmail','website','contactName','vatNumber','companyNumber']
      when 'partyFields' then array['contactDetails','name','address','phone','email','website','code']
      when 'headerFields' then array['reference','transactionDate','terms','dueDate','orderNumber','currency','exchangeRate','paidAmount','flex1','flex2','flex3','flex4','flex5','supplierReference','supplyDate']
      else array['date','item','description','tax','quantity','price','amount','discount','glCode','vatCode','department','costCentre']
    end;
    for v_item in select value from jsonb_array_elements(p_layout->v_key)
    loop
      if jsonb_typeof(v_item) is distinct from 'string' then
        raise exception 'Form layout lists must contain field names';
      end if;
      v_value := v_item #>> '{}';
      if v_value = any (v_seen) then
        raise exception 'Form layout repeats the field %', v_value;
      end if;
      if not (v_value = any (v_allowed)) then
        raise exception 'Form layout has an unknown field: %', v_value;
      end if;
      v_seen := v_seen || v_value;
    end loop;
  end loop;

  if p_type = 'Sales' then
    if not (
      p_layout->'organisationFields' ? 'name'
      and p_layout->'organisationFields' ? 'address'
      and p_layout->'organisationFields' ? 'vatNumber'
    ) then
      raise exception 'A sales form must show the organisation name, address, and VAT number';
    end if;
    if not (
      p_layout->'partyFields' ? 'name'
      and p_layout->'partyFields' ? 'address'
    ) then
      raise exception 'A sales form must show the customer name and address';
    end if;
    if not (
      p_layout->'headerFields' ? 'reference'
      and p_layout->'headerFields' ? 'transactionDate'
    ) then
      raise exception 'A sales form must show the document number and date';
    end if;
    if not (
      p_layout->'lineColumns' ? 'description'
      and p_layout->'lineColumns' ? 'quantity'
      and p_layout->'lineColumns' ? 'price'
      and p_layout->'lineColumns' ? 'tax'
      and p_layout->'lineColumns' ? 'amount'
    ) then
      raise exception 'A sales form must show the description, quantity, price, tax, and amount';
    end if;
    if (p_layout->>'showVatSummary') is distinct from 'true' then
      raise exception 'A sales form must show the VAT summary';
    end if;
  end if;
end;
$$;

revoke all on function private.validate_form_layout(jsonb, text) from public, anon, authenticated;

create or replace function private.enforce_transaction_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_flex text[];
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A form cannot be moved to another transaction type';
  end if;

  select type, array[flex1_label, flex2_label, flex3_label, flex4_label, flex5_label]
    into v_type, v_flex
  from public.transaction_types
  where id = new.transaction_type_id;

  if v_type is null then
    raise exception 'Transaction type must belong to this organisation';
  end if;

  perform private.validate_form_layout(new.layout, v_type);

  if new.layout->'headerFields' ? 'flex1' and v_flex[1] is null
     or new.layout->'headerFields' ? 'flex2' and v_flex[2] is null
     or new.layout->'headerFields' ? 'flex3' and v_flex[3] is null
     or new.layout->'headerFields' ? 'flex4' and v_flex[4] is null
     or new.layout->'headerFields' ? 'flex5' and v_flex[5] is null then
    raise exception 'A flex field is on the form, but this transaction type has no label for it';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_form() from public, anon, authenticated;

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

  if new.type = 'Sales' then
    new.numbering := 'on_post';
  end if;

  if tg_op = 'UPDATE'
     and (new.numbering is distinct from old.numbering or new.type is distinct from old.type) then
    select count(*) into v_documents
    from public.transaction_headers
    where transaction_type_id = new.id;

    if v_documents > 0 and new.numbering is distinct from old.numbering then
      raise exception 'Numbering cannot change after a document has been entered';
    end if;
    if v_documents > 0 and new.type is distinct from old.type then
      raise exception 'The transaction type cannot change after a document has been entered';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.type = 'Sales' and old.type is distinct from 'Sales' then
    select layout into v_layout
    from public.transaction_forms
    where transaction_type_id = new.id;
    if v_layout is not null then
      perform private.validate_form_layout(v_layout, 'Sales');
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
