-- Payments release B, phase 5: the migration of typed paid amounts, and nobody typing one afterwards. Raises on failure and rolls back.
-- It runs the migration file itself against documents made to look the way they did before.
begin;

create temp table mg_users (who text primary key, id uuid not null);
insert into mg_users (who, id) values
  ('owner', 'abababab-abab-4bab-8bab-abababababab'),
  ('member', 'cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb'),
  ('outsider', 'dcdcdcdc-dcdc-4cdc-8cdc-dcdcdcdcdcdc');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-migr@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from mg_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from mg_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'migration: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'migration: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'migration: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'migration: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

grant all on table mg_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text), pg_temp.eq(text, anyelement, anyelement) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;

select set_config('test.org', (public.create_tenant('Allocation Books', 'Allocation Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Allocation Second', 'EUR'))::text, true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-migr@fintran.test', 'member');

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

create function pg_temp.due(p_header uuid) returns numeric language sql as $$ select amount_due from public.transaction_headers where id = p_header $$;
create function pg_temp.paid(p_header uuid) returns numeric language sql as $$ select paid_amount from public.transaction_headers where id = p_header $$;
grant execute on function pg_temp.id_of(text, text), pg_temp.document(text, text, numeric, date, date, uuid, boolean),
  pg_temp.due(uuid), pg_temp.paid(uuid) to authenticated;


-- Documents of every kind, as they stood.
select set_config('test.si_part', pg_temp.document('SI', 'ACME', 1000)::text, true);
select set_config('test.pi_full', pg_temp.document('PI', 'VOD', 500, '2026-11-03')::text, true);
select set_config('test.over', pg_temp.document('SI', 'ACME', 100, '2026-11-04')::text, true);
select set_config('test.gbp', pg_temp.document('SI', 'GBPCO', 100, '2026-11-05')::text, true);
select set_config('test.untouched', pg_temp.document('SI', 'ACME', 75, '2026-11-06')::text, true);
select set_config('test.void_pi', pg_temp.document('PI', 'VOD', 90, '2026-11-07')::text, true);
select set_config('test.draft', pg_temp.document('SI', 'ACME', 60, '2026-11-08', null, null, false)::text, true);
-- A sales credit note and a purchase credit note, each against an invoice that is already paid, so each stays open.
select set_config('test.si_paid', pg_temp.document('SI', 'ACME', 200, '2026-11-09')::text, true);
select set_config('test.pi_paid', pg_temp.document('PI', 'VOD', 200, '2026-11-09')::text, true);
select set_config('test.sc', pg_temp.document('SC', 'ACME', 50, '2026-11-10', null, current_setting('test.si_paid')::uuid)::text, true);
select set_config('test.pc', pg_temp.document('PC', 'VOD', 40, '2026-11-10', null, current_setting('test.pi_paid')::uuid)::text, true);

select set_config('test.void_pi_id', current_setting('test.void_pi'), true);
select public.void_document(current_setting('test.void_pi')::uuid, 'Entered twice');

-- Now the world as it was before payments: no allocations, and a typed paid amount on some posted documents.
reset role;
alter table public.transaction_headers drop constraint transaction_headers_draft_unpaid;
alter table public.allocations disable trigger user;
alter table public.transaction_headers disable trigger user;
delete from public.allocations where organisation_id = current_setting('test.org')::uuid;
update public.transaction_headers
set paid_amount = 0, amount_due = round(foreign_total_amount + rounding_amount, 2), home_amount_due = home_total_amount
where organisation_id = current_setting('test.org')::uuid and status in ('posted', 'void', 'draft');

create function pg_temp.legacy(p_header text, p_paid numeric) returns void language plpgsql as $$
begin
  update public.transaction_headers
  set paid_amount = p_paid, amount_due = round(foreign_total_amount + rounding_amount - p_paid, 2)
  where id = current_setting(p_header)::uuid;
end $$;
select pg_temp.legacy('test.si_part', 400);        -- part paid
select pg_temp.legacy('test.pi_full', 500);        -- paid in full
select pg_temp.legacy('test.over', 130);           -- paid more than its total
select pg_temp.legacy('test.gbp', 40);             -- sterling, at rate 0.85
select pg_temp.legacy('test.si_paid', 200);        -- paid, then credited
select pg_temp.legacy('test.pi_paid', 200);
select pg_temp.legacy('test.sc', 15);              -- a sales credit note, typed as refunded 15
select pg_temp.legacy('test.pc', 10);              -- a purchase credit note, typed as refunded 10
select pg_temp.legacy('test.void_pi', 10);         -- void: left as it is
select pg_temp.legacy('test.draft', 5);            -- a draft cannot hold a payment
alter table public.transaction_headers enable trigger user;
alter table public.allocations enable trigger user;

create temp table expect as
select id, paid_amount, amount_due, paid_at_posting from public.transaction_headers
where organisation_id = current_setting('test.org')::uuid and status = 'posted';
select count(*) as legacy_rows_with_typed_paid from public.transaction_headers where paid_amount > 0 and organisation_id = current_setting('test.org')::uuid \gset
select set_config('test.reference_before', (select last_reference::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'), true);

-- A closed period does not stop the migration.
update public.organisation_defaults set lock_date = '2026-11-30' where organisation_id = current_setting('test.org')::uuid;

\echo Running the migration. Its notices follow.
\i supabase/migrations/20261113130600_remove_typed_paid_amount.sql
\echo end of migration

-- Every posted document shows what it showed, except the overpaid one, whose negative amount due is now 0.
select pg_temp.eq('documents with the same figures', (
  select count(*)::int from expect as before join public.transaction_headers as header on header.id = before.id
  where (before.paid_amount, before.amount_due) is not distinct from (header.paid_amount, header.amount_due) and before.paid_at_posting is not distinct from header.paid_at_posting
), (select count(*)::int from expect) - 1);
select pg_temp.eq('the overpaid document: paid', pg_temp.paid(current_setting('test.over')::uuid), 100.00);
select pg_temp.eq('the overpaid document: amount due', pg_temp.due(current_setting('test.over')::uuid), 0.00);
select pg_temp.eq('part paid: amount due', pg_temp.due(current_setting('test.si_part')::uuid), 600.00);
select pg_temp.eq('part paid: paid', pg_temp.paid(current_setting('test.si_part')::uuid), 400.00);
select pg_temp.eq('paid in full', pg_temp.due(current_setting('test.pi_full')::uuid), 0.00);
select pg_temp.eq('sales credit note', pg_temp.due(current_setting('test.sc')::uuid), 35.00);
select pg_temp.eq('purchase credit note', pg_temp.due(current_setting('test.pc')::uuid), 30.00);
select pg_temp.eq('untouched documents stay untouched', pg_temp.due(current_setting('test.untouched')::uuid), 75.00);

-- Each converted document has one migrated allocation, and each migrated payment is numbered MIG-.
select pg_temp.eq('one migrated allocation per converted document', (
  select count(*)::int from public.allocations a join public.payments p on p.id = a.source_payment_id
  where p.source = 'migrated' and p.organisation_id = current_setting('test.org')::uuid), 8);
select pg_temp.eq('one allocation each', (
  select count(*)::int from (select target_header_id from public.allocations where organisation_id = current_setting('test.org')::uuid group by 1 having count(*) <> 1) as many), 0);
select pg_temp.eq('migrated payments are numbered MIG-', (
  select count(*)::int from public.payments where source = 'migrated' and organisation_id = current_setting('test.org')::uuid and document_number like 'MIG-%'), 8);
select pg_temp.eq('migrated payments have no bank account', (select count(*)::int from public.payments where source = 'migrated' and bank_account_id is not null), 0);
select pg_temp.eq('real types keep their numbers', (select last_reference::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI'), current_setting('test.reference_before'));
select pg_temp.eq('the migrated types are the system types', (
  select count(*)::int from public.transaction_types where organisation_id = current_setting('test.org')::uuid and is_system), 4);
select pg_temp.eq('the right kinds', (
  select string_agg(code || ':' || document_kind::text || ':' || type, ',' order by code) from public.transaction_types where organisation_id = current_setting('test.org')::uuid and is_system),
  'MIGCREF:payment:Sales,MIGPAY:payment:Purchases,MIGREC:receipt:Sales,MIGSREF:receipt:Purchases');

-- The migrated payment copies the document: party, currency, rate and date.
do $$
declare v record;
begin
  select p.*, a.home_amount_at_target_rate, a.exchange_difference into v
  from public.payments p join public.allocations a on a.source_payment_id = p.id
  where a.target_header_id = current_setting('test.gbp')::uuid;
  if v.currency_id <> (select currency_id from public.transaction_headers where id = current_setting('test.gbp')::uuid)
     or v.exchange_rate <> 0.85 or v.amount <> 40 or v.payment_date <> '2026-11-05' or v.party_name <> 'Sterling customer'
     or v.notes <> 'Migrated from the typed paid amount' or v.status <> 'posted' then
    raise exception 'migration: the migrated sterling payment was %', to_jsonb(v);
  end if;
  if v.exchange_difference <> 0 then raise exception 'migration: a migrated allocation has an exchange difference'; end if;
end $$;
select pg_temp.eq('migrated payments are fully allocated except the overpaid one', (
  select count(*)::int from public.payments where source = 'migrated' and organisation_id = current_setting('test.org')::uuid and unallocated_amount > 0), 1);
select pg_temp.eq('the overpaid one keeps its excess on account', (
  select unallocated_amount from public.payments p join public.allocations a on a.source_payment_id = p.id where a.target_header_id = current_setting('test.over')::uuid), 30.00);

update public.organisation_defaults set lock_date = null where organisation_id = current_setting('test.org')::uuid;
-- Drafts are cleared, void documents are left alone, and a draft can no longer hold a paid amount.
select pg_temp.eq('the draft is cleared', (select paid_amount from public.transaction_headers where id = current_setting('test.draft')::uuid), 0.00);
select pg_temp.eq('the draft owes its total', (select amount_due from public.transaction_headers where id = current_setting('test.draft')::uuid), 60.00);
select pg_temp.eq('the void document is unchanged', (select paid_amount from public.transaction_headers where id = current_setting('test.void_pi')::uuid), 10.00);
select pg_temp.eq('and has no migrated payment', (select count(*)::int from public.allocations where target_header_id = current_setting('test.void_pi')::uuid), 0);
select pg_temp.expect_error(
  format($sql$update public.transaction_headers set paid_amount = 1 where id = %L$sql$, current_setting('test.draft')), 'draft_unpaid', 'a paid amount on a draft');

-- Nobody types a paid amount afterwards: not in save_document, not on a posted document.
select pg_temp.act_as('owner');
set local role authenticated;
select pg_temp.expect_error(
  format($sql$select public.save_document(jsonb_build_object('id', %L, 'transactionTypeId', %L, 'customerId', %L, 'transactionDate', '2026-11-08', 'currencyId', %L, 'exchangeRate', 1, 'paidAmount', '5'))$sql$,
    current_setting('test.draft'), pg_temp.id_of('transaction_types', 'SI'), pg_temp.id_of('customers', 'ACME'), pg_temp.id_of('currencies', 'EUR')),
  'cannot be typed', 'save_document with a paid amount');
select pg_temp.expect_error(
  format($sql$select public.save_document(jsonb_build_object('id', %L, 'transactionTypeId', %L, 'customerId', %L, 'transactionDate', '2026-11-08', 'currencyId', %L, 'exchangeRate', 1, 'paidAmount', '0'))$sql$,
    current_setting('test.draft'), pg_temp.id_of('transaction_types', 'SI'), pg_temp.id_of('customers', 'ACME'), pg_temp.id_of('currencies', 'EUR')),
  'cannot be typed', 'save_document with a paid amount of nothing');
select pg_temp.expect_error(
  format($sql$update public.transaction_headers set paid_amount = 1 where id = %L$sql$, current_setting('test.untouched')), 'worked out from payments', 'typing a paid amount on a posted document');
-- An amount due typed on a posted document is worked out again from the paid amount, so it does not stick.
update public.transaction_headers set amount_due = 1 where id = current_setting('test.untouched')::uuid;
select pg_temp.eq('a typed amount due does not stick', pg_temp.due(current_setting('test.untouched')::uuid), 75.00);
-- The system types cannot be changed by anyone.
select pg_temp.expect_error(
  format($sql$update public.transaction_types set description = 'Mine' where organisation_id = %L and code = 'MIGREC'$sql$, current_setting('test.org')), 'kept by the system', 'editing a migrated type');
select pg_temp.expect_error(
  format($sql$delete from public.transaction_types where organisation_id = %L and code = 'MIGREC'$sql$, current_setting('test.org')), 'kept by the system', 'deleting a migrated type');

rollback;
