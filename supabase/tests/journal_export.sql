-- Journal export (QULAPLUS_JOURNAL_EXPORT_SPEC.md, phases 1 to 3). Raises on failure and rolls back.
begin;

create temp table jx_users (who text primary key, id uuid not null);
insert into jx_users (who, id) values
  ('owner', 'a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8'),
  ('admin', 'b7b7b7b7-b7b7-4b7b-8b7b-b7b7b7b7b7b7'),
  ('member', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9'),
  ('outsider', 'dadadada-dada-4ada-8ada-dadadadadada');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-journal@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from jx_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from jx_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'allocations: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'allocations: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'allocations: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'allocations: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

grant all on table jx_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text), pg_temp.eq(text, anyelement, anyelement) to authenticated;

-- Posting a payment is done the way post_payment will, so the helper runs with the rights of the test owner.
create function pg_temp.post(p_payment uuid) returns void language plpgsql security definer as $$
begin
  perform set_config('fintran.status_change', 'on', true);
  update public.payments set status = 'posted', posted_at = now(), posted_by = auth.uid(),
    reference = coalesce(reference, (select coalesce(max(other.reference), 0) + 1 from public.payments as other where other.transaction_type_id = payments.transaction_type_id))
  where id = p_payment;
  perform set_config('fintran.status_change', 'off', true);
  update public.allocations set pending = false where source_payment_id = p_payment and pending;
end $$;

select pg_temp.act_as('owner');
set local role authenticated;

select set_config('test.org', (public.create_tenant('Journal Books', 'Journal Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Journal Second', 'EUR'))::text, true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-journal@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-journal@fintran.test', 'member');

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'GBP', 'Pound sterling', 0.85)
on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'Z0', 'Zero sales', 0, 'Sales', 'Z'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PZ', 'Zero purchases', 0, 'Expense', 'Z');
update public.organisation_defaults
set address_line1 = 'Dock 1', city = 'Dublin', vat_number = 'IE1234567T', peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('test.org')::uuid;

insert into public.customers (tenant_id, organisation_id, code, name, currency_id, address_line1, city, vat_number, peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.name, c.id, '1 Quay', 'Dublin', 'IE7654321A', '9935', v.peppol, 'PO-1', 0
from (values ('ACME', 'Acme', 'EUR', 'IE7654321A'), ('OTHER', 'Other customer', 'EUR', 'IE7654322B'), ('GBPCO', 'Sterling customer', 'GBP', 'IE7654323C'), ('THIRD', 'Third customer', 'EUR', 'IE7654324D')) as v(code, name, cur, peppol)
join public.currencies c on c.organisation_id = current_setting('test.org')::uuid and c.code = v.cur;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.name, c.id, 'Quay 4', 'Dublin'
from (values ('VOD', 'Vodafone', 'EUR'), ('GBPV', 'Sterling supplier', 'GBP')) as v(code, name, cur)
join public.currencies c on c.organisation_id = current_setting('test.org')::uuid and c.code = v.cur;

insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.code, v.iban, c.id
from (values ('EUR1', 'IE29AIBK93115212345678', 'EUR'), ('GBP1', 'GB82WEST12345698765432', 'GBP')) as v(code, iban, cur)
join public.currencies c on c.organisation_id = current_setting('test.org')::uuid and c.code = v.cur;

insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'on_post', 'INV-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SC', 'Sales credit', 0, 'Sales', 'credit_note', 'on_post', 'CR-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SO', 'Sales order', 0, 'Sales', 'order', 'on_post', 'SO-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', 'on_insert', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PC', 'Purchase credit', 0, 'Purchases', 'credit_note', 'on_insert', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'REC', 'Customer receipt', 0, 'Sales', 'receipt', 'on_insert', 'R-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CREF', 'Customer refund', 0, 'Sales', 'payment', 'on_insert', 'CF-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PAY', 'Supplier payment', 0, 'Purchases', 'payment', 'on_insert', 'P-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SREF', 'Supplier refund', 0, 'Purchases', 'receipt', 'on_insert', 'SR-', 4);

create function pg_temp.id_of(p_table text, p_code text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  execute format('select id from public.%I where organisation_id = $1 and code = $2', p_table) into v_id using current_setting('test.org')::uuid, p_code;
  return v_id;
end $$;

-- A posted invoice or credit note for a party. Sales types are for customers and Purchases types for suppliers.
create function pg_temp.document(p_type text, p_party text, p_price numeric, p_date date default '2026-11-12', p_due date default null, p_preceding uuid default null, p_post boolean default true)
returns uuid language plpgsql as $$
declare
  v_sales boolean := p_type in ('SI', 'SC', 'SO');
  v_currency text := case when p_party in ('GBPCO', 'GBPV') then 'GBP' else 'EUR' end;
  v_id uuid;
begin
  v_id := public.save_document(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type),
    'supplierId', case when not v_sales then pg_temp.id_of('suppliers', p_party) end,
    'customerId', case when v_sales then pg_temp.id_of('customers', p_party) end,
    'supplierReference', case when not v_sales then 'S-' || left(gen_random_uuid()::text, 8) end,
    'transactionDate', p_date, 'dueDate', coalesce(p_due, p_date),
    'currencyId', pg_temp.id_of('currencies', v_currency),
    'exchangeRate', case when v_currency = 'GBP' then 0.85 else 1 end,
    'precedingHeaderId', p_preceding,
    'precedingReference', case when p_preceding is not null then 'INV' end,
    'precedingDate', case when p_preceding is not null then p_date end,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Goods', 'quantity', 1, 'price', p_price,
      'vatRateId', pg_temp.id_of('vat_rates', case when v_sales then 'Z0' else 'PZ' end),
      'glCodeId', pg_temp.id_of('gl_codes', case when v_sales then '4000' else '6000' end)))
  ));
  if p_post then
    perform public.post_document(v_id, null);
  end if;
  return v_id;
end $$;

-- A payment. The test posts it the way post_payment will, by setting the flag, because that function comes later.
create function pg_temp.payment(p_type text, p_party text, p_amount numeric, p_post boolean default true, p_rate numeric default null, p_date date default '2026-11-12')
returns uuid language plpgsql as $$
declare
  v_sales boolean := p_type in ('REC', 'CREF');
  v_gbp boolean := p_party in ('GBPCO', 'GBPV');
  v_id uuid;
begin
  insert into public.payments (tenant_id, organisation_id, transaction_type_id, payment_date, customer_id, supplier_id, bank_account_id, currency_id, exchange_rate, amount, party_name)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, pg_temp.id_of('transaction_types', p_type), p_date,
    case when v_sales then pg_temp.id_of('customers', p_party) end, case when not v_sales then pg_temp.id_of('suppliers', p_party) end,
    pg_temp.id_of('bank_accounts', case when v_gbp then 'GBP1' else 'EUR1' end), pg_temp.id_of('currencies', case when v_gbp then 'GBP' else 'EUR' end),
    p_rate, p_amount, 'x')
  returning id into v_id;
  if p_post then
    perform pg_temp.post(v_id);
  end if;
  return v_id;
end $$;



create function pg_temp.due(p_header uuid) returns numeric language sql as $$ select amount_due from public.transaction_headers where id = p_header $$;
create function pg_temp.paid(p_header uuid) returns numeric language sql as $$ select paid_amount from public.transaction_headers where id = p_header $$;
-- A credit note that stays open: it is raised against an invoice that has already been paid in full.
create function pg_temp.open_credit(p_amount numeric) returns uuid language plpgsql as $$
declare
  v_invoice uuid := pg_temp.document('SI', 'ACME', 100);
  v_receipt uuid := pg_temp.payment('REC', 'ACME', 100);
begin
  perform public.allocate(jsonb_build_object('paymentId', v_receipt), v_invoice, 100, null);
  return pg_temp.document('SC', 'ACME', p_amount, '2026-11-12', null, v_invoice);
end $$;
grant execute on function pg_temp.open_credit(numeric) to authenticated;
create function pg_temp.src(p_payment uuid) returns jsonb language sql as $$ select jsonb_build_object('paymentId', p_payment) $$;
create function pg_temp.note(p_header uuid) returns jsonb language sql as $$ select jsonb_build_object('creditNoteId', p_header) $$;
grant execute on function pg_temp.id_of(text, text), pg_temp.document(text, text, numeric, date, date, uuid, boolean),
  pg_temp.payment(text, text, numeric, boolean, numeric, date), pg_temp.post(uuid), pg_temp.due(uuid), pg_temp.paid(uuid),
  pg_temp.src(uuid), pg_temp.note(uuid) to authenticated;
-- Extra setup: control accounts, VAT rates, a department and a cost centre, and a second organisation's GL code.
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '1100', 'Trade debtors', 'Current Asset'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '2100', 'Trade creditors', 'Current Liability'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '2200', 'VAT on sales', 'Current Liability'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '1300', 'VAT on purchases', 'Current Asset'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '7900', 'Exchange gain or loss', 'Expense'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '7950', 'Rounding', 'Expense'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '1200', 'Bank euro', 'Current Asset'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '1250', 'Bank sterling', 'Current Asset');
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, '9999', 'Other organisation', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Sales VAT', 23, 'Sales', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Purchases VAT', 23, 'Expense', 'S');
insert into public.departments (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'OPS', 'Operations');
insert into public.cost_centres (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'HQ', 'Head office');

-- A posted document of several lines with VAT, optionally with a department and cost centre on its lines.
create function pg_temp.vdoc(p_type text, p_party text, p_prices numeric[], p_date date default '2026-11-10', p_preceding uuid default null, p_dimensions boolean default false, p_rounding numeric default 0)
returns uuid language plpgsql as $$
declare
  v_sales boolean := p_type in ('SI', 'SC');
  v_gbp boolean := p_party in ('GBPCO', 'GBPV');
  v_lines jsonb := '[]';
  v_price numeric;
  v_id uuid;
begin
  foreach v_price in array p_prices loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', 'Goods', 'quantity', 1, 'price', v_price,
      'vatRateId', pg_temp.id_of('vat_rates', case when v_gbp then 'PZ' when v_sales then 'S23' else 'P23' end),
      'glCodeId', pg_temp.id_of('gl_codes', case when v_sales then '4000' else '6000' end),
      'departmentId', case when p_dimensions then pg_temp.id_of('departments', 'OPS') end,
      'costCentreId', case when p_dimensions then pg_temp.id_of('cost_centres', 'HQ') end));
  end loop;
  v_id := public.save_document(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type),
    'supplierId', case when not v_sales then pg_temp.id_of('suppliers', p_party) end,
    'customerId', case when v_sales then pg_temp.id_of('customers', p_party) end,
    'supplierReference', case when not v_sales then 'S-' || left(gen_random_uuid()::text, 8) end,
    'transactionDate', p_date, 'dueDate', p_date,
    'currencyId', pg_temp.id_of('currencies', case when v_gbp then 'GBP' else 'EUR' end),
    'exchangeRate', case when v_gbp then 0.85 else 1 end,
    'precedingHeaderId', p_preceding,
    'precedingReference', case when p_preceding is not null then 'INV' end,
    'precedingDate', case when p_preceding is not null then p_date end,
    'roundingAmount', p_rounding,
    'lines', v_lines));
  perform public.post_document(v_id, null);
  return v_id;
end $$;
grant execute on function pg_temp.vdoc(text, text, numeric[], date, uuid, boolean, numeric) to authenticated;

create function pg_temp.lines_of(p_source uuid, p_up_to date default '2026-12-31')
returns table (account_code text, debit numeric, credit numeric, department_code text, cost_centre_code text, journal_date date)
language sql as $$
  select l.account_code, l.debit, l.credit, l.department_code, l.cost_centre_code, l.journal_date
  from public.journal_preview(current_setting('test.org')::uuid, p_up_to) as l
  where l.source_id = p_source
  order by l.line_number
$$;
grant execute on function pg_temp.lines_of(uuid, date) to authenticated;

-- 1. Settings: owners and admins only, the codes belong to the organisation, and saving is audited.
select pg_temp.act_as('member');
select pg_temp.eq('a member reads no settings', (select count(*) from public.accounting_settings)::int, 0);
select pg_temp.expect_error(
  format($sql$insert into public.accounting_settings (tenant_id, organisation_id) values (%L, %L)$sql$, current_setting('test.tenant'), current_setting('test.org')),
  'row-level security', 'a member saving settings');
select pg_temp.eq('a member gets no problems', (select count(*) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31'))::int, 0);
select pg_temp.eq('a member gets no preview', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, '2026-12-31'))::int, 0);
select pg_temp.expect_error(format($sql$select public.create_journal_batch(%L, '2026-12-31')$sql$, current_setting('test.org')), 'owner or admin', 'a member creating a batch');

select pg_temp.act_as('owner');
select pg_temp.expect_error(
  format($sql$insert into public.accounting_settings (tenant_id, organisation_id, receivables_gl_code_id) values (%L, %L, %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), (select id from public.gl_codes where organisation_id = current_setting('test.org2')::uuid and code = '9999')),
  'violates foreign key', 'a GL code from another organisation');

-- Documents and payments exist before the accounts are chosen, so the preview has problems to report.
select set_config('test.si', pg_temp.vdoc('SI', 'ACME', array[100, 50])::text, true);
select set_config('test.rec', pg_temp.payment('REC', 'ACME', 100)::text, true);

select pg_temp.eq('without settings the missing accounts are reported',
  (select count(distinct message) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31')
   where message like '%receivables account is not set%' or message like '%VAT on sales account is not set%' or message like 'Bank account EUR1 has no GL code%')::int, 3);
select pg_temp.eq('a problem names its document', (select count(*) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31') where source_id = current_setting('test.si')::uuid and source_number is not null)::int, 2);
select pg_temp.expect_error(format($sql$select public.create_journal_batch(%L, '2026-12-31')$sql$, current_setting('test.org')), 'problems listed in the preview', 'a batch with problems');
select pg_temp.eq('nothing was marked by the refused batch', (select count(*) from public.journal_exports)::int, 0);

-- Set the accounts. Bank accounts get their GL codes.
insert into public.accounting_settings (tenant_id, organisation_id, receivables_gl_code_id, payables_gl_code_id, vat_sales_gl_code_id, vat_purchases_gl_code_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, pg_temp.id_of('gl_codes', '1100'), pg_temp.id_of('gl_codes', '2100'),
        pg_temp.id_of('gl_codes', '2200'), pg_temp.id_of('gl_codes', '1300'));
select pg_temp.eq('the settings come back', (select count(*) from public.accounting_settings where receivables_gl_code_id = pg_temp.id_of('gl_codes', '1100'))::int, 1);
select pg_temp.eq('saving the settings is in the audit log', (select count(*) from public.audit_log where table_name = 'accounting_settings' and action = 'INSERT' and organisation_id = current_setting('test.org')::uuid)::int, 1);
select pg_temp.eq('a bank account with no GL code is still reported',
  (select count(*) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31') where message like 'Bank account EUR1 has no GL code%')::int, 1);
update public.bank_accounts set gl_code_id = pg_temp.id_of('gl_codes', '1200') where organisation_id = current_setting('test.org')::uuid and code = 'EUR1';
update public.bank_accounts set gl_code_id = pg_temp.id_of('gl_codes', '1250') where organisation_id = current_setting('test.org')::uuid and code = 'GBP1';
select pg_temp.eq('with the accounts set there are no problems', (select count(*) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31'))::int, 0);

-- Clearing an account is allowed and the preview reports it again.
update public.accounting_settings set vat_sales_gl_code_id = null where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('a cleared account is reported', (select count(*) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31') where message like '%VAT on sales account is not set%')::int, 1);
update public.accounting_settings set vat_sales_gl_code_id = pg_temp.id_of('gl_codes', '2200') where organisation_id = current_setting('test.org')::uuid;

-- A sales invoice of two lines at 100.00 and 50.00 with 23 per cent VAT.
select pg_temp.eq('sales invoice lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code, credit) from pg_temp.lines_of(current_setting('test.si')::uuid)),
  '1100 184.50/0.00; 2200 0.00/34.50; 4000 0.00/50.00; 4000 0.00/100.00');
-- A receipt: debit bank, credit receivables.
select pg_temp.eq('receipt lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.rec')::uuid)),
  '1100 0.00/100.00; 1200 100.00/0.00');

-- A purchase invoice mirrors it, and a supplier payment debits payables and credits bank.
select set_config('test.pi', pg_temp.vdoc('PI', 'VOD', array[200], '2026-11-11')::text, true);
select pg_temp.eq('purchase invoice lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.pi')::uuid)),
  '1300 46.00/0.00; 2100 0.00/246.00; 6000 200.00/0.00');
select set_config('test.pay', pg_temp.payment('PAY', 'VOD', 246, true, null, '2026-11-12')::text, true);
select pg_temp.eq('supplier payment lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.pay')::uuid)),
  '1200 0.00/246.00; 2100 246.00/0.00');

-- A credit note is the same lines with the sides swapped.
select set_config('test.sc', pg_temp.vdoc('SC', 'ACME', array[40], '2026-11-12', current_setting('test.si')::uuid)::text, true);
select pg_temp.eq('sales credit note lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.sc')::uuid)),
  '1100 0.00/49.20; 2200 9.20/0.00; 4000 40.00/0.00');

-- A customer refund and a supplier refund mirror the receipt and the payment.
select set_config('test.cref', pg_temp.payment('CREF', 'ACME', 10)::text, true);
select pg_temp.eq('customer refund lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.cref')::uuid)),
  '1100 10.00/0.00; 1200 0.00/10.00');
select set_config('test.sref', pg_temp.payment('SREF', 'VOD', 5)::text, true);
select pg_temp.eq('supplier refund lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.sref')::uuid)),
  '1200 5.00/0.00; 2100 0.00/5.00');

-- Departments and cost centres are on the lines with a GL code and not on control or VAT lines.
select set_config('test.dim', pg_temp.vdoc('PI', 'VOD', array[300], '2026-11-11', null, true)::text, true);
select pg_temp.eq('dimensions on the GL line',
  (select count(*) from pg_temp.lines_of(current_setting('test.dim')::uuid) where account_code = '6000' and department_code = 'OPS' and cost_centre_code = 'HQ')::int, 1);
select pg_temp.eq('no dimensions on control or VAT',
  (select count(*) from pg_temp.lines_of(current_setting('test.dim')::uuid) where account_code <> '6000' and (department_code is not null or cost_centre_code is not null))::int, 0);

-- A document's rounding amount goes to the rounding account, and the journal still balances.
select set_config('test.round', pg_temp.vdoc('PI', 'VOD', array[10], '2026-11-11', null, false, 0.02)::text, true);
select pg_temp.eq('a missing rounding account is reported now', (select count(*) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31') where message like '%rounding account is not set%')::int, 1);
update public.accounting_settings set rounding_gl_code_id = pg_temp.id_of('gl_codes', '7950') where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('rounding lines',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.round')::uuid)),
  '1300 2.30/0.00; 2100 0.00/12.32; 6000 10.00/0.00; 7950 0.02/0.00');

-- A document in a foreign currency: 85.00 GBP at 0.85 is 100.00 at home, with no VAT.
select set_config('test.gbp', pg_temp.vdoc('PI', 'GBPV', array[30, 25, 30], '2026-11-11')::text, true);
select pg_temp.eq('the lines add up to the header home nett',
  (select sum(debit) from pg_temp.lines_of(current_setting('test.gbp')::uuid) where account_code = '6000'),
  (select home_nett_amount from public.transaction_headers where id = current_setting('test.gbp')::uuid));
select pg_temp.eq('the control line is the header home total',
  (select credit from pg_temp.lines_of(current_setting('test.gbp')::uuid) where account_code = '2100'),
  (select home_total_amount from public.transaction_headers where id = current_setting('test.gbp')::uuid));

-- The exchange difference of an allocation: 85.00 GBP paid at 0.80 costs 106.25 for a payable carried at 100.00.
select set_config('test.gbppay', pg_temp.payment('PAY', 'GBPV', 85, true, 0.8, '2026-11-13')::text, true);
select public.allocate(pg_temp.src(current_setting('test.gbppay')::uuid), current_setting('test.gbp')::uuid, 85, '2026-11-13');
select set_config('test.gbpalloc', (select id::text from public.allocations where source_payment_id = current_setting('test.gbppay')::uuid and removed_at is null), true);
select pg_temp.eq('the allocation has a loss', (select exchange_difference from public.allocations where id = current_setting('test.gbpalloc')::uuid), -6.25);
-- The exchange account is only needed once there is a difference to post.
select pg_temp.eq('a missing exchange account is reported now', (select count(*) from public.journal_problems(current_setting('test.org')::uuid, '2026-12-31') where message like '%exchange gain or loss account is not set%')::int, 1);
select pg_temp.eq('and the journal is held back', (select count(*) from pg_temp.lines_of(current_setting('test.gbpalloc')::uuid))::int, 0);
update public.accounting_settings set exchange_gl_code_id = pg_temp.id_of('gl_codes', '7900'), rounding_gl_code_id = pg_temp.id_of('gl_codes', '7950') where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('the exchange journal',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.gbpalloc')::uuid)),
  '2100 0.00/6.25; 7900 6.25/0.00') ;
select pg_temp.eq('the exchange journal is dated on the allocation date', (select min(journal_date) from pg_temp.lines_of(current_setting('test.gbpalloc')::uuid)), '2026-11-13'::date);
-- An allocation with no difference writes none: the receipt settles most of the invoice at the same rate.
select public.allocate(pg_temp.src(current_setting('test.rec')::uuid), current_setting('test.si')::uuid, 100, null);
select pg_temp.eq('no journal for an allocation with no difference', (select count(distinct source_id) from public.journal_preview(current_setting('test.org')::uuid, '2026-12-31') where source_ref = 'allocation')::int, 1);

-- Every journal balances, and the control accounts agree with what the app shows as due.
select pg_temp.eq('every journal balances',
  (select count(*) from (select journal_number from public.journal_preview(current_setting('test.org')::uuid, '2026-12-31') group by journal_number having sum(debit) <> sum(credit)) bad)::int, 0);
select pg_temp.eq('receivables agree with what is due',
  (select coalesce(sum(debit - credit), 0) from public.journal_preview(current_setting('test.org')::uuid, '2026-12-31') where account_code = '1100'),
  (select coalesce(sum(case when kind.document_kind = 'invoice' then header.home_amount_due else -header.home_amount_due end), 0)
   from public.transaction_headers header join public.transaction_types kind on kind.id = header.transaction_type_id
   where header.organisation_id = current_setting('test.org')::uuid and kind.type = 'Sales' and header.status = 'posted' and kind.document_kind in ('invoice', 'credit_note'))
  - (select coalesce(sum(payment.home_unallocated_amount * case when kind.document_kind = 'receipt' then 1 else -1 end), 0)
     from public.payments payment join public.transaction_types kind on kind.id = payment.transaction_type_id
     where payment.organisation_id = current_setting('test.org')::uuid and kind.type = 'Sales' and payment.status = 'posted'));
-- A document's rounding amount is part of what is owed in the journal (EN 16931 payable amount) and is not in home_amount_due,
-- so the one document with a rounding amount is added to what the app shows.
select pg_temp.eq('payables agree with what is due',
  -(select coalesce(sum(debit - credit), 0) from public.journal_preview(current_setting('test.org')::uuid, '2026-12-31') where account_code = '2100'),
  (select coalesce(sum(header.rounding_amount), 0) from public.transaction_headers header where header.id = current_setting('test.round')::uuid)
  + (select coalesce(sum(case when kind.document_kind = 'invoice' then header.home_amount_due else -header.home_amount_due end), 0)
   from public.transaction_headers header join public.transaction_types kind on kind.id = header.transaction_type_id
   where header.organisation_id = current_setting('test.org')::uuid and kind.type = 'Purchases' and header.status = 'posted' and kind.document_kind in ('invoice', 'credit_note'))
  - (select coalesce(sum(payment.home_unallocated_amount * case when kind.document_kind = 'payment' then 1 else -1 end), 0)
     from public.payments payment join public.transaction_types kind on kind.id = payment.transaction_type_id
     where payment.organisation_id = current_setting('test.org')::uuid and kind.type = 'Purchases' and payment.status = 'posted'));

-- The date limits what is included: nothing dated after it, and the batch dates stay the document dates.
select pg_temp.eq('nothing before the first document', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, '2026-11-01'))::int, 0);
select pg_temp.eq('only the first day', (select count(distinct source_id) from public.journal_preview(current_setting('test.org')::uuid, '2026-11-10'))::int, 1);

-- 2. Batches.
select set_config('test.batch1', public.create_journal_batch(current_setting('test.org')::uuid, '2026-11-12')::text, true);
select pg_temp.eq('the first batch is number 1', (select number from public.journal_batches where id = current_setting('test.batch1')::uuid), 1);
select pg_temp.eq('the batch stored its lines', (select line_count from public.journal_batches where id = current_setting('test.batch1')::uuid),
  (select count(*)::int from public.journal_batch_lines where batch_id = current_setting('test.batch1')::uuid));
select pg_temp.eq('the batch balances', (select total_debit from public.journal_batches where id = current_setting('test.batch1')::uuid),
  (select total_credit from public.journal_batches where id = current_setting('test.batch1')::uuid));
select pg_temp.eq('journal numbers carry the batch number', (select count(*) from public.journal_batch_lines where batch_id = current_setting('test.batch1')::uuid and journal_number like 'JB-0001-%')::int,
  (select line_count from public.journal_batches where id = current_setting('test.batch1')::uuid));
select pg_temp.eq('making the batch is in the audit log', (select count(*) from public.audit_log where table_name = 'journal_batches' and action = 'INSERT' and row_id = current_setting('test.batch1'))::int, 1);
select pg_temp.eq('what was exported is not previewed again', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, '2026-11-12') where source_id = current_setting('test.si')::uuid)::int, 0);
select pg_temp.eq('later documents are still waiting', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, '2026-12-31') where source_id = current_setting('test.gbppay')::uuid)::int, 2);
select pg_temp.expect_error(format($sql$select public.create_journal_batch(%L, '2026-11-12')$sql$, current_setting('test.org')), 'nothing to export', 'running the same export again');

-- Batches cannot be changed or deleted, by anyone, and cannot be written directly.
select pg_temp.expect_error(format($sql$update public.journal_batches set up_to = '2026-01-01' where id = %L$sql$, current_setting('test.batch1')), 'permission denied', 'changing a batch');
select pg_temp.expect_error(format($sql$delete from public.journal_batches where id = %L$sql$, current_setting('test.batch1')), 'permission denied', 'deleting a batch');
select pg_temp.expect_error(format($sql$delete from public.journal_batch_lines where batch_id = %L$sql$, current_setting('test.batch1')), 'permission denied', 'deleting batch lines');
select pg_temp.expect_error(format($sql$insert into public.journal_batches (tenant_id, organisation_id, number, up_to, journal_count, line_count, total_debit, total_credit) values (%L, %L, 99, '2026-01-01', 0, 0, 0, 0)$sql$, current_setting('test.tenant'), current_setting('test.org')), 'permission denied', 'writing a batch directly');
select pg_temp.expect_error(format($sql$delete from public.journal_exports where batch_id = %L$sql$, current_setting('test.batch1')), 'permission denied', 'deleting what a batch exported');

-- The lines downloaded are the same later, even after the source changes.
select pg_temp.eq('a download has every line', (select count(*) from public.journal_batch_lines_for(current_setting('test.batch1')::uuid))::int, (select line_count from public.journal_batches where id = current_setting('test.batch1')::uuid));
select pg_temp.eq('downloading is in the audit log', (select count(*) from public.audit_log where table_name = 'journal_batches' and new_values->>'event' = 'downloaded' and row_id = current_setting('test.batch1'))::int, 1);
select pg_temp.act_as('member');
select pg_temp.expect_error(format($sql$select * from public.journal_batch_lines_for(%L)$sql$, current_setting('test.batch1')), 'could not be found', 'a member downloading a batch');
select pg_temp.eq('a member reads no batch', (select count(*) from public.journal_batches)::int, 0);
select pg_temp.act_as('owner');

-- Voiding an exported purchase invoice puts a reversal in the next batch and not the same one. Voiding one that was
-- never exported leaves it out.
select set_config('test.pi2', pg_temp.vdoc('PI', 'VOD', array[77], '2026-11-12')::text, true);
select public.void_document(current_setting('test.pi2')::uuid, 'Entered twice');
select pg_temp.eq('a document voided before export gives nothing', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1) where source_id = current_setting('test.pi2')::uuid)::int, 0);
select public.void_document(current_setting('test.pi')::uuid, 'Wrong supplier');
select pg_temp.eq('an exported document voided later is reversed with the sides swapped',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.pi')::uuid, current_date + 1)),
  '1300 0.00/46.00; 2100 246.00/0.00; 6000 0.00/200.00');
select pg_temp.eq('the reversal is not in the batch that exported the invoice',
  (select count(*) from public.journal_batch_lines where batch_id = current_setting('test.batch1')::uuid and source_kind like 'reversal%')::int, 0);
select set_config('test.batch2', public.create_journal_batch(current_setting('test.org')::uuid, current_date + 1)::text, true);
select pg_temp.eq('the second batch is number 2', (select number from public.journal_batches where id = current_setting('test.batch2')::uuid), 2);
select pg_temp.eq('the reversal is in the second batch', (select count(*) from public.journal_batch_lines where batch_id = current_setting('test.batch2')::uuid and source_kind = 'reversal of purchase invoice' and journal_number like 'JB-0002-%')::int, 3);
select pg_temp.eq('the first batch is unchanged', (select count(*) from public.journal_batch_lines where batch_id = current_setting('test.batch1')::uuid)::int, (select line_count from public.journal_batches where id = current_setting('test.batch1')::uuid));

-- A payment voided after export is reversed with the exchange difference of its allocation.
select public.void_payment(current_setting('test.gbppay')::uuid, 'Paid twice');
select pg_temp.eq('the payment is reversed', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1) where source_id = current_setting('test.gbppay')::uuid and stage = 'reversal')::int, 2);
select pg_temp.eq('so is the exchange difference of its allocation', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1) where source_id = current_setting('test.gbpalloc')::uuid and stage = 'reversal')::int, 2);
select pg_temp.eq('the reversed exchange loss gives the sides back',
  (select string_agg(account_code || ' ' || debit || '/' || credit, '; ' order by account_code) from pg_temp.lines_of(current_setting('test.gbpalloc')::uuid, current_date + 1)),
  '2100 6.25/0.00; 7900 0.00/6.25');
select set_config('test.batch3', public.create_journal_batch(current_setting('test.org')::uuid, current_date + 1)::text, true);
select pg_temp.eq('numbers keep counting', (select number from public.journal_batches where id = current_setting('test.batch3')::uuid), 3);
select pg_temp.eq('nothing is left waiting', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1))::int, 0);

-- An allocation removed after export has its exchange difference reversed.
select set_config('test.gbp2', pg_temp.vdoc('PI', 'GBPV', array[17], '2026-11-14')::text, true);
select set_config('test.gbppay2', pg_temp.payment('PAY', 'GBPV', 17, true, 0.8, '2026-11-14')::text, true);
select public.allocate(pg_temp.src(current_setting('test.gbppay2')::uuid), current_setting('test.gbp2')::uuid, 17, '2026-11-14');
select set_config('test.gbpalloc2', (select id::text from public.allocations where source_payment_id = current_setting('test.gbppay2')::uuid and removed_at is null), true);
select public.create_journal_batch(current_setting('test.org')::uuid, current_date + 1);
select public.remove_allocation(current_setting('test.gbpalloc2')::uuid, 'Wrong invoice');
select pg_temp.eq('a removed allocation is reversed', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1) where source_id = current_setting('test.gbpalloc2')::uuid and stage = 'reversal')::int, 2);
select public.create_journal_batch(current_setting('test.org')::uuid, current_date + 1);

-- The start date keeps older history out. A late-posted document dated before the last batch goes in the next one.
select set_config('test.late', pg_temp.vdoc('SI', 'ACME', array[11], '2026-11-02')::text, true);
select pg_temp.eq('a late-posted document is included', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1) where source_id = current_setting('test.late')::uuid)::int, 3);
update public.accounting_settings set start_date = '2026-11-10' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('the start date leaves it out', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1) where source_id = current_setting('test.late')::uuid)::int, 0);
update public.accounting_settings set start_date = null where organisation_id = current_setting('test.org')::uuid;

-- An admin can read and export. Another organisation's batches are not visible.
select pg_temp.act_as('admin');
select pg_temp.eq('an admin reads the settings', (select count(*) from public.accounting_settings)::int, 1);
select pg_temp.eq('an admin previews', (select count(distinct source_id) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1))::int, 1);
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider sees no batches', (select count(*) from public.journal_batches)::int, 0);
select pg_temp.eq('an outsider gets no preview', (select count(*) from public.journal_preview(current_setting('test.org')::uuid, current_date + 1))::int, 0);

rollback;
