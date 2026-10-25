-- Schema fixes. Two tenants, so isolation is proved. Rolls back.
begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'owner-fixes-a@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner A"}'::jsonb),
  ('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'owner-fixes-b@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner B"}'::jsonb);

select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org_a', (public.create_tenant('Fixes Books', 'Fixes Office'))->>'organisation_id', true);
select set_config('test.tenant_a', (select tenant_id::text from public.organisations where id = current_setting('test.org_a')::uuid), true);
select set_config('test.org_a2', public.create_organisation(current_setting('test.tenant_a')::uuid, 'Fixes Second', 'GBP')::text, true);

select set_config('request.jwt.claims', json_build_object('sub', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'role', 'authenticated')::text, true);
select set_config('test.org_b', (public.create_tenant('Fixes Other', 'Fixes Elsewhere'))->>'organisation_id', true);
select set_config('test.tenant_b', (select tenant_id::text from public.organisations where id = current_setting('test.org_b')::uuid), true);
select set_config('request.jwt.claims', json_build_object('sub', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'role', 'authenticated')::text, true);
reset role;

do $$
declare
  v_rate numeric;
  v_code text;
begin
  select currencies.rate, currencies.code
    into v_rate, v_code
  from public.organisation_defaults as defaults
  join public.currencies as currencies on currencies.id = defaults.home_currency_id
  where defaults.organisation_id = current_setting('test.org_a')::uuid;
  if v_code <> 'EUR' or v_rate <> 1 then
    raise exception 'fixes: create_tenant without a currency did not create EUR at rate 1 (% %)', v_code, v_rate;
  end if;

  select code, rate into v_code, v_rate
  from public.currencies
  where organisation_id = current_setting('test.org_a2')::uuid;
  if v_code <> 'GBP' or v_rate <> 1 then
    raise exception 'fixes: create_organisation GBP was % at %', v_code, v_rate;
  end if;

  begin
    perform public.create_organisation(current_setting('test.tenant_a')::uuid, 'Fixes Bad Currency', 'XYZ');
    raise exception 'fixes: XYZ was accepted';
  exception
    when others then
      if sqlerrm not like '%active ISO currency%' then
        raise exception 'fixes: XYZ error was %', sqlerrm;
      end if;
  end;
  if exists (select 1 from public.organisations where name = 'Fixes Bad Currency') then
    raise exception 'fixes: XYZ created an organisation';
  end if;

  begin
    update public.organisation_defaults set home_currency_id = null
    where organisation_id = current_setting('test.org_a')::uuid;
    raise exception 'fixes: a null home currency was saved';
  exception
    when not_null_violation then null;
    when others then
      if sqlerrm not like '%home currency%' then
        raise exception 'fixes: null home currency error was %', sqlerrm;
      end if;
  end;

  update public.organisation_defaults
  set peppol_scheme = '9935', peppol_id = 'AbC'
  where organisation_id = current_setting('test.org_a')::uuid;
  begin
    update public.organisation_defaults
    set peppol_scheme = '9935', peppol_id = 'abc'
    where organisation_id = current_setting('test.org_b')::uuid;
    raise exception 'fixes: a Peppol ID that differs only in case was saved';
  exception
    when others then
      if sqlerrm not like '%already registered to another organisation%' or sqlerrm ilike '%fixes%' then
        raise exception 'fixes: duplicate Peppol error was %', sqlerrm;
      end if;
  end;
  update public.organisation_defaults
  set peppol_scheme = '0060', peppol_id = '123456789'
  where organisation_id = current_setting('test.org_b')::uuid;

  begin
    update public.organisation_defaults
    set peppol_scheme = '0088', peppol_id = '123456789012'
    where organisation_id = current_setting('test.org_a2')::uuid;
    raise exception 'fixes: a 12-digit GLN was saved';
  exception
    when others then
      if sqlerrm not like '%format for scheme 0088%' then
        raise exception 'fixes: GLN error was %', sqlerrm;
      end if;
  end;
  update public.organisation_defaults
  set peppol_scheme = '0088', peppol_id = '1234567890123'
  where organisation_id = current_setting('test.org_a2')::uuid;

  begin
    insert into public.customers (tenant_id, organisation_id, code, name, currency_id, peppol_scheme, peppol_id)
    select tenant_id, organisation_id, 'BAD', 'Bad Peppol', id, '9935', 'has space'
    from public.currencies
    where organisation_id = current_setting('test.org_a')::uuid and code = 'EUR';
    raise exception 'fixes: a Peppol ID with a space was saved';
  exception
    when others then
      if sqlerrm not like '%Peppol ID%' then
        raise exception 'fixes: space Peppol error was %', sqlerrm;
      end if;
  end;

  insert into public.customers (tenant_id, organisation_id, code, name, currency_id, peppol_scheme, peppol_id)
  select tenant_id, organisation_id, 'SAME', 'Same Peppol', id, '0088', '1234567890123'
  from public.currencies
  where organisation_id = current_setting('test.org_a2')::uuid and code = 'GBP';
end;
$$;

reset role;
delete from public.tenants where id = current_setting('test.tenant_b')::uuid;

do $$
begin
  if exists (select 1 from public.organisations where tenant_id = current_setting('test.tenant_b')::uuid) then
    raise exception 'fixes: deleting a document-free tenant left organisations';
  end if;
end;
$$;

set local role authenticated;

do $$
declare
  v_sales_type uuid;
  v_purchase_type uuid;
  v_customer uuid;
  v_supplier uuid;
  v_currency uuid;
  v_income uuid;
  v_expense uuid;
  v_sales_vat uuid;
  v_expense_vat uuid;
  v_sales uuid;
  v_purchase uuid;
  v_nett numeric;
  v_scale numeric;
begin
  insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
  values
    (current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, '4000', 'Sales', 'Income'),
    (current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, '6000', 'Purchases', 'Expense');
  insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
  values
    (current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, 'S23', 'Standard', 23, 'Sales', 'S'),
    (current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, 'E23', 'Expense', 23, 'Expense', 'S');
  select id into v_currency from public.currencies where organisation_id = current_setting('test.org_a')::uuid and code = 'EUR';
  select id into v_income from public.gl_codes where organisation_id = current_setting('test.org_a')::uuid and code = '4000';
  select id into v_expense from public.gl_codes where organisation_id = current_setting('test.org_a')::uuid and code = '6000';
  select id into v_sales_vat from public.vat_rates where organisation_id = current_setting('test.org_a')::uuid and code = 'S23';
  select id into v_expense_vat from public.vat_rates where organisation_id = current_setting('test.org_a')::uuid and code = 'E23';
  insert into public.customers (
    tenant_id, organisation_id, code, name, currency_id, address_line1, city, country_code,
    vat_number, peppol_scheme, peppol_id, default_buyer_reference
  ) values (
    current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, 'ACME', 'Acme', v_currency,
    '1 Quay', 'Dublin', 'IE', 'IE7654321A', '9935', 'IE7654321A', 'PO-1'
  ) returning id into v_customer;
  insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city, country_code)
  values (current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, 'VOD', 'Vodafone', v_currency, '4 Quay', 'Dublin', 'IE')
  returning id into v_supplier;
  insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
  values (
    current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'on_post', 'INV-', 5
  ) returning id into v_sales_type;
  insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering)
  values (
    current_setting('test.tenant_a')::uuid, current_setting('test.org_a')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', 'on_insert'
  ) returning id into v_purchase_type;

  v_sales := public.save_document(jsonb_build_object(
    'transactionTypeId', v_sales_type,
    'customerId', v_customer,
    'transactionDate', '2026-10-22',
    'dueDate', '2026-11-22',
    'paymentTerms', '14 days',
    'currencyId', v_currency,
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Rounding', 'quantity', 3, 'price', 0.3333, 'discountAmount', 0,
      'vatRateId', v_sales_vat, 'glCodeId', v_income
    ))
  ));
  select nett_amount into v_nett from public.transaction_lines where header_id = v_sales;
  if v_nett <> 1.00 then
    raise exception 'fixes: 3 x 0.3333 stored nett %', v_nett;
  end if;

  begin
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', v_sales_type,
      'customerId', v_customer,
      'transactionDate', '2026-10-22',
      'currencyId', v_currency,
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object(
        'description', 'Too fine', 'quantity', 1, 'price', 2, 'discountAmount', 1.005,
        'vatRateId', v_sales_vat, 'glCodeId', v_income
      ))
    ));
    raise exception 'fixes: a 3-decimal discount was saved';
  exception
    when others then
      if sqlerrm not like '%at most 2 decimal places%' then
        raise exception 'fixes: discount error was %', sqlerrm;
      end if;
  end;

  update public.organisation_defaults
  set address_line1 = 'Dock 1', city = 'Dublin', country_code = 'IE', vat_number = 'IE1234567T',
      peppol_scheme = '9935', peppol_id = 'IE1234567T'
  where organisation_id = current_setting('test.org_a')::uuid;
  perform public.post_document(v_sales, null);

  begin
    update public.currencies set rate = 1.1
    where organisation_id = current_setting('test.org_a')::uuid and code = 'EUR';
    raise exception 'fixes: the home currency rate was changed';
  exception
    when others then
      if sqlerrm not like '%rate must stay at 1%' then
        raise exception 'fixes: home rate error was %', sqlerrm;
      end if;
  end;

  begin
    update public.organisation_defaults
    set home_currency_id = (select home_currency_id from public.organisation_defaults where organisation_id = current_setting('test.org_a2')::uuid)
    where organisation_id = current_setting('test.org_a')::uuid;
    raise exception 'fixes: home currency changed after a document existed';
  exception
    when others then
      if sqlerrm not like '%cannot be changed once documents exist%'
         and sqlerrm not like '%must belong to this organisation%' then
        raise exception 'fixes: home currency change error was %', sqlerrm;
      end if;
  end;

  v_purchase := public.save_document(jsonb_build_object(
    'transactionTypeId', v_purchase_type,
    'supplierId', v_supplier,
    'transactionDate', '2026-10-22',
    'currencyId', v_currency,
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Purchase', 'quantity', 1, 'price', 10, 'discountAmount', 0,
      'vatRateId', v_expense_vat, 'glCodeId', v_expense
    ))
  ));
  perform public.post_document(v_purchase, null);
  perform public.void_document(v_purchase, 'Entered twice');
  if (select status from public.transaction_headers where id = v_purchase) <> 'void' then
    raise exception 'fixes: purchase void did not void';
  end if;

  select numeric_scale into v_scale
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transaction_lines' and column_name = 'discount_amount';
  if v_scale <> 2 then
    raise exception 'fixes: discount scale is %', v_scale;
  end if;

  perform set_config('test.sales', v_sales::text, true);
end;
$$;

reset role;
alter table public.transaction_headers disable trigger zz_document_status;
do $$
begin
  begin
    update public.transaction_headers
    set issuer_snapshot = null
    where id = current_setting('test.sales')::uuid;
    raise exception 'fixes: a posted snapshot was cleared';
  exception
    when check_violation then null;
  end;
  begin
    update public.transaction_headers
    set status = 'draft', posted_at = now(), posted_by = null, issuer_snapshot = null, party_snapshot = null
    where id = current_setting('test.sales')::uuid;
    raise exception 'fixes: a draft kept a posted time';
  exception
    when check_violation then null;
  end;
  begin
    update public.transaction_headers
    set status = 'void', void_reason = null
    where id = current_setting('test.sales')::uuid;
    raise exception 'fixes: a void document without a reason was saved';
  exception
    when check_violation then null;
  end;
end;
$$;
alter table public.transaction_headers enable trigger zz_document_status;

do $$
begin
  delete from public.tenants where id = current_setting('test.tenant_a')::uuid;
  raise exception 'fixes: a tenant with documents was deleted';
exception
  when foreign_key_violation then null;
end;
$$;

do $$
begin
  if not exists (select 1 from public.transaction_headers where id = current_setting('test.sales')::uuid) then
    raise exception 'fixes: the failed tenant delete removed a document';
  end if;
end;
$$;

select 'schema fixes ok' as result;
rollback;
