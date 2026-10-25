-- EN 16931 phase 5. Business terms, sales defaults, payment means, and form fields.
-- Sales documents stay blocked. This test lifts that guard only inside the rollback.
begin;
create temp table phase5_users (id uuid primary key);
insert into phase5_users values ('a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase5@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb
from phase5_users;
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase5_users), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Five Books', 'Phase Five Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, payment_terms_days, address_line1, country_code)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 45, 'Quay 4', 'IE'
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, payment_terms_days, default_buyer_reference
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ACME', 'Acme', id, 30, 'PO-9'
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PC', 'Purchase credit', 0, 'Purchases', 'credit_note'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SC', 'Sales credit', 0, 'Sales', 'credit_note');

select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.customer', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.pi', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'), true);
select set_config('test.pc', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PC'), true);
select set_config('test.si', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'), true);
select set_config('test.sc', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SC'), true);

select set_config('test.sales_layout', $json${
  "version": 1,
  "title": "Tax Invoice",
  "showVatSummary": true,
  "organisationFields": ["name", "address", "vatNumber"],
  "partyFields": ["name", "address"],
  "headerFields": ["reference", "transactionDate"],
  "lineColumns": ["description", "quantity", "price", "tax", "amount"]
}$json$, true);
select set_config('test.credit_layout', $json${
  "version": 1,
  "title": "Credit Note",
  "showVatSummary": true,
  "organisationFields": ["name", "address", "vatNumber"],
  "partyFields": ["name", "address"],
  "headerFields": ["reference", "transactionDate", "precedingReference"],
  "lineColumns": ["description", "quantity", "price", "tax", "amount"]
}$json$, true);

do $$
declare
  v_header uuid;
  v_due date;
  v_terms text;
  v_buyer text;
  v_start date;
  v_end date;
  v_means text;
  v_comment text;
begin
  select col_description(c.oid, a.attnum) into v_comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public' and c.relname = 'transaction_headers' and a.attname = 'buyer_reference';
  if v_comment not like '%BT-10%' then
    raise exception 'phase 5: buyer reference is not named as BT-10';
  end if;

  begin
    update public.customers
    set payment_terms_days = 366
    where id = current_setting('test.customer')::uuid;
    raise exception 'phase 5: 366 payment days were saved';
  exception
    when check_violation then
      null;
    when others then
      raise exception 'phase 5: payment days error was %', sqlerrm;
  end;

  v_header := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-01',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Paper', 'quantity', 1, 'price', 10))
  ));
  select due_date, payment_terms, buyer_reference into v_due, v_terms, v_buyer
  from public.transaction_headers where id = v_header;
  if v_due is not null or v_terms is not null or v_buyer is not null then
    raise exception 'phase 5: a purchase draft was filled from the supplier';
  end if;

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.pi'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-02',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'invoicePeriodStart', '2026-10-01',
      'lines', jsonb_build_array(jsonb_build_object('description', 'Period', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 5: a one sided invoice period was saved';
  exception
    when others then
      if sqlerrm not like '%both the invoice period%' then
        raise exception 'phase 5: period error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.pi'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-02',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'invoicePeriodStart', '2026-10-31',
      'invoicePeriodEnd', '2026-10-01',
      'lines', jsonb_build_array(jsonb_build_object('description', 'Period', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 5: an inverted invoice period was saved';
  exception
    when others then
      if sqlerrm not like '%cannot be before the start%' then
        raise exception 'phase 5: inverted period error was %', sqlerrm;
      end if;
  end;

  v_header := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-02',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'buyerReference', ' PO-1 ',
    'contractReference', 'C-44',
    'paymentTerms', 'Net 14',
    'invoicePeriodStart', '2026-10-01',
    'invoicePeriodEnd', '2026-10-31',
    'paymentMeansCode', '30',
    'lines', jsonb_build_array(jsonb_build_object('description', 'Period', 'quantity', 1, 'price', 1))
  ));
  select buyer_reference, invoice_period_start, invoice_period_end, payment_means_code
    into v_buyer, v_start, v_end, v_means
  from public.transaction_headers where id = v_header;
  if v_buyer <> 'PO-1' or v_start <> '2026-10-01' or v_end <> '2026-10-31' or v_means <> '30' then
    raise exception 'phase 5: stored terms were % / % / % / %', v_buyer, v_start, v_end, v_means;
  end if;
  if (select contract_reference from public.transaction_headers where id = v_header) <> 'C-44' then
    raise exception 'phase 5: contract reference was not stored';
  end if;
  if (select payment_terms from public.transaction_headers where id = v_header) <> 'Net 14' then
    raise exception 'phase 5: payment terms were not stored';
  end if;

  begin
    insert into public.transaction_forms (tenant_id, organisation_id, transaction_type_id, layout)
    values (
      current_setting('test.tenant')::uuid,
      current_setting('test.org')::uuid,
      current_setting('test.sc')::uuid,
      current_setting('test.sales_layout')::jsonb
    );
    raise exception 'phase 5: a sales credit form omitted the preceding field';
  exception
    when others then
      if sqlerrm not like '%preceding invoice reference%' then
        raise exception 'phase 5: credit form error was %', sqlerrm;
      end if;
  end;

  insert into public.transaction_forms (tenant_id, organisation_id, transaction_type_id, layout)
  values
    (
      current_setting('test.tenant')::uuid,
      current_setting('test.org')::uuid,
      current_setting('test.sc')::uuid,
      current_setting('test.credit_layout')::jsonb
    ),
    (
      current_setting('test.tenant')::uuid,
      current_setting('test.org')::uuid,
      current_setting('test.si')::uuid,
      current_setting('test.sales_layout')::jsonb
    ),
    (
      current_setting('test.tenant')::uuid,
      current_setting('test.org')::uuid,
      current_setting('test.pc')::uuid,
      current_setting('test.sales_layout')::jsonb
    );

  begin
    update public.transaction_types
    set document_kind = 'credit_note'
    where id = current_setting('test.si')::uuid;
    raise exception 'phase 5: a sales invoice form became a credit note without that field';
  exception
    when others then
      if sqlerrm not like '%preceding invoice reference%' then
        raise exception 'phase 5: kind layout error was %', sqlerrm;
      end if;
  end;
end;
$$;

update public.organisation_defaults
set address_line1 = 'Dock 1', city = 'Dublin', vat_number = 'IE1234567T',
    peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('test.org')::uuid;
update public.customers
set address_line1 = '1 Acme Quay', city = 'Dublin', vat_number = 'IE7654321A',
    peppol_scheme = '9935', peppol_id = 'IE7654321A'
where id = current_setting('test.customer')::uuid;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Sales VAT', 23, 'Sales', 'S');
select set_config('test.income', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '4000'), true);
select set_config('test.sales_vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'S23'), true);

reset role;
set local role authenticated;

do $$
declare
  v_header uuid;
  v_due date;
  v_terms text;
  v_buyer text;
  v_means text;
  v_snapshot jsonb;
begin
  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-01',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid
  )
  returning id into v_header;
  select due_date, payment_terms, buyer_reference into v_due, v_terms, v_buyer
  from public.transaction_headers where id = v_header;
  if v_due <> '2026-10-31' or v_terms <> 'Payment due within 30 days' or v_buyer <> 'PO-9' then
    raise exception 'phase 5: sales defaults were % / % / %', v_due, v_terms, v_buyer;
  end if;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id,
    buyer_reference, due_date, payment_terms
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-01',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid,
    'KEEP',
    '2026-11-01',
    'Net 14'
  )
  returning id into v_header;
  select due_date, payment_terms, buyer_reference into v_due, v_terms, v_buyer
  from public.transaction_headers where id = v_header;
  if v_due <> '2026-11-01' or v_terms <> 'Net 14' or v_buyer <> 'KEEP' then
    raise exception 'phase 5: entered sales terms were replaced with % / % / %', v_due, v_terms, v_buyer;
  end if;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id, buyer_reference
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-01',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid,
    '   '
  )
  returning id into v_header;
  if (select buyer_reference from public.transaction_headers where id = v_header) <> 'PO-9' then
    raise exception 'phase 5: a blank buyer reference was not filled';
  end if;

  update public.customers set payment_terms_days = 0 where id = current_setting('test.customer')::uuid;
  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id, buyer_reference
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-01',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid,
    'KEEP'
  )
  returning id into v_header;
  select due_date, payment_terms into v_due, v_terms from public.transaction_headers where id = v_header;
  if v_due <> '2026-10-01' or v_terms <> 'Due on receipt' then
    raise exception 'phase 5: zero day terms were % / %', v_due, v_terms;
  end if;

  update public.customers set payment_terms_days = 1 where id = current_setting('test.customer')::uuid;
  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id, buyer_reference
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-01',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid,
    'KEEP'
  )
  returning id into v_header;
  select due_date, payment_terms into v_due, v_terms from public.transaction_headers where id = v_header;
  if v_due <> '2026-10-02' or v_terms <> 'Payment due within 1 day' then
    raise exception 'phase 5: one day terms were % / %', v_due, v_terms;
  end if;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id, buyer_reference
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-03',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid,
    'KEEP'
  )
  returning id into v_header;
  insert into public.transaction_lines (
    tenant_id, organisation_id, header_id, line_number, description,
    quantity, price, discount_amount, nett_amount, vat_amount, vat_rate_id, gl_code_id
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    v_header,
    1,
    'Sold',
    1,
    1,
    0,
    1,
    0,
    current_setting('test.sales_vat')::uuid,
    current_setting('test.income')::uuid
  );
  perform public.post_document(v_header, null);
  if (select payment_means_code from public.transaction_headers where id = v_header) is not null then
    raise exception 'phase 5: payment means were set without an IBAN';
  end if;

  update public.organisation_defaults
  set iban = 'IE29AIBK93115212345678', bic = 'AIBKIE2D', bank_account_name = 'Phase Five Office', address_line1 = 'Dock 1'
  where organisation_id = current_setting('test.org')::uuid;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id, buyer_reference
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-04',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid,
    'KEEP'
  )
  returning id into v_header;
  insert into public.transaction_lines (
    tenant_id, organisation_id, header_id, line_number, description,
    quantity, price, discount_amount, nett_amount, vat_amount, vat_rate_id, gl_code_id
  ) values (
    current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v_header, 1, 'Sold', 1, 1, 0, 1, 0,
    current_setting('test.sales_vat')::uuid, current_setting('test.income')::uuid
  );
  perform public.post_document(v_header, null);
  select payment_means_code, issuer_snapshot into v_means, v_snapshot
  from public.transaction_headers where id = v_header;
  if v_means <> '58' or v_snapshot->>'iban' <> 'IE29AIBK93115212345678' or v_snapshot->>'bic' <> 'AIBKIE2D' or v_snapshot->>'addressLine1' <> 'Dock 1' then
    raise exception 'phase 5: SEPA default was % with snapshot %', v_means, v_snapshot;
  end if;

  insert into public.transaction_headers (
    tenant_id, organisation_id, transaction_type_id, transaction_date,
    party_name, currency_id, exchange_rate, amount_due, customer_id, buyer_reference, payment_means_code
  ) values (
    current_setting('test.tenant')::uuid,
    current_setting('test.org')::uuid,
    current_setting('test.si')::uuid,
    '2026-10-05',
    'Acme',
    current_setting('test.currency')::uuid,
    1,
    0,
    current_setting('test.customer')::uuid,
    'KEEP',
    '30'
  )
  returning id into v_header;
  insert into public.transaction_lines (
    tenant_id, organisation_id, header_id, line_number, description,
    quantity, price, discount_amount, nett_amount, vat_amount, vat_rate_id, gl_code_id
  ) values (
    current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v_header, 1, 'Sold', 1, 1, 0, 1, 0,
    current_setting('test.sales_vat')::uuid, current_setting('test.income')::uuid
  );
  perform public.post_document(v_header, null);
  if (select payment_means_code from public.transaction_headers where id = v_header) <> '30' then
    raise exception 'phase 5: a chosen payment means was replaced';
  end if;
end;
$$;

reset role;
alter table public.transaction_headers enable trigger transaction_headers_scope;
set local role authenticated;

do $$
declare
  v_means text;
  v_purchase uuid;
begin
  v_purchase := public.save_document(jsonb_build_object(
    'transactionTypeId', current_setting('test.pi'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-06',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Goods', 'quantity', 1, 'price', 4))
  ));
  perform public.post_document(v_purchase, null);
  select payment_means_code into v_means
  from public.transaction_headers where id = v_purchase;
  if v_means is not null then
    raise exception 'phase 5: a purchase was given payment means %', v_means;
  end if;
  if (select issuer_snapshot->>'iban' from public.transaction_headers where id = v_purchase) <> 'IE29AIBK93115212345678' then
    raise exception 'phase 5: the purchase snapshot missed the IBAN';
  end if;
  if (select party_snapshot->>'addressLine1' from public.transaction_headers where id = v_purchase) <> 'Quay 4'
     or (select party_snapshot->>'countryCode' from public.transaction_headers where id = v_purchase) <> 'IE' then
    raise exception 'phase 5: the supplier snapshot missed the address';
  end if;

  update public.organisation_defaults
  set iban = null, address_line1 = 'Dock 2'
  where organisation_id = current_setting('test.org')::uuid;
  update public.transaction_headers set paid_amount = 1 where id = v_purchase;
  if (select issuer_snapshot->>'iban' from public.transaction_headers where id = v_purchase) <> 'IE29AIBK93115212345678'
     or (select issuer_snapshot->>'addressLine1' from public.transaction_headers where id = v_purchase) <> 'Dock 1' then
    raise exception 'phase 5: a posted snapshot was rewritten';
  end if;
end;
$$;

reset role;
alter table public.transaction_headers enable trigger transaction_headers_scope;
rollback;
select 'en16931 phase 5 ok';
