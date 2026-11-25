-- Ledger release B: posting documents, payments and allocations, the backfill and the reconciliation (QULAPLUS_LEDGER_SPEC.md,
-- phases 3 to 5). Raises on failure and rolls back. Every part ends with the reconciliation.
begin;

create temp table lp_users (who text primary key, id uuid not null);
insert into lp_users (who, id) values
  ('owner', '11a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  ('admin', '22b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'),
  ('member', '33c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-posting@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who) from lp_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from lp_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ledger posting: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ledger posting: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'ledger posting: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'ledger posting: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;
grant all on table lp_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.eq(text, anyelement, anyelement), pg_temp.expect_error(text, text, text) to authenticated;

-- Posting a payment, the way post_payment does it.
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
select set_config('test.org', (public.create_tenant('Posting Books', 'Posting Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-posting@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-posting@fintran.test', 'member');

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'GBP', 'Pound sterling', 0.85) on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000', 'Sales', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4100', 'Other sales', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6100', 'Stationery', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Sales 23', 23, 'Sales', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S135', 'Sales 13.5', 13.5, 'Sales', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'Z0', 'Zero sales', 0, 'Sales', 'Z'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Purchases 23', 23, 'Expense', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PZ', 'Zero purchases', 0, 'Expense', 'Z');
insert into public.departments (tenant_id, organisation_id, code, description) values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'OPS', 'Operations');
insert into public.cost_centres (tenant_id, organisation_id, code, description) values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'HQ', 'Head office');
update public.organisation_defaults set address_line1 = 'Dock 1', city = 'Dublin', vat_number = 'IE1234567T', peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (tenant_id, organisation_id, code, name, currency_id, address_line1, city, vat_number, peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.name, c.id, '1 Quay', 'Dublin', 'IE7654321A', '9935', v.peppol, 'PO-1', 0
from (values ('ACME', 'Acme', 'EUR', 'IE7654321A'), ('GBPCO', 'Sterling customer', 'GBP', 'IE7654323C')) as v(code, name, cur, peppol)
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
create function pg_temp.role_id(p_role text) returns uuid language sql as
  $$ select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role = p_role $$;

-- A line: description, quantity, price, VAT code, GL code, department, cost centre.
create function pg_temp.line(p_price numeric, p_vat text, p_gl text default null, p_dep text default null, p_cc text default null, p_qty numeric default 1) returns jsonb language sql as $$
  select jsonb_build_object('description', 'Goods', 'quantity', p_qty, 'price', p_price,
    'vatRateId', pg_temp.id_of('vat_rates', p_vat), 'glCodeId', case when p_gl is not null then pg_temp.id_of('gl_codes', p_gl) end,
    'departmentId', case when p_dep is not null then pg_temp.id_of('departments', p_dep) end,
    'costCentreId', case when p_cc is not null then pg_temp.id_of('cost_centres', p_cc) end)
$$;
-- A document of the given lines for a party. Sales types are for customers, Purchases types for suppliers.
create function pg_temp.doc(p_type text, p_party text, p_lines jsonb, p_date date default '2026-11-12', p_post boolean default true, p_preceding uuid default null) returns uuid language plpgsql as $$
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
    'transactionDate', p_date, 'dueDate', p_date,
    'currencyId', pg_temp.id_of('currencies', v_currency), 'exchangeRate', case when v_currency = 'GBP' then 0.85 else 1 end,
    'precedingHeaderId', p_preceding, 'precedingReference', case when p_preceding is not null then 'INV' end, 'precedingDate', case when p_preceding is not null then p_date end,
    'lines', p_lines));
  if p_post then
    perform public.post_document(v_id, null);
  end if;
  return v_id;
end $$;
create function pg_temp.payment(p_type text, p_party text, p_amount numeric, p_rate numeric default null, p_date date default '2026-11-12', p_post boolean default true) returns uuid language plpgsql as $$
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
  if p_post then perform pg_temp.post(v_id); end if;
  return v_id;
end $$;
create function pg_temp.src(p_payment uuid) returns jsonb language sql as $$ select jsonb_build_object('paymentId', p_payment) $$;

-- The lines of a source's entry, as text: code debit/credit, sorted.
create function pg_temp.lines_of(p_entry uuid) returns text language sql as $$
  select string_agg(g.code || ' ' || l.debit || '/' || l.credit, '; ' order by g.code, l.debit, l.credit)
  from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = p_entry
$$;
create function pg_temp.entry_of(p_source text, p_id uuid, p_reversal boolean default false) returns uuid language sql as $$
  select id from public.journal_entries
  where organisation_id = current_setting('test.org')::uuid
    and case when p_reversal then source_type = 'reversal' else source_type = p_source end
    and case p_source when 'document' then source_header_id when 'payment' then source_payment_id else source_allocation_id end = p_id
$$;
create function pg_temp.balance_of(p_code text, p_party text default null) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id
  where l.organisation_id = current_setting('test.org')::uuid and g.code = p_code
    and (p_party is null or l.customer_id = pg_temp.id_of('customers', p_party) or l.supplier_id = pg_temp.id_of('suppliers', p_party))
$$;
create function pg_temp.reconciled() returns text language sql as $$
  select coalesce(string_agg(check_name || ' ' || difference, ', '), 'ok') from public.ledger_reconciliation(current_setting('test.org')::uuid) where difference <> 0
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- 1. A sales invoice: debtors, income and VAT.
select set_config('test.si1', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(1000, 'S23', '4000')))::text, true);
select pg_temp.eq('sales invoice', pg_temp.lines_of(pg_temp.entry_of('document', current_setting('test.si1')::uuid)), '1100 1230.00/0.00; 2200 0.00/230.00; 4000 0.00/1000.00');
select pg_temp.eq('the entry is dated the document date', (select entry_date from public.journal_entries where id = pg_temp.entry_of('document', current_setting('test.si1')::uuid)), '2026-11-12'::date);
select pg_temp.eq('and carries the number and the party', (select source_ref || ' ' || (select count(*) from public.journal_lines where entry_id = e.id and customer_id is not null)::text from public.journal_entries e where e.id = pg_temp.entry_of('document', current_setting('test.si1')::uuid)), 'INV-00001 2');
select pg_temp.eq('the VAT line says what it is',
  (select vat_category || ' ' || vat_percentage || ' ' || vat_taxable_home from public.journal_lines where entry_id = pg_temp.entry_of('document', current_setting('test.si1')::uuid) and vat_category is not null), 'S 23.00 1000.00');

-- 2. A purchase invoice with two lines on different codes and dimensions.
select set_config('test.pi1', pg_temp.doc('PI', 'VOD', jsonb_build_array(pg_temp.line(200, 'P23', '6000', 'OPS', 'HQ'), pg_temp.line(50, 'P23', '6100')))::text, true);
select pg_temp.eq('purchase invoice', pg_temp.lines_of(pg_temp.entry_of('document', current_setting('test.pi1')::uuid)), '1200 57.50/0.00; 2100 0.00/307.50; 6000 200.00/0.00; 6100 50.00/0.00');
select pg_temp.eq('dimensions go with the GL line only',
  (select count(*) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id
   where l.entry_id = pg_temp.entry_of('document', current_setting('test.pi1')::uuid) and ((g.code = '6000' and l.department_id is not null and l.cost_centre_id is not null)
     or (g.code <> '6000' and l.department_id is null and l.cost_centre_id is null)))::int, 4);

-- 3. Two VAT rates make two VAT lines.
select set_config('test.si2', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(100, 'S23', '4000'), pg_temp.line(200, 'S135', '4100')))::text, true);
select pg_temp.eq('two VAT lines', (select string_agg(vat_category || ' ' || vat_percentage || ' ' || vat_taxable_home || ' ' || credit, '; ' order by vat_percentage)
  from public.journal_lines where entry_id = pg_temp.entry_of('document', current_setting('test.si2')::uuid) and vat_category is not null), 'S 13.50 200.00 27.00; S 23.00 100.00 23.00');

-- 4. A sterling invoice posts in euro and balances.
select set_config('test.gbp1', pg_temp.doc('SI', 'GBPCO', jsonb_build_array(pg_temp.line(100, 'S23', '4000')))::text, true);
select pg_temp.eq('the debtors line is the header home total',
  (select l.debit from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('document', current_setting('test.gbp1')::uuid) and g.code = '1100'),
  (select home_total_amount from public.transaction_headers where id = current_setting('test.gbp1')::uuid));
select pg_temp.eq('the foreign amounts are in sterling', (select foreign_amount from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('document', current_setting('test.gbp1')::uuid) and g.code = '1100'), 123.00);
select pg_temp.eq('and so is the rate', (select exchange_rate from public.journal_lines where entry_id = pg_temp.entry_of('document', current_setting('test.gbp1')::uuid) limit 1), 0.85::numeric);

-- 5. Three lines whose home figures do not divide evenly still balance.
select set_config('test.gbp3', pg_temp.doc('SI', 'GBPCO', jsonb_build_array(pg_temp.line(0.10, 'Z0', '4000'), pg_temp.line(0.10, 'Z0', '4000'), pg_temp.line(0.10, 'Z0', '4000')))::text, true);
select pg_temp.eq('the lines add up to the header home nett',
  (select sum(l.credit) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('document', current_setting('test.gbp3')::uuid) and g.code = '4000'),
  (select home_nett_amount from public.transaction_headers where id = current_setting('test.gbp3')::uuid));
select pg_temp.eq('the cents go to the first lines', (select string_agg(l.credit::text, ' ' order by l.line_number) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('document', current_setting('test.gbp3')::uuid) and g.code = '4000'), '0.12 0.12 0.11');

-- 6. A line with no GL code goes to suspense, and is listed.
select set_config('test.nogl', pg_temp.doc('PI', 'VOD', jsonb_build_array(pg_temp.line(40, 'PZ')))::text, true);
select pg_temp.eq('no GL code posts to suspense', pg_temp.lines_of(pg_temp.entry_of('document', current_setting('test.nogl')::uuid)), '2100 0.00/40.00; 9990 40.00/0.00');
select pg_temp.eq('and says so', (select l.description from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('document', current_setting('test.nogl')::uuid) and g.code = '9990'), 'Goods (no GL code)');
select pg_temp.eq('and is on the review list', (select count(*) from public.ledger_suspense_lines(current_setting('test.org')::uuid))::int, 1);

-- 7. A document worth nothing makes no entry. Orders and drafts make none either.
select set_config('test.free', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(0, 'Z0', '4000')))::text, true);
select pg_temp.eq('a free document has no entry', (select count(*) from public.journal_entries where source_header_id = current_setting('test.free')::uuid)::int, 0);
select count(*) as before_drafts from public.journal_entries \gset
select set_config('test.draft', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(77, 'Z0', '4000')), '2026-11-12', false)::text, true);
select set_config('test.order', pg_temp.doc('SO', 'ACME', jsonb_build_array(pg_temp.line(88, 'Z0', '4000')), '2026-11-12', false)::text, true);
select public.set_order_status(current_setting('test.order')::uuid, 'open');
select pg_temp.eq('drafts and orders make no entries', (select count(*) from public.journal_entries)::int, :before_drafts);

-- 8. Voiding. In an open, unexported period the reversal has the document's date. In an exported one it has the day of the void.
select public.void_document(current_setting('test.pi1')::uuid, 'Wrong supplier');
select pg_temp.eq('an exact reversal', pg_temp.lines_of(pg_temp.entry_of('document', current_setting('test.pi1')::uuid, true)), '1200 0.00/57.50; 2100 307.50/0.00; 6000 0.00/200.00; 6100 0.00/50.00');
select pg_temp.eq('dated the invoice date', (select entry_date from public.journal_entries where id = pg_temp.entry_of('document', current_setting('test.pi1')::uuid, true)), '2026-11-12'::date);
select pg_temp.eq('it says which entry it reverses', (select reverses_entry_id from public.journal_entries where id = pg_temp.entry_of('document', current_setting('test.pi1')::uuid, true)), pg_temp.entry_of('document', current_setting('test.pi1')::uuid));
select set_config('test.pi2', pg_temp.doc('PI', 'VOD', jsonb_build_array(pg_temp.line(10, 'PZ', '6000')), '2026-11-10')::text, true);
reset role;
select set_config('fintran.ledger_admin', 'on', true);
update public.organisation_defaults set exported_through = '2026-11-15' where organisation_id = current_setting('test.org')::uuid;
select set_config('fintran.ledger_admin', 'off', true);
select pg_temp.act_as('owner');
set local role authenticated;
select public.void_document(current_setting('test.pi2')::uuid, 'Exported already');
select pg_temp.eq('an exported period reverses on the void date', (select entry_date from public.journal_entries where id = pg_temp.entry_of('document', current_setting('test.pi2')::uuid, true)), current_date);
select pg_temp.eq('the books are clean after documents', pg_temp.reconciled(), 'ok');

-- 9. A credit note posts once, and applying it to its invoice makes no second entry.
select set_config('test.cn', pg_temp.doc('SC', 'ACME', jsonb_build_array(pg_temp.line(100, 'S23', '4000')), '2026-11-13', true, current_setting('test.si1')::uuid)::text, true);
select pg_temp.eq('a sales credit note is the mirror', pg_temp.lines_of(pg_temp.entry_of('document', current_setting('test.cn')::uuid)), '1100 0.00/123.00; 2200 23.00/0.00; 4000 100.00/0.00');
select pg_temp.eq('one entry', (select count(*) from public.journal_entries where source_header_id = current_setting('test.cn')::uuid)::int, 1);
select pg_temp.eq('the books are clean after a credit note', pg_temp.reconciled(), 'ok');

-- 10. Payments, receipts and refunds.
select set_config('test.rec1', pg_temp.payment('REC', 'ACME', 1230)::text, true);
select pg_temp.eq('a customer receipt', pg_temp.lines_of(pg_temp.entry_of('payment', current_setting('test.rec1')::uuid)),
  (select '1100 0.00/1230.00; ' || b.code || ' 1230.00/0.00' from public.bank_accounts ba join public.gl_codes b on b.id = ba.gl_code_id where ba.organisation_id = current_setting('test.org')::uuid and ba.code = 'EUR1' limit 1) );
select set_config('test.pay1', pg_temp.payment('PAY', 'VOD', 40)::text, true);
select pg_temp.eq('a supplier payment debits creditors', (select string_agg(g.code || ' ' || l.debit || '/' || l.credit, '; ' order by g.code) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('payment', current_setting('test.pay1')::uuid) and g.code = '2100'), '2100 40.00/0.00');
select set_config('test.cref1', pg_temp.payment('CREF', 'ACME', 25)::text, true);
select pg_temp.eq('a customer refund debits debtors', (select l.debit from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('payment', current_setting('test.cref1')::uuid) and g.code = '1100'), 25.00);
select set_config('test.sref1', pg_temp.payment('SREF', 'VOD', 15)::text, true);
select pg_temp.eq('a supplier refund credits creditors', (select l.credit from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('payment', current_setting('test.sref1')::uuid) and g.code = '2100'), 15.00);
select pg_temp.eq('the books are clean after payments', pg_temp.reconciled(), 'ok');

-- 11. The worked example: a sterling invoice at 0.85 and a receipt at 0.86.
select set_config('test.fx', pg_temp.doc('SI', 'GBPCO', jsonb_build_array(pg_temp.line(100, 'Z0', '4000')), '2026-11-14')::text, true);
select pg_temp.eq('the invoice posts debtors 117.65', (select l.debit from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('document', current_setting('test.fx')::uuid) and g.code = '1100'), 117.65);
select set_config('test.fxrec', pg_temp.payment('REC', 'GBPCO', 100, 0.86, '2026-11-15', false)::text, true);
select public.replace_pending_allocations(current_setting('test.fxrec')::uuid, jsonb_build_array(jsonb_build_object('targetHeaderId', current_setting('test.fx')::uuid, 'amount', 100)));
select pg_temp.post(current_setting('test.fxrec')::uuid);
select pg_temp.eq('the receipt credits debtors 116.28', (select l.credit from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = pg_temp.entry_of('payment', current_setting('test.fxrec')::uuid) and g.code = '1100'), 116.28);
select set_config('test.fxalloc', (select id::text from public.allocations where source_payment_id = current_setting('test.fxrec')::uuid and removed_at is null), true);
select pg_temp.eq('the allocation has a loss', (select exchange_difference from public.allocations where id = current_setting('test.fxalloc')::uuid), -1.37);
select pg_temp.eq('the exchange entry', pg_temp.lines_of(pg_temp.entry_of('allocation', current_setting('test.fxalloc')::uuid)), '1100 0.00/1.37; 7900 1.37/0.00');
select pg_temp.eq('the customer owes nothing', pg_temp.balance_of('1100', 'GBPCO') - (select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where g.code = '1100' and l.customer_id = pg_temp.id_of('customers', 'GBPCO') and l.entry_id in (select id from public.journal_entries where source_header_id = current_setting('test.gbp1')::uuid or source_header_id = current_setting('test.gbp3')::uuid)), 0.00);
select pg_temp.eq('the books are clean after the worked example', pg_temp.reconciled(), 'ok');

-- 12. Removing the allocation reverses its entry. A same-currency allocation makes none.
select public.remove_allocation(current_setting('test.fxalloc')::uuid, 'Wrong invoice');
select pg_temp.eq('the allocation is reversed', pg_temp.lines_of(pg_temp.entry_of('allocation', current_setting('test.fxalloc')::uuid, true)), '1100 1.37/0.00; 7900 0.00/1.37');
select count(*) as before_alloc from public.journal_entries \gset
select public.allocate(pg_temp.src(current_setting('test.rec1')::uuid), current_setting('test.si1')::uuid, 100, null);
select pg_temp.eq('a same-currency allocation posts nothing', (select count(*) from public.journal_entries)::int, :before_alloc);

-- 13. The same figures on the purchase side are a gain.
select set_config('test.fxp', pg_temp.doc('PI', 'GBPV', jsonb_build_array(pg_temp.line(100, 'PZ', '6000')), '2026-11-14')::text, true);
select set_config('test.fxpay', pg_temp.payment('PAY', 'GBPV', 100, 0.86, '2026-11-15', false)::text, true);
select public.replace_pending_allocations(current_setting('test.fxpay')::uuid, jsonb_build_array(jsonb_build_object('targetHeaderId', current_setting('test.fxp')::uuid, 'amount', 100)));
select pg_temp.post(current_setting('test.fxpay')::uuid);
select set_config('test.fxpalloc', (select id::text from public.allocations where source_payment_id = current_setting('test.fxpay')::uuid and removed_at is null), true);
select pg_temp.eq('a gain', (select exchange_difference from public.allocations where id = current_setting('test.fxpalloc')::uuid), 1.37);
select pg_temp.eq('the exchange entry for a gain', pg_temp.lines_of(pg_temp.entry_of('allocation', current_setting('test.fxpalloc')::uuid)), '2100 1.37/0.00; 7900 0.00/1.37');
select pg_temp.eq('the supplier is owed nothing', (select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where g.code = '2100' and l.supplier_id = pg_temp.id_of('suppliers', 'GBPV')), 0.00);

-- 14. Voiding a payment reverses its entry and the exchange entries of its allocations.
select public.void_payment(current_setting('test.fxpay')::uuid, 'Paid twice');
select pg_temp.eq('the payment is reversed', (select count(*) from public.journal_entries where source_payment_id = current_setting('test.fxpay')::uuid and source_type = 'reversal')::int, 1);
select pg_temp.eq('and so is the exchange entry', (select count(*) from public.journal_entries where source_allocation_id = current_setting('test.fxpalloc')::uuid and source_type = 'reversal')::int, 1);
select pg_temp.eq('the supplier balance is back', (select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where g.code = '2100' and l.supplier_id = pg_temp.id_of('suppliers', 'GBPV')), 117.65);
select pg_temp.eq('the books are clean after reversals', pg_temp.reconciled(), 'ok');

-- 15. Entry numbers follow posting order with no repeat, and a member sees no ledger.
select pg_temp.eq('numbers are consecutive', (select count(*) = max(entry_number) and count(distinct entry_number) = count(*) from public.journal_entries where organisation_id = current_setting('test.org')::uuid), true);
select pg_temp.act_as('member');
select pg_temp.eq('a member gets no reconciliation', (select count(*) from public.ledger_reconciliation(current_setting('test.org')::uuid))::int, 0);
select pg_temp.eq('a member gets no review list', (select count(*) from public.ledger_suspense_lines(current_setting('test.org')::uuid))::int, 0);
select pg_temp.expect_error(format($sql$select public.ledger_backfill(%L)$sql$, current_setting('test.org')), 'owner or admin', 'a member backfilling');
select pg_temp.act_as('admin');
select pg_temp.eq('an admin reads the reconciliation', (select count(*) > 0 from public.ledger_reconciliation(current_setting('test.org')::uuid)), true);
select pg_temp.act_as('owner');


-- 16. The backfill. Documents, payments and allocations posted before the ledger existed are made up, in date order, once.
reset role;
alter table public.transaction_headers disable trigger zz_ledger_post;
alter table public.payments disable trigger zz_ledger_post;
alter table public.allocations disable trigger zz_ledger_post;
select pg_temp.act_as('owner');
set local role authenticated;
select count(*) as entries_before from public.journal_entries \gset
select max(entry_number) as last_number from public.journal_entries where organisation_id = current_setting('test.org')::uuid \gset

select set_config('test.l1', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(200, 'S23', '4000')), '2026-10-05')::text, true);
select set_config('test.l2', pg_temp.doc('PI', 'VOD', jsonb_build_array(pg_temp.line(300, 'PZ', '6000')), '2026-10-06')::text, true);
select public.void_document(current_setting('test.l2')::uuid, 'Wrong supplier');
select set_config('test.l3', pg_temp.doc('PI', 'VOD', jsonb_build_array(pg_temp.line(55, 'PZ')), '2026-10-07')::text, true);
select set_config('test.l4', pg_temp.payment('REC', 'ACME', 246, null, '2026-10-08')::text, true);
select set_config('test.g1', pg_temp.doc('SI', 'GBPCO', jsonb_build_array(pg_temp.line(100, 'Z0', '4000')), '2026-10-09')::text, true);
select set_config('test.r1', pg_temp.payment('REC', 'GBPCO', 100, 0.86, '2026-10-10', false)::text, true);
select public.replace_pending_allocations(current_setting('test.r1')::uuid, jsonb_build_array(jsonb_build_object('targetHeaderId', current_setting('test.g1')::uuid, 'amount', 100)));
select pg_temp.post(current_setting('test.r1')::uuid);
select set_config('test.g2', pg_temp.doc('SI', 'GBPCO', jsonb_build_array(pg_temp.line(100, 'Z0', '4000')), '2026-10-11')::text, true);
select set_config('test.r2', pg_temp.payment('REC', 'GBPCO', 100, 0.86, '2026-10-12', false)::text, true);
select public.replace_pending_allocations(current_setting('test.r2')::uuid, jsonb_build_array(jsonb_build_object('targetHeaderId', current_setting('test.g2')::uuid, 'amount', 100)));
select pg_temp.post(current_setting('test.r2')::uuid);
select public.remove_allocation((select id from public.allocations where source_payment_id = current_setting('test.r2')::uuid and removed_at is null), 'Wrong invoice');
select set_config('test.l6', pg_temp.payment('PAY', 'VOD', 30, null, '2026-10-13')::text, true);
select public.void_payment(current_setting('test.l6')::uuid, 'Paid twice');
select pg_temp.eq('nothing was posted to the ledger while the triggers were off', (select count(*) from public.journal_entries)::int, :entries_before);
-- An earlier journal batch sent all of it on.
select public.create_journal_batch(current_setting('test.org')::uuid, '2026-12-31');
select pg_temp.eq('the batch exported rows', (select count(*) > 0 from public.journal_exports where organisation_id = current_setting('test.org')::uuid), true);

reset role;
alter table public.transaction_headers enable trigger zz_ledger_post;
alter table public.payments enable trigger zz_ledger_post;
alter table public.allocations enable trigger zz_ledger_post;
update public.organisation_defaults set lock_date = '2026-10-31' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.act_as('owner');
set local role authenticated;

-- A document whose home figures do not add up stops the backfill and changes nothing.
reset role;
set local session_replication_role = replica;
update public.transaction_headers set home_vat_amount = home_vat_amount + 1 where id = current_setting('test.l1')::uuid;
set local session_replication_role = origin;
select pg_temp.act_as('owner');
set local role authenticated;
select pg_temp.expect_error(format($sql$select public.ledger_backfill(%L)$sql$, current_setting('test.org')), 'looked at', 'a document whose figures do not add up');
select pg_temp.eq('nothing was made', (select count(*) from public.journal_entries)::int, :entries_before);
reset role;
set local session_replication_role = replica;
update public.transaction_headers set home_vat_amount = home_vat_amount - 1 where id = current_setting('test.l1')::uuid;
set local session_replication_role = origin;
select pg_temp.act_as('owner');
set local role authenticated;

select public.ledger_backfill(current_setting('test.org')::uuid) as summary \gset
select pg_temp.eq('what was posted', :'summary'::text, '11 entries posted and 3 reversals');
select pg_temp.eq('every backfilled entry is marked', (select count(*) from public.journal_entries where backfilled)::int, 14);
select pg_temp.eq('entries before the lock date are there', (select count(*) from public.journal_entries where backfilled and entry_date <= '2026-10-31')::int, 11);
select pg_temp.eq('the numbers follow the dates', (select bool_and(entry_date >= previous) from (select entry_date, lag(entry_date) over (order by entry_number) as previous
  from public.journal_entries where backfilled) as e where previous is not null), true);
select pg_temp.eq('and continue the sequence', (select min(entry_number) from public.journal_entries where backfilled), (:last_number + 1)::bigint);
select pg_temp.eq('a reversal of a void takes the day it was voided', (select entry_date from public.journal_entries where id = pg_temp.entry_of('document', current_setting('test.l2')::uuid, true)), current_date);
select pg_temp.eq('lines with no GL code are on suspense and listed', (select count(*) from public.ledger_suspense_lines(current_setting('test.org')::uuid))::int, 2);
select pg_temp.eq('the exported rows know their entries', (select count(*) from public.journal_exports where organisation_id = current_setting('test.org')::uuid and entry_id is null)::int, 0);
select pg_temp.eq('exported through is the batch date', (select exported_through from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), '2026-12-31'::date);
select pg_temp.eq('running it again makes nothing', public.ledger_backfill(current_setting('test.org')::uuid), '0 entries posted and 0 reversals');
select pg_temp.eq('every posted source has one entry', (select count(*) from public.journal_entries where source_header_id in
  (current_setting('test.l1')::uuid, current_setting('test.l3')::uuid, current_setting('test.g1')::uuid, current_setting('test.g2')::uuid) and source_type = 'document')::int, 4);
select pg_temp.eq('the books are clean after the backfill', pg_temp.reconciled(), 'ok');

rollback;
