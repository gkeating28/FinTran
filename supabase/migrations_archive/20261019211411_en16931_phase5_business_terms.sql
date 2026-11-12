-- EN 16931 phase 5: header business terms, party defaults, posting snapshots, and form fields.
-- Sales documents stay blocked. Sales-only rules are proved in a rolled-back test.
-- Existing posted snapshots are left as they were.

alter table public.transaction_headers
  add column buyer_reference text,
  add column contract_reference text,
  add column payment_terms text,
  add column invoice_period_start date,
  add column invoice_period_end date,
  add column payment_means_code text,
  add constraint transaction_headers_buyer_reference_check check (
    buyer_reference is null or char_length(buyer_reference) between 1 and 100
  ),
  add constraint transaction_headers_contract_reference_check check (
    contract_reference is null or char_length(contract_reference) between 1 and 60
  ),
  add constraint transaction_headers_payment_terms_check check (
    payment_terms is null or char_length(payment_terms) between 1 and 400
  ),
  add constraint transaction_headers_invoice_period_check check (
    (invoice_period_start is null and invoice_period_end is null)
    or (
      invoice_period_start is not null
      and invoice_period_end is not null
      and invoice_period_end >= invoice_period_start
    )
  ),
  add constraint transaction_headers_payment_means_code_fkey
    foreign key (payment_means_code) references public.ref_payment_means (code);

comment on column public.transaction_headers.buyer_reference is 'EN 16931 BT-10 Buyer reference';
comment on column public.transaction_headers.contract_reference is 'EN 16931 BT-12 Contract reference';
comment on column public.transaction_headers.payment_terms is 'EN 16931 BT-20 Payment terms';
comment on column public.transaction_headers.invoice_period_start is 'EN 16931 BG-14 invoicing period start, BT-73';
comment on column public.transaction_headers.invoice_period_end is 'EN 16931 BG-14 invoicing period end, BT-74';
comment on column public.transaction_headers.payment_means_code is 'EN 16931 BT-81 Payment means type code';

alter table public.customers
  add column payment_terms_days integer,
  add column default_buyer_reference text,
  add constraint customers_payment_terms_days_check check (
    payment_terms_days is null or payment_terms_days between 0 and 365
  ),
  add constraint customers_default_buyer_reference_check check (
    default_buyer_reference is null or char_length(default_buyer_reference) between 1 and 100
  );

alter table public.suppliers
  add column payment_terms_days integer,
  add constraint suppliers_payment_terms_days_check check (
    payment_terms_days is null or payment_terms_days between 0 and 365
  );

comment on column public.customers.payment_terms_days is 'Days used to prefill a sales draft due date and payment terms';
comment on column public.customers.default_buyer_reference is 'EN 16931 BT-10 prefilled on a new sales draft';
comment on column public.suppliers.payment_terms_days is 'Days stored for the supplier. Purchase drafts are not prefilled from it';

create or replace function private.enforce_business_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('posted', 'void') then
    return new;
  end if;

  new.buyer_reference := nullif(btrim(new.buyer_reference), '');
  new.contract_reference := nullif(btrim(new.contract_reference), '');
  new.payment_terms := nullif(btrim(new.payment_terms), '');
  new.payment_means_code := nullif(upper(btrim(new.payment_means_code)), '');

  if new.buyer_reference is not null and char_length(new.buyer_reference) > 100 then
    raise exception 'Buyer reference can be up to 100 characters';
  end if;
  if new.contract_reference is not null and char_length(new.contract_reference) > 60 then
    raise exception 'Contract reference can be up to 60 characters';
  end if;
  if new.payment_terms is not null and char_length(new.payment_terms) > 400 then
    raise exception 'Payment terms can be up to 400 characters';
  end if;
  if (new.invoice_period_start is null) <> (new.invoice_period_end is null) then
    raise exception 'Enter both the invoice period start and end, or leave both blank';
  end if;
  if new.invoice_period_end < new.invoice_period_start then
    raise exception 'The invoice period end cannot be before the start';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_business_terms() from public, anon, authenticated;

create trigger transaction_headers_business
  before insert or update on public.transaction_headers
  for each row execute function private.enforce_business_terms();

create or replace function private.apply_sales_document_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direction text;
  v_days integer;
  v_buyer text;
begin
  select type into v_direction
  from public.transaction_types
  where id = new.transaction_type_id;

  if v_direction is distinct from 'Sales' or new.customer_id is null then
    return new;
  end if;

  select payment_terms_days, default_buyer_reference
    into v_days, v_buyer
  from public.customers
  where id = new.customer_id
    and organisation_id = new.organisation_id;

  if new.buyer_reference is null then
    new.buyer_reference := v_buyer;
  end if;
  if v_days is not null and new.due_date is null then
    new.due_date := new.transaction_date + v_days;
  end if;
  if v_days is not null and new.payment_terms is null then
    new.payment_terms := case
      when v_days = 0 then 'Due on receipt'
      when v_days = 1 then 'Payment due within 1 day'
      else 'Payment due within ' || v_days::text || ' days'
    end;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_sales_document_defaults() from public, anon, authenticated;

create trigger transaction_headers_sales_defaults
  before insert on public.transaction_headers
  for each row execute function private.apply_sales_document_defaults();

create or replace function public.post_document(p_header_id uuid, p_logo_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_supplier uuid;
  v_type uuid;
  v_reference integer;
  v_numbering public.numbering_rule;
  v_direction text;
  v_lines integer;
  v_issuer jsonb;
  v_party jsonb;
  v_iban text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date, supplier_id, transaction_type_id, reference
    into v_org, v_status, v_date, v_supplier, v_type, v_reference
  from public.transaction_headers
  where id = p_header_id
  for update;

  if v_org is null then
    raise exception 'That document could not be posted';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft document can be posted';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;
  if p_logo_path is not null
     and p_logo_path is distinct from v_org::text || '/snapshots/' || p_header_id::text then
    raise exception 'The posted logo path is not valid';
  end if;

  select count(*) into v_lines
  from public.transaction_lines
  where header_id = p_header_id;

  if v_lines < 1 then
    raise exception 'Add a line before posting';
  end if;

  select numbering, type into v_numbering, v_direction
  from public.transaction_types
  where id = v_type;

  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  select defaults.iban into v_iban
  from public.organisation_defaults as defaults
  where defaults.organisation_id = v_org;

  if v_direction = 'Sales' and v_iban is not null then
    update public.transaction_headers
    set payment_means_code = '58'
    where id = p_header_id
      and payment_means_code is null;
  end if;

  select jsonb_build_object(
    'name', organisation.name,
    'address', private.postal_address_text(
      defaults.address_line1, defaults.address_line2, defaults.address_line3,
      defaults.city, defaults.post_code, defaults.county, seller_country.name
    ),
    'addressLine1', defaults.address_line1,
    'addressLine2', defaults.address_line2,
    'addressLine3', defaults.address_line3,
    'city', defaults.city,
    'postCode', defaults.post_code,
    'county', defaults.county,
    'countryCode', defaults.country_code,
    'countryName', seller_country.name,
    'contactName', defaults.contact_name,
    'contactEmail', defaults.contact_email,
    'website', defaults.website,
    'phone', defaults.phone,
    'vatNumber', defaults.vat_number,
    'companyNumber', defaults.company_number,
    'peppolScheme', defaults.peppol_scheme,
    'peppolId', defaults.peppol_id,
    'iban', defaults.iban,
    'bic', defaults.bic,
    'bankAccountName', defaults.bank_account_name,
    'bankingDetails', defaults.banking_details,
    'logoPath', p_logo_path
  )
  into v_issuer
  from public.organisations as organisation
  left join public.organisation_defaults as defaults
    on defaults.organisation_id = organisation.id
  left join public.ref_countries as seller_country
    on seller_country.code = defaults.country_code
  where organisation.id = v_org;

  select jsonb_build_object(
    'code', supplier.code,
    'name', supplier.name,
    'address', private.postal_address_text(
      supplier.address_line1, supplier.address_line2, supplier.address_line3,
      supplier.city, supplier.post_code, supplier.county, party_country.name
    ),
    'addressLine1', supplier.address_line1,
    'addressLine2', supplier.address_line2,
    'addressLine3', supplier.address_line3,
    'city', supplier.city,
    'postCode', supplier.post_code,
    'county', supplier.county,
    'countryCode', supplier.country_code,
    'countryName', party_country.name,
    'phone', supplier.phone,
    'email', supplier.email,
    'website', supplier.website,
    'contactDetails', supplier.contact_details,
    'vatNumber', supplier.vat_number,
    'companyNumber', supplier.company_number,
    'peppolScheme', supplier.peppol_scheme,
    'peppolId', supplier.peppol_id
  )
  into v_party
  from public.suppliers as supplier
  left join public.ref_countries as party_country
    on party_country.code = supplier.country_code
  where supplier.id = v_supplier;

  perform set_config('fintran.status_change', 'on', true);
  if v_numbering = 'on_post' then
    update public.transaction_headers
    set reference = v_reference
    where id = p_header_id;
    update public.transaction_lines
    set reference = v_reference
    where header_id = p_header_id;
  end if;
  update public.transaction_headers
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      issuer_snapshot = v_issuer,
      party_snapshot = v_party,
      reference = v_reference
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

revoke all on function public.post_document(uuid, text) from public, anon;
grant execute on function public.post_document(uuid, text) to authenticated;

drop function private.validate_form_layout(jsonb, text);

create function private.validate_form_layout(p_layout jsonb, p_type text, p_kind text default null)
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
        'contactDetails','name','address','phone','email','website','code','peppolId','country'
      ]
      when 'headerFields' then array[
        'reference','transactionDate','terms','dueDate','orderNumber','currency','exchangeRate','paidAmount',
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
    if p_kind = 'credit_note' and not (p_layout->'headerFields' ? 'precedingReference') then
      raise exception 'A sales credit note form must show the preceding invoice reference';
    end if;
  end if;
end;
$$;

revoke all on function private.validate_form_layout(jsonb, text, text) from public, anon, authenticated;

create or replace function private.enforce_transaction_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_kind text;
  v_flex text[];
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A form cannot be moved to another transaction type';
  end if;

  select type, document_kind::text, array[flex1_label, flex2_label, flex3_label, flex4_label, flex5_label]
    into v_type, v_kind, v_flex
  from public.transaction_types
  where id = new.transaction_type_id;

  if v_type is null then
    raise exception 'Transaction type must belong to this organisation';
  end if;

  perform private.validate_form_layout(new.layout, v_type, v_kind);

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
