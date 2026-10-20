-- Sales phase 1: party name, sales invoices and credit notes, and formatted document numbers.
-- Sales orders stay refused. A document number is fixed when the reference is issued.

alter table public.transaction_types
  add column reference_prefix text,
  add column reference_padding integer not null default 0,
  add constraint transaction_types_reference_prefix_check check (
    reference_prefix is null or reference_prefix ~ '^[A-Za-z0-9./-]{1,10}$'
  ),
  add constraint transaction_types_reference_padding_check check (reference_padding between 0 and 10);

comment on column public.transaction_types.reference_prefix is
  'Optional text placed before the document number. Later changes do not rewrite issued numbers.';
comment on column public.transaction_types.reference_padding is
  'Zero-pad width for the document number. 0 leaves the reference unpadded. Later changes do not rewrite issued numbers.';

alter table public.transaction_headers rename column supplier_name to party_name;
alter table public.transaction_headers
  rename constraint transaction_headers_supplier_name_check to transaction_headers_party_name_check;

comment on column public.transaction_headers.party_name is
  'Name stored on the document. Copied from the supplier or customer, and kept if the payload overrides it.';

alter table public.transaction_headers
  add column document_number text,
  add constraint transaction_headers_document_number_check check (
    document_number is null or char_length(document_number) between 1 and 30
  );

comment on column public.transaction_headers.document_number is
  'Printed document number, fixed when the reference is issued.';

create unique index transaction_headers_document_number_idx
  on public.transaction_headers (organisation_id, transaction_type_id, document_number)
  where document_number is not null;

create or replace function private.format_document_number(p_prefix text, p_padding integer, p_reference integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_prefix, '') || lpad(
    p_reference::text,
    greatest(p_padding, char_length(p_reference::text)),
    '0'
  );
$$;

comment on function private.format_document_number(text, integer, integer) is
  'Prefix plus zero padding. Padding 0 keeps the reference as written, because lpad to width 0 would erase it.';

revoke all on function private.format_document_number(text, integer, integer) from public, anon, authenticated;

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

create or replace function private.enforce_transaction_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  type_kind text;
  v_numbering public.numbering_rule;
  v_kind text;
  v_prefix text;
  v_padding integer;
  v_party_currency uuid;
  nett numeric(16, 4);
  vat numeric(16, 4);
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A transaction cannot be moved or renumbered';
  end if;

  if tg_op = 'UPDATE' and new.reference is distinct from old.reference then
    if old.reference is not null
       or current_setting('fintran.status_change', true) is distinct from 'on' then
      raise exception 'A transaction cannot be moved or renumbered';
    end if;
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  select type, numbering, document_kind::text
    into type_kind, v_numbering, v_kind
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_kind = 'Sales' and v_kind = 'order' then
    raise exception 'Sales orders are not stored yet';
  end if;

  if type_kind = 'Sales' then
    if new.customer_id is null then
      raise exception 'Choose a customer';
    end if;
    if new.supplier_id is not null then
      raise exception 'A sales document cannot have a supplier';
    end if;
  elsif type_kind = 'Purchases' then
    if new.supplier_id is null then
      raise exception 'Choose a supplier';
    end if;
    if new.customer_id is not null then
      raise exception 'A purchase document cannot have a customer';
    end if;
  else
    raise exception 'Choose a Purchases transaction type';
  end if;

  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;

  new.party_name := btrim(new.party_name);
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  new.order_number := nullif(btrim(new.order_number), '');
  new.supplier_reference := nullif(btrim(new.supplier_reference), '');
  new.flex1 := nullif(btrim(new.flex1), '');
  new.flex2 := nullif(btrim(new.flex2), '');
  new.flex3 := nullif(btrim(new.flex3), '');
  new.flex4 := nullif(btrim(new.flex4), '');
  new.flex5 := nullif(btrim(new.flex5), '');
  if new.rounding_amount is null then
    new.rounding_amount := 0;
  end if;

  if type_kind = 'Sales' and new.supplier_reference is not null then
    raise exception 'A supplier invoice number is only stored on a purchase';
  end if;

  if type_kind = 'Sales' then
    select currency_id into v_party_currency
    from public.customers
    where id = new.customer_id
      and organisation_id = new.organisation_id;
  else
    select currency_id into v_party_currency
    from public.suppliers
    where id = new.supplier_id
      and organisation_id = new.organisation_id;
  end if;
  if v_party_currency is null or v_party_currency is distinct from new.currency_id then
    raise exception 'The document currency must match the party currency';
  end if;

  if tg_op = 'INSERT' and v_numbering is distinct from 'on_post' then
    new.reference := private.issue_reference(new.transaction_type_id);
  elsif tg_op = 'INSERT' then
    new.reference := null;
  end if;

  if tg_op = 'UPDATE' and old.document_number is not null then
    new.document_number := old.document_number;
  elsif new.reference is not null then
    select reference_prefix, reference_padding into v_prefix, v_padding
    from public.transaction_types
    where id = new.transaction_type_id;
    new.document_number := private.format_document_number(v_prefix, v_padding, new.reference);
    if char_length(new.document_number) > 30 or char_length(new.document_number) < 1 then
      raise exception 'The document number is too long';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status in ('posted', 'void') then
    new.foreign_nett_amount := old.foreign_nett_amount;
    new.foreign_vat_amount := old.foreign_vat_amount;
    new.foreign_total_amount := old.foreign_total_amount;
    new.home_nett_amount := old.home_nett_amount;
    new.home_vat_amount := old.home_vat_amount;
    new.home_total_amount := old.home_total_amount;
    new.rounding_amount := old.rounding_amount;
    new.amount_due := round(old.foreign_total_amount - coalesce(new.paid_amount, 0) + old.rounding_amount, 2);
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'posted' then
    if type_kind = 'Sales' and exists (
      select 1 from public.transaction_lines
      where header_id = new.id and vat_rate_id is null
    ) then
      raise exception 'Enter a VAT code on every line';
    end if;
    if exists (
      select 1
      from public.transaction_lines
      where header_id = new.id
      group by vat_category, vat_percentage
      having count(distinct coalesce(exemption_code, '') || '|' || coalesce(exemption_reason, '')) > 1
    ) then
      raise exception 'Lines with the same VAT category and rate must use the same exemption';
    end if;
  end if;

  select coalesce(sum(grouped.taxable), 0), coalesce(sum(grouped.vat), 0)
    into nett, vat
  from (
    select
      round(sum(nett_amount), 2) as taxable,
      round(round(sum(nett_amount), 2) * vat_percentage / 100, 2) as vat
    from public.transaction_lines
    where header_id = new.id
    group by vat_category, vat_percentage
  ) as grouped;

  new.foreign_nett_amount := nett;
  new.foreign_vat_amount := vat;
  new.foreign_total_amount := nett + vat;
  new.home_nett_amount := round(nett / new.exchange_rate, 2);
  new.home_vat_amount := round(vat / new.exchange_rate, 2);
  new.home_total_amount := round((nett + vat) / new.exchange_rate, 2);
  new.amount_due := round(nett + vat - coalesce(new.paid_amount, 0) + new.rounding_amount, 2);
  return new;
end;
$$;

revoke all on function private.enforce_transaction_header() from public, anon, authenticated;

create or replace function private.enforce_transaction_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  header_org uuid;
  header_tenant uuid;
  header_type uuid;
  header_reference integer;
  vat_kind text;
  vat_rate numeric(5, 2);
  v_category text;
  v_exemption_code text;
  v_exemption_reason text;
  v_direction text;
  copy_rate boolean;
begin
  select organisation_id, tenant_id, transaction_type_id, reference
    into header_org, header_tenant, header_type, header_reference
  from public.transaction_headers
  where id = new.header_id;

  if header_org is null then
    raise exception 'Choose a transaction';
  end if;

  new.organisation_id := header_org;
  new.tenant_id := header_tenant;
  new.transaction_type_id := header_type;
  new.reference := header_reference;
  new.description := btrim(new.description);

  if new.discount_amount > new.quantity * new.price then
    raise exception 'Discount cannot be more than quantity times price';
  end if;

  new.nett_amount := round(new.quantity * new.price - new.discount_amount, 2);
  copy_rate := tg_op = 'INSERT' or new.vat_rate_id is distinct from old.vat_rate_id;

  select type into v_direction
  from public.transaction_types
  where id = new.transaction_type_id;

  if new.vat_rate_id is null then
    new.vat_percentage := 0;
    new.vat_category := 'O';
    new.exemption_code := null;
    new.exemption_reason := null;
  elsif copy_rate then
    select vat_type, rate, vat_rates.vat_category, exemption_code, exemption_reason
      into vat_kind, vat_rate, v_category, v_exemption_code, v_exemption_reason
    from public.vat_rates
    where id = new.vat_rate_id;

    if v_direction = 'Sales' and vat_kind is distinct from 'Sales' then
      raise exception 'Sales VAT code must be a Sales rate';
    end if;
    if v_direction is distinct from 'Sales' and vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;

    new.vat_percentage := vat_rate;
    new.vat_category := v_category;
    new.exemption_code := v_exemption_code;
    new.exemption_reason := v_exemption_reason;
  else
    select vat_type into vat_kind
    from public.vat_rates
    where id = new.vat_rate_id;

    if v_direction = 'Sales' and vat_kind is distinct from 'Sales' then
      raise exception 'Sales VAT code must be a Sales rate';
    end if;
    if v_direction is distinct from 'Sales' and vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;
  end if;

  new.vat_amount := round(new.nett_amount * new.vat_percentage / 100, 2);
  return new;
end;
$$;

revoke all on function private.enforce_transaction_line() from public, anon, authenticated;

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
  v_target_number text;
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
      header.document_number,
      header.transaction_date,
      kind.document_kind,
      kind.type
    into
      v_target_status,
      v_target_supplier,
      v_target_customer,
      v_target_reference,
      v_target_number,
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

      if new.preceding_reference is null then
        new.preceding_reference := coalesce(v_target_number, v_target_reference::text);
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

alter table public.transaction_headers disable trigger zz_document_status;
update public.transaction_headers
set document_number = reference::text
where reference is not null
  and document_number is null;
alter table public.transaction_headers enable trigger zz_document_status;

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
  v_party_name text;
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

  select name into v_party_name
  from public.suppliers
  where id = nullif(p_document->>'supplierId', '')::uuid
    and organisation_id = v_org;

  if v_party_name is null then
    raise exception 'Choose a supplier';
  end if;

  if nullif(btrim(p_document->>'partyName'), '') is not null then
    v_party_name := btrim(p_document->>'partyName');
  elsif nullif(btrim(p_document->>'supplierName'), '') is not null then
    v_party_name := btrim(p_document->>'supplierName');
  end if;

  v_header_id := nullif(p_document->>'id', '')::uuid;

  if v_header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, party_name, contact_details, notes,
      currency_id, exchange_rate, order_number, paid_amount, rounding_amount,
      supplier_reference, supply_date,
      preceding_header_id, preceding_reference, preceding_date,
      buyer_reference, contract_reference, payment_terms,
      invoice_period_start, invoice_period_end, payment_means_code,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      v_tenant,
      v_org,
      (p_document->>'transactionTypeId')::uuid,
      0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      (p_document->>'supplierId')::uuid,
      v_party_name,
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
      nullif(p_document->>'buyerReference', ''),
      nullif(p_document->>'contractReference', ''),
      nullif(p_document->>'paymentTerms', ''),
      nullif(p_document->>'invoicePeriodStart', '')::date,
      nullif(p_document->>'invoicePeriodEnd', '')::date,
      nullif(p_document->>'paymentMeansCode', ''),
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
        party_name = v_party_name,
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
        buyer_reference = nullif(p_document->>'buyerReference', ''),
        contract_reference = nullif(p_document->>'contractReference', ''),
        payment_terms = nullif(p_document->>'paymentTerms', ''),
        invoice_period_start = nullif(p_document->>'invoicePeriodStart', '')::date,
        invoice_period_end = nullif(p_document->>'invoicePeriodEnd', '')::date,
        payment_means_code = nullif(p_document->>'paymentMeansCode', ''),
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

create or replace function public.en16931_source(p_header_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_header public.transaction_headers%rowtype;
  v_direction text;
  v_kind text;
  v_currency text;
  v_home text;
  v_seller jsonb;
  v_buyer jsonb;
  v_org jsonb;
  v_counterparty jsonb;
  v_lines jsonb;
  v_breakdown jsonb;
  v_line_nett numeric;
  v_breakdown_vat numeric;
begin
  select * into v_header
  from public.transaction_headers
  where id = p_header_id;

  if v_header.id is null then
    return null;
  end if;

  select type, document_kind::text into v_direction, v_kind
  from public.transaction_types
  where id = v_header.transaction_type_id;

  select iso_code into v_currency
  from public.currencies
  where id = v_header.currency_id
    and organisation_id = v_header.organisation_id;

  select currencies.iso_code into v_home
  from public.organisation_defaults as defaults
  join public.currencies as currencies
    on currencies.id = defaults.home_currency_id
   and currencies.organisation_id = defaults.organisation_id
  where defaults.organisation_id = v_header.organisation_id;

  select coalesce(sum(nett_amount), 0), coalesce(jsonb_agg(jsonb_build_object(
    'line', line_number,
    'note', line_note,
    'quantity', quantity,
    'unit', unit_code,
    'nett', nett_amount,
    'price', price,
    'discount', discount_amount,
    'category', vat_category,
    'rate', vat_percentage,
    'description', description,
    'sellerItem', seller_item_id,
    'productCode', (select code from public.products where id = transaction_lines.product_id)
  ) order by line_number), '[]'::jsonb)
    into v_line_nett, v_lines
  from public.transaction_lines
  where header_id = v_header.id;

  select coalesce(sum(vat_amount), 0), coalesce(jsonb_agg(jsonb_build_object(
    'category', vat_category,
    'rate', vat_percentage,
    'taxable', taxable_amount,
    'vat', vat_amount,
    'exemptionCode', exemption_code,
    'exemptionReason', exemption_reason
  ) order by vat_category, vat_percentage), '[]'::jsonb)
    into v_breakdown_vat, v_breakdown
  from public.transaction_vat_breakdown
  where header_id = v_header.id;

  if v_header.status in ('posted', 'void') then
    v_org := jsonb_strip_nulls(jsonb_build_object(
      'name', v_header.issuer_snapshot->>'name',
      'line1', v_header.issuer_snapshot->>'addressLine1',
      'line2', v_header.issuer_snapshot->>'addressLine2',
      'line3', v_header.issuer_snapshot->>'addressLine3',
      'city', v_header.issuer_snapshot->>'city',
      'postCode', v_header.issuer_snapshot->>'postCode',
      'county', v_header.issuer_snapshot->>'county',
      'country', v_header.issuer_snapshot->>'countryCode',
      'vat', v_header.issuer_snapshot->>'vatNumber',
      'company', v_header.issuer_snapshot->>'companyNumber',
      'peppolScheme', v_header.issuer_snapshot->>'peppolScheme',
      'peppolId', v_header.issuer_snapshot->>'peppolId',
      'phone', v_header.issuer_snapshot->>'phone',
      'email', v_header.issuer_snapshot->>'contactEmail',
      'contact', v_header.issuer_snapshot->>'contactName',
      'iban', v_header.issuer_snapshot->>'iban',
      'bic', v_header.issuer_snapshot->>'bic',
      'accountName', v_header.issuer_snapshot->>'bankAccountName'
    ));
    v_counterparty := jsonb_strip_nulls(jsonb_build_object(
      'name', v_header.party_snapshot->>'name',
      'code', v_header.party_snapshot->>'code',
      'line1', v_header.party_snapshot->>'addressLine1',
      'line2', v_header.party_snapshot->>'addressLine2',
      'line3', v_header.party_snapshot->>'addressLine3',
      'city', v_header.party_snapshot->>'city',
      'postCode', v_header.party_snapshot->>'postCode',
      'county', v_header.party_snapshot->>'county',
      'country', v_header.party_snapshot->>'countryCode',
      'vat', v_header.party_snapshot->>'vatNumber',
      'company', v_header.party_snapshot->>'companyNumber',
      'peppolScheme', v_header.party_snapshot->>'peppolScheme',
      'peppolId', v_header.party_snapshot->>'peppolId',
      'phone', v_header.party_snapshot->>'phone',
      'email', v_header.party_snapshot->>'email',
      'contact', v_header.party_snapshot->>'contactDetails'
    ));
  else
    select jsonb_strip_nulls(jsonb_build_object(
      'name', organisation.name,
      'line1', defaults.address_line1,
      'line2', defaults.address_line2,
      'line3', defaults.address_line3,
      'city', defaults.city,
      'postCode', defaults.post_code,
      'county', defaults.county,
      'country', defaults.country_code,
      'vat', defaults.vat_number,
      'company', defaults.company_number,
      'peppolScheme', defaults.peppol_scheme,
      'peppolId', defaults.peppol_id,
      'phone', defaults.phone,
      'email', defaults.contact_email,
      'contact', defaults.contact_name,
      'iban', defaults.iban,
      'bic', defaults.bic,
      'accountName', defaults.bank_account_name,
      'needsReview', defaults.address_needs_review
    )) into v_org
    from public.organisations as organisation
    join public.organisation_defaults as defaults
      on defaults.organisation_id = organisation.id
    where organisation.id = v_header.organisation_id;

    if v_direction = 'Sales' then
      select jsonb_strip_nulls(jsonb_build_object(
        'name', customers.name,
        'code', customers.code,
        'line1', customers.address_line1,
        'line2', customers.address_line2,
        'line3', customers.address_line3,
        'city', customers.city,
        'postCode', customers.post_code,
        'county', customers.county,
        'country', customers.country_code,
        'vat', customers.vat_number,
        'company', customers.company_number,
        'peppolScheme', customers.peppol_scheme,
        'peppolId', customers.peppol_id,
        'phone', customers.phone,
        'email', customers.email,
        'contact', customers.contact_details,
        'needsReview', customers.address_needs_review
      )) into v_counterparty
      from public.customers
      where id = v_header.customer_id
        and organisation_id = v_header.organisation_id;
    else
      select jsonb_strip_nulls(jsonb_build_object(
        'name', suppliers.name,
        'code', suppliers.code,
        'line1', suppliers.address_line1,
        'line2', suppliers.address_line2,
        'line3', suppliers.address_line3,
        'city', suppliers.city,
        'postCode', suppliers.post_code,
        'county', suppliers.county,
        'country', suppliers.country_code,
        'vat', suppliers.vat_number,
        'company', suppliers.company_number,
        'peppolScheme', suppliers.peppol_scheme,
        'peppolId', suppliers.peppol_id,
        'phone', suppliers.phone,
        'email', suppliers.email,
        'contact', suppliers.contact_details,
        'needsReview', suppliers.address_needs_review
      )) into v_counterparty
      from public.suppliers
      where id = v_header.supplier_id
        and organisation_id = v_header.organisation_id;
    end if;
  end if;

  if v_direction = 'Sales' then
    v_seller := v_org;
    v_buyer := v_counterparty;
  else
    v_seller := v_counterparty;
    v_buyer := v_org;
  end if;

  return jsonb_build_object(
    'direction', v_direction,
    'kind', v_kind,
    'status', v_header.status,
    'invoiceNumber', case
      when v_direction = 'Sales' then nullif(btrim(v_header.document_number), '')
      else nullif(btrim(v_header.supplier_reference), '')
    end,
    'issueDate', v_header.transaction_date,
    'currency', v_currency,
    'homeCurrency', v_home,
    'dueDate', v_header.due_date,
    'buyerReference', nullif(btrim(v_header.buyer_reference), ''),
    'contractReference', nullif(btrim(v_header.contract_reference), ''),
    'orderNumber', nullif(btrim(v_header.order_number), ''),
    'paymentTerms', nullif(btrim(v_header.payment_terms), ''),
    'notes', nullif(btrim(v_header.notes), ''),
    'supplyDate', v_header.supply_date,
    'periodStart', v_header.invoice_period_start,
    'periodEnd', v_header.invoice_period_end,
    'precedingReference', nullif(btrim(v_header.preceding_reference), ''),
    'precedingDate', v_header.preceding_date,
    'paymentMeans', nullif(btrim(v_header.payment_means_code), ''),
    'nett', v_header.foreign_nett_amount,
    'vat', v_header.foreign_vat_amount,
    'total', v_header.foreign_total_amount,
    'homeVat', v_header.home_vat_amount,
    'paid', v_header.paid_amount,
    'rounding', v_header.rounding_amount,
    'due', v_header.amount_due,
    'lineNettSum', v_line_nett,
    'breakdownVatSum', v_breakdown_vat,
    'seller', coalesce(v_seller, '{}'::jsonb),
    'buyer', coalesce(v_buyer, '{}'::jsonb),
    'lines', v_lines,
    'breakdown', v_breakdown
  );
end;
$$;


create or replace function private.validate_form_layout(p_layout jsonb, p_type text, p_kind text default null)
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
      when 'organisationFields' then array[
        'name','address','phone','contactEmail','website','contactName','vatNumber','companyNumber','peppolId','country'
      ]
      when 'partyFields' then array[
        'contactDetails','name','address','phone','email','website','code','peppolId','country','vatNumber'
      ]
      when 'headerFields' then array[
        'reference','documentNumber','transactionDate','terms','dueDate','orderNumber','currency','exchangeRate','paidAmount',
        'flex1','flex2','flex3','flex4','flex5','supplierReference','supplyDate',
        'buyerReference','contractReference','paymentTerms','invoicePeriod','precedingReference'
      ]
      else array[
        'date','item','description','tax','quantity','price','amount','discount','glCode','vatCode','department','costCentre',
        'unit','lineNote'
      ]
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
      (p_layout->'headerFields' ? 'documentNumber' or p_layout->'headerFields' ? 'reference')
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
    if p_kind = 'credit_note' and not (p_layout->'headerFields' ? 'precedingReference') then
      raise exception 'A sales credit note form must show the preceding invoice reference';
    end if;
  end if;
end;
$$;

