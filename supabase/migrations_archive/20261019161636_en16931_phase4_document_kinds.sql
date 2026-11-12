-- EN 16931 phase 4: document kinds, the invoice a credit note applies to, and units.
-- Orders keep header totals. Later VAT reporting leaves them out, and they are never exported.
-- Sales documents stay blocked. A credit note of either direction still needs a preceding reference.

create type public.document_kind as enum ('invoice', 'credit_note', 'order');

comment on type public.document_kind is
  'invoice is EN 16931 BT-3 380 and credit_note is 381. order is not exported and is left out of later VAT reporting.';

alter table public.transaction_types
  add column document_kind public.document_kind not null default 'invoice';

comment on column public.transaction_types.document_kind is
  'Invoice, credit note, or order. Locked once a document of this type exists. Drives EN 16931 BT-3.';

update public.transaction_types
set document_kind = 'order'
where description ilike '%order%'
   or code ilike '%order%';

do $$
declare
  v_row record;
  v_any boolean := false;
begin
  for v_row in
    select code, description
    from public.transaction_types
    where code ilike '%return%'
       or description ilike '%return%'
       or code ilike '%credit%'
       or description ilike '%credit%'
    order by code
  loop
    v_any := true;
    raise notice 'Review document kind for %: %', v_row.code, v_row.description;
  end loop;
  if not v_any then
    raise notice 'No return or credit transaction types to review.';
  end if;
end;
$$;

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

alter table public.transaction_headers
  add column preceding_header_id uuid,
  add column preceding_reference text,
  add column preceding_date date,
  add constraint transaction_headers_preceding_reference_check check (
    preceding_reference is null or char_length(preceding_reference) between 1 and 60
  ),
  add constraint transaction_headers_preceding_header_id_fkey
    foreign key (organisation_id, preceding_header_id)
    references public.transaction_headers (organisation_id, id)
    on delete restrict;

comment on column public.transaction_headers.preceding_header_id is
  'EN 16931 BG-3 preceding invoice, when the credit note points at a stored invoice';
comment on column public.transaction_headers.preceding_reference is
  'EN 16931 BT-25 preceding invoice reference';
comment on column public.transaction_headers.preceding_date is
  'EN 16931 BT-26 preceding invoice issue date';

create or replace function private.enforce_preceding_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.document_kind;
  v_direction text;
  v_target_status public.document_status;
  v_target_kind public.document_kind;
  v_target_direction text;
  v_target_supplier uuid;
  v_target_customer uuid;
  v_target_reference integer;
  v_target_date date;
  v_found boolean;
begin
  if tg_op = 'UPDATE' and old.status in ('posted', 'void') then
    return new;
  end if;

  new.preceding_reference := nullif(btrim(new.preceding_reference), '');
  if new.preceding_reference is not null and char_length(new.preceding_reference) > 60 then
    raise exception 'The credited invoice reference can be up to 60 characters';
  end if;

  if new.preceding_header_id is not null then
    if new.preceding_header_id = new.id then
      raise exception 'A document cannot credit itself';
    end if;

    select
      header.status,
      header.supplier_id,
      header.customer_id,
      header.reference,
      header.transaction_date,
      kind.document_kind,
      kind.type
    into
      v_target_status,
      v_target_supplier,
      v_target_customer,
      v_target_reference,
      v_target_date,
      v_target_kind,
      v_target_direction
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    where header.id = new.preceding_header_id
      and header.organisation_id = new.organisation_id;

    v_found := found;

    if v_found then
      if v_target_status is distinct from 'posted' or v_target_kind is distinct from 'invoice' then
        raise exception 'The credited document must be a posted invoice';
      end if;

      select document_kind, type into v_kind, v_direction
      from public.transaction_types
      where id = new.transaction_type_id;

      if v_target_direction is distinct from v_direction then
        raise exception 'Choose a posted invoice from this organisation';
      end if;

      if v_direction = 'Purchases' and v_target_supplier is distinct from new.supplier_id then
        raise exception 'The credited document must be for the same supplier';
      end if;

      if v_direction = 'Sales' and v_target_customer is distinct from new.customer_id then
        raise exception 'The credited document must be for the same customer';
      end if;

      if new.preceding_reference is null and v_target_reference is not null then
        new.preceding_reference := v_target_reference::text;
      end if;
      if new.preceding_date is null then
        new.preceding_date := v_target_date;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.status is distinct from 'posted'
     and new.status = 'posted' then
    select document_kind into v_kind
    from public.transaction_types
    where id = new.transaction_type_id;

    if v_kind = 'credit_note' and new.preceding_reference is null then
      raise exception 'Enter the invoice this credit note applies to';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_preceding_invoice() from public, anon, authenticated;

create trigger transaction_headers_preceding
  before insert or update on public.transaction_headers
  for each row execute function private.enforce_preceding_invoice();

alter table public.products
  add column unit_code text not null default 'C62',
  add constraint products_unit_code_fkey
    foreign key (unit_code) references public.ref_units (code);

comment on column public.products.unit_code is
  'EN 16931 BT-130 invoiced quantity unit of measure. Defaults to C62, one';

create or replace function private.enforce_product_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.unit_code := upper(btrim(coalesce(new.unit_code, '')));
  if new.unit_code = '' then
    new.unit_code := 'C62';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_product_unit() from public, anon, authenticated;

create trigger products_unit
  before insert or update on public.products
  for each row execute function private.enforce_product_unit();

alter table public.transaction_lines
  add column unit_code text not null default 'C62',
  add column line_note text,
  add column seller_item_id text,
  add constraint transaction_lines_unit_code_fkey
    foreign key (unit_code) references public.ref_units (code),
  add constraint transaction_lines_line_note_check check (
    line_note is null or char_length(line_note) between 1 and 400
  ),
  add constraint transaction_lines_seller_item_id_check check (
    seller_item_id is null or char_length(seller_item_id) between 1 and 60
  );

comment on column public.transaction_lines.unit_code is
  'EN 16931 BT-130 invoiced quantity unit of measure. Defaults to C62, one';
comment on column public.transaction_lines.line_note is
  'EN 16931 BT-127 invoice line note';
comment on column public.transaction_lines.seller_item_id is
  'EN 16931 BT-155 seller item identifier. Purchases only';

create or replace function private.enforce_line_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direction text;
begin
  new.unit_code := upper(btrim(coalesce(new.unit_code, '')));
  if new.unit_code = '' then
    new.unit_code := 'C62';
  end if;

  new.line_note := nullif(btrim(new.line_note), '');
  if new.line_note is not null and char_length(new.line_note) > 400 then
    raise exception 'A line note can be up to 400 characters';
  end if;

  new.seller_item_id := nullif(btrim(new.seller_item_id), '');
  if new.seller_item_id is not null and char_length(new.seller_item_id) > 60 then
    raise exception 'A seller item identifier can be up to 60 characters';
  end if;

  if new.seller_item_id is not null then
    select type into v_direction
    from public.transaction_types
    where id = new.transaction_type_id;

    if v_direction = 'Sales' then
      raise exception 'A seller item identifier is only stored on a purchase';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_line_unit() from public, anon, authenticated;

create trigger transaction_lines_units
  before insert or update on public.transaction_lines
  for each row execute function private.enforce_line_unit();

create or replace function public.save_purchase_invoice(p_document jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_header_id uuid;
  v_header_org uuid;
  v_supplier_name text;
  v_line jsonb;
  v_line_number integer := 0;
  v_status public.document_status;
begin
  select organisation_id, tenant_id into v_org, v_tenant
  from public.transaction_types
  where id = nullif(p_document->>'transactionTypeId', '')::uuid
    and type = 'Purchases';

  if v_org is null then
    raise exception 'Choose a Purchases transaction type';
  end if;

  select name into v_supplier_name
  from public.suppliers
  where id = nullif(p_document->>'supplierId', '')::uuid
    and organisation_id = v_org;

  if v_supplier_name is null then
    raise exception 'Choose a supplier';
  end if;

  if nullif(btrim(p_document->>'supplierName'), '') is not null then
    v_supplier_name := btrim(p_document->>'supplierName');
  end if;

  v_header_id := nullif(p_document->>'id', '')::uuid;

  if v_header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, supplier_name, contact_details, notes,
      currency_id, exchange_rate, order_number, paid_amount, rounding_amount,
      supplier_reference, supply_date,
      preceding_header_id, preceding_reference, preceding_date,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      v_tenant,
      v_org,
      (p_document->>'transactionTypeId')::uuid,
      0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      (p_document->>'supplierId')::uuid,
      v_supplier_name,
      p_document->>'contactDetails',
      p_document->>'notes',
      (p_document->>'currencyId')::uuid,
      (p_document->>'exchangeRate')::numeric,
      p_document->>'orderNumber',
      coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
      p_document->>'supplierReference',
      nullif(p_document->>'supplyDate', '')::date,
      nullif(p_document->>'precedingHeaderId', '')::uuid,
      nullif(p_document->>'precedingReference', ''),
      nullif(p_document->>'precedingDate', '')::date,
      p_document->>'flex1',
      p_document->>'flex2',
      p_document->>'flex3',
      p_document->>'flex4',
      p_document->>'flex5'
    )
    returning id into v_header_id;
  else
    select organisation_id, status into v_header_org, v_status
    from public.transaction_headers
    where id = v_header_id;

    if v_header_org is null then
      raise exception 'That invoice could not be updated';
    end if;
    if v_status is distinct from 'draft' then
      raise exception 'Only a draft document can be changed';
    end if;
    if v_header_org is distinct from v_org then
      raise exception 'That invoice belongs to another organisation';
    end if;
    if not exists (
      select 1
      from public.organisation_access
      where organisation_id = v_header_org
        and user_id = (select auth.uid())
    ) then
      raise exception 'You are not a member of this organisation';
    end if;

    update public.transaction_headers
    set transaction_date = (p_document->>'transactionDate')::date,
        due_date = nullif(p_document->>'dueDate', '')::date,
        supplier_id = (p_document->>'supplierId')::uuid,
        supplier_name = v_supplier_name,
        contact_details = p_document->>'contactDetails',
        notes = p_document->>'notes',
        currency_id = (p_document->>'currencyId')::uuid,
        exchange_rate = (p_document->>'exchangeRate')::numeric,
        order_number = p_document->>'orderNumber',
        paid_amount = coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
        rounding_amount = coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
        supplier_reference = p_document->>'supplierReference',
        supply_date = nullif(p_document->>'supplyDate', '')::date,
        preceding_header_id = nullif(p_document->>'precedingHeaderId', '')::uuid,
        preceding_reference = nullif(p_document->>'precedingReference', ''),
        preceding_date = nullif(p_document->>'precedingDate', '')::date,
        flex1 = p_document->>'flex1',
        flex2 = p_document->>'flex2',
        flex3 = p_document->>'flex3',
        flex4 = p_document->>'flex4',
        flex5 = p_document->>'flex5'
    where id = v_header_id
      and organisation_id = v_org;

    if not found then
      raise exception 'That invoice could not be updated';
    end if;

    delete from public.transaction_lines
    where header_id = v_header_id;
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_document->'lines', '[]'::jsonb))
  loop
    v_line_number := v_line_number + 1;
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
      quantity, price, discount_amount, nett_amount, vat_amount,
      unit_code, line_note, seller_item_id
    ) values (
      v_tenant,
      v_org,
      v_header_id,
      (p_document->>'transactionTypeId')::uuid,
      0,
      v_line_number,
      nullif(v_line->>'productId', '')::uuid,
      coalesce(v_line->>'description', ''),
      nullif(v_line->>'glCodeId', '')::uuid,
      nullif(v_line->>'departmentId', '')::uuid,
      nullif(v_line->>'costCentreId', '')::uuid,
      nullif(v_line->>'vatRateId', '')::uuid,
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      coalesce(nullif(v_line->>'price', '')::numeric, 0),
      coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0),
      0,
      0,
      nullif(v_line->>'unitCode', ''),
      nullif(v_line->>'lineNote', ''),
      nullif(v_line->>'sellerItemId', '')
    );
  end loop;

  return v_header_id;
end;
$$;

revoke all on function public.save_purchase_invoice(jsonb) from public, anon;
grant execute on function public.save_purchase_invoice(jsonb) to authenticated;
