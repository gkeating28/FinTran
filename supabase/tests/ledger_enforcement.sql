-- Ledger release C, database half: the requirements, the period rules, the mode switch, manual journals and the opening balance
-- journal (QULAPLUS_LEDGER_SPEC.md, phases 6 and 7). Raises on failure and rolls back. It ends with the reconciliation.
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
    raise exception 'ledger enforcement: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ledger enforcement: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'ledger enforcement: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'ledger enforcement: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
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
create function pg_temp.doc(p_type text, p_party text, p_lines jsonb, p_date date default '2026-11-12', p_post boolean default true, p_preceding uuid default null, p_rounding numeric default 0) returns uuid language plpgsql as $$
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
    'roundingAmount', p_rounding,
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

-- Manual journal helpers: a line is a GL code and a debit or a credit.
create function pg_temp.jl(p_code text, p_debit numeric, p_credit numeric default 0, p_dep text default null, p_cc text default null) returns jsonb language sql as $$
  select jsonb_build_object('glCodeId', pg_temp.id_of('gl_codes', p_code), 'debit', p_debit, 'credit', p_credit, 'description', 'Line ' || p_code,
    'departmentId', case when p_dep is not null then pg_temp.id_of('departments', p_dep) end,
    'costCentreId', case when p_cc is not null then pg_temp.id_of('cost_centres', p_cc) end)
$$;
create function pg_temp.mj(p_date date, p_lines jsonb, p_id uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('organisationId', current_setting('test.org')::uuid, 'id', p_id, 'date', p_date, 'description', 'Accrual', 'lines', p_lines)
$$;
grant execute on function pg_temp.jl(text, numeric, numeric, text, text), pg_temp.mj(date, jsonb, uuid) to authenticated;

-- 1. The period rules. With lock_exported on, a posting dated in an exported period is refused, and a void never is.
select set_config('test.inv1', pg_temp.doc('PI', 'VOD', jsonb_build_array(pg_temp.line(100, 'P23', '6000')), '2026-11-10')::text, true);
reset role;
select set_config('fintran.ledger_admin', 'on', true);
update public.organisation_defaults set exported_through = '2026-11-15', lock_exported = true where organisation_id = current_setting('test.org')::uuid;
select set_config('fintran.ledger_admin', 'off', true);
select pg_temp.act_as('owner');
set local role authenticated;
select set_config('test.late', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(50, 'S23', '4000')), '2026-11-14', false)::text, true);
select pg_temp.expect_error(format($sql$select public.post_document(%L, null)$sql$, current_setting('test.late')), 'period that has been exported', 'posting a document into an exported period');
select pg_temp.eq('nothing was made', (select count(*) from public.journal_entries where source_header_id = current_setting('test.late')::uuid)::int, 0);
select pg_temp.expect_error(format($sql$select pg_temp.payment('REC', 'ACME', 10, null, '2026-11-14')$sql$), 'period that has been exported', 'posting a receipt into an exported period');
select set_config('test.ok', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(50, 'S23', '4000')), '2026-11-20')::text, true);
select pg_temp.eq('a date after the export posts', (select count(*) from public.journal_entries where source_header_id = current_setting('test.ok')::uuid)::int, 1);
select public.void_document(current_setting('test.inv1')::uuid, 'Wrong supplier');
select pg_temp.eq('a void is never refused', (select count(*) from public.journal_entries where source_header_id = current_setting('test.inv1')::uuid)::int, 2);
select pg_temp.eq('and an exported period reverses on the day of the void', (select entry_date from public.journal_entries where id = pg_temp.entry_of('document', current_setting('test.inv1')::uuid, true)), current_date);
update public.organisation_defaults set lock_exported = false where organisation_id = current_setting('test.org')::uuid;
select public.post_document(current_setting('test.late')::uuid, null);
select pg_temp.eq('with the lock off it posts', (select count(*) from public.journal_entries where source_header_id = current_setting('test.late')::uuid)::int, 1);
select pg_temp.eq('and the owner is shown it', (select count(*) from public.ledger_exported_postings(current_setting('test.org')::uuid) where source_ref = (select document_number from public.transaction_headers where id = current_setting('test.late')::uuid))::int, 1);
select pg_temp.act_as('member');
select pg_temp.eq('a member is shown nothing', (select count(*) from public.ledger_exported_postings(current_setting('test.org')::uuid))::int, 0);
select pg_temp.act_as('owner');

-- 2. Manual journals.
select count(*) as before_manual from public.journal_entries \gset
select set_config('test.mj1', public.save_manual_journal(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6000', 80, 0, 'OPS', 'HQ'), pg_temp.jl('6100', 20), pg_temp.jl('2200', 0, 100))))::text, true);
select pg_temp.eq('a draft has no number', (select entry_number is null and status = 'draft' from public.journal_entries where id = current_setting('test.mj1')::uuid), true);
select public.post_manual_journal(current_setting('test.mj1')::uuid);
select pg_temp.eq('posting gives the next number', (select entry_number from public.journal_entries where id = current_setting('test.mj1')::uuid), (select max(entry_number) from public.journal_entries where id <> current_setting('test.mj1')::uuid) + 1);
select pg_temp.eq('and a reference', (select source_ref from public.journal_entries where id = current_setting('test.mj1')::uuid), 'JNL-' || (select entry_number from public.journal_entries where id = current_setting('test.mj1')::uuid));
select pg_temp.eq('the dimensions are on the line', (select count(*) from public.journal_lines where entry_id = current_setting('test.mj1')::uuid and department_id is not null and cost_centre_id is not null)::int, 1);
select pg_temp.act_as('member');
select pg_temp.expect_error(format($sql$select public.save_manual_journal(%L::jsonb)$sql$, pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6000', 5), pg_temp.jl('6100', 0, 5)))), 'owner or admin', 'a member saving a journal');
select pg_temp.act_as('admin');
select set_config('test.mj2', public.save_manual_journal(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6000', 5), pg_temp.jl('6100', 0, 5))))::text, true);
select public.post_manual_journal(current_setting('test.mj2')::uuid);
select pg_temp.eq('an admin posts one', (select status from public.journal_entries where id = current_setting('test.mj2')::uuid), 'posted');
select pg_temp.act_as('owner');
select set_config('test.unbal', public.save_manual_journal(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6000', 5), pg_temp.jl('6100', 0, 4))))::text, true);
select pg_temp.expect_error(format($sql$select public.post_manual_journal(%L)$sql$, current_setting('test.unbal')), 'does not balance', 'an unbalanced journal');
select public.save_manual_journal(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6000', 5)), current_setting('test.unbal')::uuid));
select pg_temp.expect_error(format($sql$select public.post_manual_journal(%L)$sql$, current_setting('test.unbal')), 'at least two lines', 'a journal of one line');
select pg_temp.eq('a draft can be changed', (select count(*) from public.journal_lines where entry_id = current_setting('test.unbal')::uuid)::int, 1);
select public.delete_manual_journal(current_setting('test.unbal')::uuid);
select pg_temp.eq('and deleted', (select count(*) from public.journal_entries where id = current_setting('test.unbal')::uuid)::int, 0);
select set_config('test.ctl', public.save_manual_journal(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('1100', 5), pg_temp.jl('6100', 0, 5))))::text, true);
select pg_temp.expect_error(format($sql$select public.post_manual_journal(%L)$sql$, current_setting('test.ctl')), 'control account', 'a journal touching debtors control');
select public.delete_manual_journal(current_setting('test.ctl')::uuid);
select set_config('test.inactive', public.save_manual_journal(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6100', 7), pg_temp.jl('6000', 0, 7))))::text, true);
update public.gl_codes set active = false where id = pg_temp.id_of('gl_codes', '6100');
select pg_temp.expect_error(format($sql$select public.post_manual_journal(%L)$sql$, current_setting('test.inactive')), 'not in use', 'a code that has been made inactive');
select public.delete_manual_journal(current_setting('test.inactive')::uuid);
update public.gl_codes set active = true where id = pg_temp.id_of('gl_codes', '6100');
select pg_temp.expect_error(format($sql$select public.save_manual_journal(%L::jsonb)$sql$, pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6000', 5), pg_temp.jl('6100', 0, 5)), current_setting('test.mj1')::uuid)), 'Only a draft', 'changing a posted journal');
select pg_temp.expect_error(format($sql$select public.delete_manual_journal(%L)$sql$, current_setting('test.mj1')), 'Only a draft', 'deleting a posted journal');
select set_config('test.bankgl', (select gl_code_id::text from public.bank_accounts where code = 'EUR1' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.mj3', public.save_manual_journal(jsonb_set(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('1200', 12), pg_temp.jl('6000', 0, 12))), '{lines,1,glCodeId}', to_jsonb(current_setting('test.bankgl'))))::text, true);
select public.post_manual_journal(current_setting('test.mj3')::uuid);
select pg_temp.eq('a journal may use a bank account and a VAT account', (select status from public.journal_entries where id = current_setting('test.mj3')::uuid), 'posted');
select pg_temp.expect_error(format($sql$select public.reverse_journal(%L, '2026-10-30', null)$sql$, current_setting('test.mj1')), 'on or after', 'reversing before the journal date');
select set_config('test.rev', public.reverse_journal(current_setting('test.mj1')::uuid, '2026-11-01', 'Accrual reversed')::text, true);
select pg_temp.eq('the reversal is dated as asked', (select entry_date from public.journal_entries where id = current_setting('test.rev')::uuid), '2026-11-01'::date);
select pg_temp.eq('and mirrors the lines', (select string_agg(g.code || ' ' || l.debit || '/' || l.credit, '; ' order by g.code) from public.journal_lines l join public.gl_codes g on g.id = l.gl_code_id where l.entry_id = current_setting('test.rev')::uuid),
  '2200 100.00/0.00; 6000 0.00/80.00; 6100 0.00/20.00');
select pg_temp.eq('with the text given', (select description from public.journal_entries where id = current_setting('test.rev')::uuid), 'Accrual reversed');
select pg_temp.expect_error(format($sql$select public.reverse_journal(%L, '2026-11-02', null)$sql$, current_setting('test.mj1')), 'already been reversed', 'reversing twice');
select pg_temp.expect_error(format($sql$select public.reverse_journal(%L, '2026-11-12', null)$sql$, pg_temp.entry_of('document', current_setting('test.ok')::uuid)), 'posted manual journal', 'reversing a document entry by hand');
update public.organisation_defaults set lock_date = '2026-06-30' where organisation_id = current_setting('test.org')::uuid;
select set_config('test.old', public.save_manual_journal(pg_temp.mj('2026-06-15', jsonb_build_array(pg_temp.jl('6000', 5), pg_temp.jl('6100', 0, 5))))::text, true);
select pg_temp.expect_error(format($sql$select public.post_manual_journal(%L)$sql$, current_setting('test.old')), 'locked period', 'a journal inside the lock date');
select public.delete_manual_journal(current_setting('test.old')::uuid);
select pg_temp.eq('the books are clean after manual journals', pg_temp.reconciled(), 'ok');

-- 3. The opening balance journal, and the lock date that must not stop it.
select pg_temp.expect_error(format($sql$select public.post_opening_journal(%L::jsonb)$sql$, pg_temp.mj(null, jsonb_build_array(pg_temp.jl('1200', 500), pg_temp.jl('3200', 0, 500)))), 'go-live date', 'an opening journal with no go-live date');
update public.organisation_defaults set ledger_start_date = '2026-10-01', lock_date = '2026-09-30' where organisation_id = current_setting('test.org')::uuid;
select set_config('test.pre', pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(300, 'S23', '4000')), '2026-09-20')::text, true);
select pg_temp.eq('a document before go-live posts under the lock date', (select count(*) from public.journal_entries where source_header_id = current_setting('test.pre')::uuid)::int, 1);
select pg_temp.expect_error(format($sql$select public.post_opening_journal(%L::jsonb)$sql$, pg_temp.mj(null, jsonb_build_array(pg_temp.jl('1100', 500), pg_temp.jl('3200', 0, 500)))), 'control account', 'an opening journal touching debtors control');
select pg_temp.eq('that left nothing behind', (select count(*) from public.journal_entries where is_opening)::int, 0);
select set_config('test.open', public.post_opening_journal(pg_temp.mj(null, jsonb_build_array(pg_temp.jl('1200', 500), pg_temp.jl('3200', 0, 500))))::text, true);
select pg_temp.eq('it is dated the day before go-live', (select entry_date from public.journal_entries where id = current_setting('test.open')::uuid), '2026-09-30'::date);
select pg_temp.eq('and is flagged and numbered', (select is_opening and entry_number is not null and status = 'posted' from public.journal_entries where id = current_setting('test.open')::uuid), true);
select pg_temp.expect_error(format($sql$select public.post_opening_journal(%L::jsonb)$sql$, pg_temp.mj(null, jsonb_build_array(pg_temp.jl('1200', 5), pg_temp.jl('3200', 0, 5)))), 'already been posted', 'a second opening journal');
select pg_temp.expect_error(format($sql$select public.reverse_journal(%L, '2026-10-05', null)$sql$, current_setting('test.open')), 'cannot be reversed', 'reversing the opening journal');
select pg_temp.expect_error(format($sql$update public.organisation_defaults set ledger_start_date = '2026-10-02' where organisation_id = %L$sql$, current_setting('test.org')), 'cannot change', 'moving go-live after the opening journal');
select pg_temp.expect_error(format($sql$select pg_temp.doc('SI', 'ACME', jsonb_build_array(pg_temp.line(10, 'S23', '4000')), '2026-09-21')$sql$), 'locked', 'a document before go-live once the opening journal is posted');

-- 4. The mode switch.
select pg_temp.act_as('member');
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'feed', 'x')$sql$, current_setting('test.org')), 'Only an owner', 'a member switching the mode');
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'feed', 'x')$sql$, current_setting('test.org')), 'Only an owner', 'an admin switching the mode');
update public.organisation_defaults set lock_exported = true where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('an admin changes the lock setting', (select lock_exported from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), true);
select pg_temp.act_as('owner');
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'feed', '  ')$sql$, current_setting('test.org')), 'reason', 'a switch with no reason');
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'book', 'again')$sql$, current_setting('test.org')), 'already', 'switching to the mode it is in');
select set_config('test.draftj', public.save_manual_journal(pg_temp.mj('2026-10-31', jsonb_build_array(pg_temp.jl('6000', 5), pg_temp.jl('6100', 0, 5))))::text, true);
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'feed', 'Moving to the accountant')$sql$, current_setting('test.org')), 'draft manual journals', 'to feed with a draft journal');
select public.delete_manual_journal(current_setting('test.draftj')::uuid);
update public.organisation_defaults set lock_date = null where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'feed', 'Moving to the accountant')$sql$, current_setting('test.org')), 'lock date', 'to feed with no lock date');
update public.organisation_defaults set lock_date = '2026-09-30' where organisation_id = current_setting('test.org')::uuid;
select public.set_ledger_mode(current_setting('test.org')::uuid, 'feed', 'Moving to the accountant');
select pg_temp.eq('the mode changed', (select ledger_mode from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), 'feed');
update public.organisation_defaults set lock_date = '2026-10-05' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'book', 'Back')$sql$, current_setting('test.org')), 'after the day before go-live', 'to book with a lock date after go-live');
update public.organisation_defaults set lock_date = '2026-09-30' where organisation_id = current_setting('test.org')::uuid;
select public.set_ledger_mode(current_setting('test.org')::uuid, 'book', 'Back to the book of record');
select pg_temp.eq('and back again', (select ledger_mode from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), 'book');
reset role;
select pg_temp.eq('both changes are in the history with their reasons', (select string_agg(new_values->>'reason', '; ' order by id) from public.audit_log
  where organisation_id = current_setting('test.org')::uuid and table_name = 'organisation_defaults' and new_values->>'event' = 'ledger_mode_changed'), 'Moving to the accountant; Back to the book of record');
select pg_temp.eq('the opening journal was not waived', (select (new_values->>'opening_journal_waived')::boolean from public.audit_log
  where organisation_id = current_setting('test.org')::uuid and new_values->>'to' = 'book' and new_values->>'event' = 'ledger_mode_changed'), false);
select pg_temp.act_as('owner');
set local role authenticated;

-- Going to book with no opening journal needs the go-live date, and the reason is the recorded waiver.
select set_config('test.org2', (public.create_tenant('Second Books', 'Second Office'))->>'organisation_id', true);
select pg_temp.eq('a new organisation is a book of record', (select ledger_mode from public.organisation_defaults where organisation_id = current_setting('test.org2')::uuid), 'book');
reset role;
select set_config('fintran.ledger_admin', 'on', true);
update public.organisation_defaults set ledger_mode = 'feed' where organisation_id = current_setting('test.org2')::uuid;
select set_config('fintran.ledger_admin', 'off', true);
select pg_temp.act_as('owner');
set local role authenticated;
select pg_temp.expect_error(format($sql$select public.set_ledger_mode(%L, 'book', 'Starting fresh')$sql$, current_setting('test.org2')), 'go-live date', 'to book with no go-live date');
update public.organisation_defaults set ledger_start_date = '2026-10-01' where organisation_id = current_setting('test.org2')::uuid;
select public.set_ledger_mode(current_setting('test.org2')::uuid, 'book', 'A new company with nothing to bring forward');
reset role;
select pg_temp.eq('no opening journal is a recorded waiver', (select (new_values->>'opening_journal_waived')::boolean from public.audit_log
  where organisation_id = current_setting('test.org2')::uuid and new_values->>'event' = 'ledger_mode_changed'), true);
select pg_temp.act_as('owner');
set local role authenticated;

select pg_temp.eq('the books are clean at the end', pg_temp.reconciled(), 'ok');

rollback;
select 'ledger enforcement ok';
