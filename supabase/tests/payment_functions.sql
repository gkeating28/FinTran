-- Payments release B, phase 4: saving, posting, voiding and numbering payments. Raises on failure and rolls back.
begin;

create temp table pf_users (who text primary key, id uuid not null);
insert into pf_users (who, id) values
  ('owner', 'a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9'),
  ('admin', 'b8b8b8b8-b8b8-4b8b-8b8b-b8b8b8b8b8b8'),
  ('member', 'cacacaca-caca-4aca-8aca-cacacacacaca'),
  ('outsider', 'dbdbdbdb-dbdb-4bdb-8bdb-dbdbdbdbdbdb');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-payfn@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from pf_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from pf_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'payments: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'payments: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'payments: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'payments: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

grant all on table pf_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text), pg_temp.eq(text, anyelement, anyelement) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;

select set_config('test.org', (public.create_tenant('Allocation Books', 'Allocation Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Allocation Second', 'EUR'))::text, true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-payfn@fintran.test', 'member');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-payfn@fintran.test', 'admin');

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

-- A draft payment saved through save_payment, with planned allocations given as [[document, amount], ...].
create function pg_temp.draft(p_type text, p_party text, p_amount numeric, p_plan jsonb default '[]', p_date date default '2026-11-12', p_rate numeric default null, p_id uuid default null)
returns uuid language plpgsql as $$
declare
  v_sales boolean := p_type in ('REC', 'CREF');
  v_gbp boolean := p_party in ('GBPCO', 'GBPV');
begin
  return public.save_payment(jsonb_build_object(
    'id', p_id,
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type),
    'paymentDate', p_date,
    'customerId', case when v_sales then pg_temp.id_of('customers', p_party) end,
    'supplierId', case when not v_sales then pg_temp.id_of('suppliers', p_party) end,
    'bankAccountId', pg_temp.id_of('bank_accounts', case when v_gbp then 'GBP1' else 'EUR1' end),
    'exchangeRate', p_rate,
    'amount', p_amount,
    'bankReference', 'REF ' || p_type,
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('targetHeaderId', item->>0, 'amount', (item->>1)::numeric)), '[]'::jsonb) from jsonb_array_elements(p_plan) as item)
  ));
end $$;
create function pg_temp.due(p_header uuid) returns numeric language sql as $$ select amount_due from public.transaction_headers where id = p_header $$;
create function pg_temp.pay(p_payment uuid) returns record language sql as $$ select status::text, document_number, reference, allocated_amount, unallocated_amount from public.payments where id = p_payment $$;
create function pg_temp.last_reference(p_type text) returns integer language sql as $$ select last_reference from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = p_type $$;
grant execute on function pg_temp.id_of(text, text), pg_temp.document(text, text, numeric, date, date, uuid, boolean),
  pg_temp.draft(text, text, numeric, jsonb, date, numeric, uuid), pg_temp.due(uuid), pg_temp.last_reference(text) to authenticated;

select set_config('test.inv_a', pg_temp.document('SI', 'ACME', 600)::text, true);
select set_config('test.inv_b', pg_temp.document('SI', 'ACME', 400)::text, true);

-- 1. save_payment: a draft receipt with planned allocations. They do nothing until it posts.
select set_config('test.r1', pg_temp.draft('REC', 'ACME', 1000, jsonb_build_array(jsonb_build_array(current_setting('test.inv_a'), 600), jsonb_build_array(current_setting('test.inv_b'), 400)))::text, true);
select pg_temp.eq('party name filled from the customer', (select party_name from public.payments where id = current_setting('test.r1')::uuid), 'Acme');
select pg_temp.eq('two planned allocations', (select count(*)::int from public.allocations where source_payment_id = current_setting('test.r1')::uuid and pending), 2);
select pg_temp.eq('a plan takes nothing off the invoice', pg_temp.due(current_setting('test.inv_a')::uuid), 600.00);
select pg_temp.eq('no number on a draft of a type that numbers on post', (select document_number from public.payments where id = current_setting('test.r1')::uuid), null::text);
-- Saving again replaces the plan.
select pg_temp.draft('REC', 'ACME', 1000, jsonb_build_array(jsonb_build_array(current_setting('test.inv_a'), 500)), '2026-11-12', null, current_setting('test.r1')::uuid);
select pg_temp.eq('the plan was replaced', (select count(*)::int from public.allocations where source_payment_id = current_setting('test.r1')::uuid and pending), 1);
select pg_temp.eq('saving the same payment again does not add another', (select count(*)::int from public.payments where bank_reference = 'REF REC' and organisation_id = current_setting('test.org')::uuid), 1);
select pg_temp.draft('REC', 'ACME', 1000, jsonb_build_array(jsonb_build_array(current_setting('test.inv_a'), 600), jsonb_build_array(current_setting('test.inv_b'), 400)), '2026-11-12', null, current_setting('test.r1')::uuid);
-- A plan cannot be more than the payment, or more than the invoice.
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('REC', 'ACME', 100, jsonb_build_array(jsonb_build_array(%L, 600)), '2026-11-12', null, %L)$sql$, current_setting('test.inv_a'), current_setting('test.r1')),
  'left to allocate', 'planning more than the payment');
select pg_temp.eq('a refused save leaves the old plan', (select count(*)::int from public.allocations where source_payment_id = current_setting('test.r1')::uuid and pending), 2);

-- 2. post_payment: the allocations become effective, with their dates, home amounts and the number.
select pg_temp.eq('last reference before posting', pg_temp.last_reference('REC'), 0);
select public.post_payment(current_setting('test.r1')::uuid);
select pg_temp.eq('posted', (select status::text from public.payments where id = current_setting('test.r1')::uuid), 'posted');
select pg_temp.eq('numbered on post', (select document_number from public.payments where id = current_setting('test.r1')::uuid), 'R-0001');
select pg_temp.eq('invoice A settled', pg_temp.due(current_setting('test.inv_a')::uuid), 0.00);
select pg_temp.eq('invoice B settled', pg_temp.due(current_setting('test.inv_b')::uuid), 0.00);
select pg_temp.eq('allocations effective', (select count(*)::int from public.allocations where source_payment_id = current_setting('test.r1')::uuid and not pending and removed_at is null), 2);
select pg_temp.eq('allocation dates', (select min(allocation_date)::text from public.allocations where source_payment_id = current_setting('test.r1')::uuid), '2026-11-12');
select pg_temp.eq('home amounts set on posting', (select sum(home_amount_at_target_rate) from public.allocations where source_payment_id = current_setting('test.r1')::uuid), 1000.00);
select pg_temp.eq('the receipt is used up', (select unallocated_amount from public.payments where id = current_setting('test.r1')::uuid), 0.00);
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.r1')), 'Only a draft', 'posting twice');
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('REC', 'ACME', 5, '[]', '2026-11-12', null, %L)$sql$, current_setting('test.r1')), 'Only a draft payment can be saved', 'saving a posted payment');
select pg_temp.expect_error(format($sql$select public.delete_payment(%L)$sql$, current_setting('test.r1')), 'Only a draft', 'deleting a posted payment');

-- A planned allocation dated before the payment takes the payment's date, and one given a later date keeps it.
select set_config('test.inv_late', pg_temp.document('SI', 'ACME', 100, '2026-11-05')::text, true);
select set_config('test.r_date', pg_temp.draft('REC', 'ACME', 100, jsonb_build_array(jsonb_build_array(current_setting('test.inv_late'), 100)), '2026-11-10')::text, true);
select public.post_payment(current_setting('test.r_date')::uuid);
select pg_temp.eq('allocation takes the payment date', (select allocation_date::text from public.allocations where source_payment_id = current_setting('test.r_date')::uuid), '2026-11-10');

-- 3. Another receipt took the open amount: posting fails, names the invoice, and issues no number.
select set_config('test.inv_c', pg_temp.document('SI', 'ACME', 1000)::text, true);
select set_config('test.r_first', pg_temp.draft('REC', 'ACME', 1000, jsonb_build_array(jsonb_build_array(current_setting('test.inv_c'), 1000)))::text, true);
select set_config('test.r_second', pg_temp.draft('REC', 'ACME', 700, jsonb_build_array(jsonb_build_array(current_setting('test.inv_c'), 700)))::text, true);
select public.post_payment(current_setting('test.r_first')::uuid);
select pg_temp.eq('the second receipt has no number yet', (select document_number from public.payments where id = current_setting('test.r_second')::uuid), null::text);
select set_config('test.ref_before', pg_temp.last_reference('REC')::text, true);
select pg_temp.expect_error(
  format($sql$select public.post_payment(%L)$sql$, current_setting('test.r_second')),
  (select document_number from public.transaction_headers where id = current_setting('test.inv_c')::uuid), 'posting a receipt for an invoice that is already paid');
select pg_temp.eq('a failed post issues no number', pg_temp.last_reference('REC')::text, current_setting('test.ref_before'));
select pg_temp.eq('a failed post leaves a draft', (select status::text from public.payments where id = current_setting('test.r_second')::uuid), 'draft');
select pg_temp.eq('a failed post keeps the plan', (select count(*)::int from public.allocations where source_payment_id = current_setting('test.r_second')::uuid and pending), 1);
-- It lists every document that no longer has enough open.
select set_config('test.inv_e', pg_temp.document('SI', 'ACME', 100)::text, true);
select set_config('test.inv_f', pg_temp.document('SI', 'ACME', 50)::text, true);
select set_config('test.r_multi', pg_temp.draft('REC', 'ACME', 2000, jsonb_build_array(jsonb_build_array(current_setting('test.inv_e'), 100), jsonb_build_array(current_setting('test.inv_f'), 50)))::text, true);
select set_config('test.r_take_e', pg_temp.draft('REC', 'ACME', 100, jsonb_build_array(jsonb_build_array(current_setting('test.inv_e'), 100)))::text, true);
select set_config('test.r_take_f', pg_temp.draft('REC', 'ACME', 50, jsonb_build_array(jsonb_build_array(current_setting('test.inv_f'), 50)))::text, true);
select public.post_payment(current_setting('test.r_take_e')::uuid);
select public.post_payment(current_setting('test.r_take_f')::uuid);
select pg_temp.expect_error(
  format($sql$select public.post_payment(%L)$sql$, current_setting('test.r_multi')),
  (select document_number from public.transaction_headers where id = current_setting('test.inv_e')::uuid), 'posting a plan whose first invoice is taken');
select pg_temp.expect_error(
  format($sql$select public.post_payment(%L)$sql$, current_setting('test.r_multi')),
  (select document_number from public.transaction_headers where id = current_setting('test.inv_f')::uuid), 'posting a plan whose second invoice is taken');
-- Planning more than the invoice has open is refused at once, since the plan is checked against what is open now.
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('REC', 'ACME', 2000, jsonb_build_array(jsonb_build_array(%L, 10)), '2026-11-12', null, %L)$sql$, current_setting('test.inv_e'), current_setting('test.r_multi')),
  'still due', 'planning against an invoice that is paid');
-- Fixing the plan lets it post, and the number is the next one with no gap.
select pg_temp.draft('REC', 'ACME', 2000, '[]', '2026-11-12', null, current_setting('test.r_multi')::uuid);
select public.post_payment(current_setting('test.r_multi')::uuid);
select pg_temp.eq('numbers have no gap', (select document_number from public.payments where id = current_setting('test.r_multi')::uuid), 'R-0006');
select pg_temp.eq('the numbers so far', (select string_agg(document_number, ',' order by reference) from public.payments where organisation_id = current_setting('test.org')::uuid and status = 'posted' and document_number like 'R-%'), 'R-0001,R-0002,R-0003,R-0004,R-0005,R-0006');

-- An on-insert type numbers its drafts, so deleting one is a gap by design. Deleting a draft takes its plan with it.
select set_config('test.pay_draft', pg_temp.draft('PAY', 'VOD', 100)::text, true);
select pg_temp.eq('an on-insert type numbers the draft', (select document_number from public.payments where id = current_setting('test.pay_draft')::uuid), 'P-0001');
select set_config('test.pur_a', pg_temp.document('PI', 'VOD', 100)::text, true);
select pg_temp.draft('PAY', 'VOD', 100, jsonb_build_array(jsonb_build_array(current_setting('test.pur_a'), 100)), '2026-11-12', null, current_setting('test.pay_draft')::uuid);
select public.delete_payment(current_setting('test.pay_draft')::uuid);
select pg_temp.eq('the draft is gone', (select count(*)::int from public.payments where id = current_setting('test.pay_draft')::uuid), 0);
select pg_temp.eq('and its plan', (select count(*)::int from public.allocations where target_header_id = current_setting('test.pur_a')::uuid), 0);

-- 4. Voiding: a member cannot, an admin can with a reason, and every invoice is open again.
select pg_temp.act_as('member');
select pg_temp.expect_error(format($sql$select public.void_payment(%L, 'Wrong')$sql$, current_setting('test.r1')), 'owner or admin', 'a member voiding a payment');
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.void_payment(%L, '  ')$sql$, current_setting('test.r1')), 'reason', 'voiding without a reason');
select public.void_payment(current_setting('test.r1')::uuid, 'Receipt entered twice');
select pg_temp.eq('void', (select status::text from public.payments where id = current_setting('test.r1')::uuid), 'void');
select pg_temp.eq('invoice A open again', pg_temp.due(current_setting('test.inv_a')::uuid), 600.00);
select pg_temp.eq('invoice B open again', pg_temp.due(current_setting('test.inv_b')::uuid), 400.00);
select pg_temp.eq('every allocation removed with the void reason', (select count(*)::int from public.allocations where source_payment_id = current_setting('test.r1')::uuid and removal_reason = 'Receipt entered twice'), 2);
select pg_temp.eq('a void payment has nothing on account', (select unallocated_amount from public.payments where id = current_setting('test.r1')::uuid), 0.00);
select pg_temp.expect_error(format($sql$select public.void_payment(%L, 'Again')$sql$, current_setting('test.r1')), 'Only a posted payment', 'voiding twice');

select pg_temp.act_as('owner');

-- 5. Lock date: a payment dated on or before it cannot be posted, and one with an allocation on or before it cannot be voided.
select set_config('test.inv_l', pg_temp.document('SI', 'ACME', 100)::text, true);
select set_config('test.r_lock', pg_temp.draft('REC', 'ACME', 100, jsonb_build_array(jsonb_build_array(current_setting('test.inv_l'), 100)))::text, true);
select set_config('test.r_lock2', pg_temp.draft('REC', 'ACME', 100, '[]')::text, true);
update public.organisation_defaults set lock_date = '2026-11-30' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.r_lock')), 'locked period', 'posting a payment in a locked period');
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.r_lock2')), 'locked period', 'posting a payment with nothing allocated in a locked period');
update public.organisation_defaults set lock_date = null where organisation_id = current_setting('test.org')::uuid;
select public.post_payment(current_setting('test.r_lock')::uuid);
update public.organisation_defaults set lock_date = '2026-11-30' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error(format($sql$select public.void_payment(%L, 'Too late')$sql$, current_setting('test.r_lock')), 'locked period', 'voiding a payment in a locked period');
update public.organisation_defaults set lock_date = null where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('refused voids change nothing', (select status::text from public.payments where id = current_setting('test.r_lock')::uuid), 'posted');

-- 6. Posting a credit note refund end to end: a customer refund against an open credit note.
select set_config('test.paid_inv', pg_temp.document('SI', 'ACME', 100)::text, true);
select set_config('test.paid_rec', pg_temp.draft('REC', 'ACME', 100, jsonb_build_array(jsonb_build_array(current_setting('test.paid_inv'), 100)))::text, true);
select public.post_payment(current_setting('test.paid_rec')::uuid);
select set_config('test.cn', pg_temp.document('SC', 'ACME', 40, '2026-11-12', null, current_setting('test.paid_inv')::uuid)::text, true);
select pg_temp.eq('the credit note is open', pg_temp.due(current_setting('test.cn')::uuid), 40.00);
select set_config('test.refund', pg_temp.draft('CREF', 'ACME', 40, jsonb_build_array(jsonb_build_array(current_setting('test.cn'), 40)))::text, true);
select public.post_payment(current_setting('test.refund')::uuid);
select pg_temp.eq('the refund settles the credit note', pg_temp.due(current_setting('test.cn')::uuid), 0.00);
select pg_temp.eq('a refund numbers from its own type', (select document_number from public.payments where id = current_setting('test.refund')::uuid), 'CF-0001');

-- 6b. allocate_lines applies several amounts from one payment together, or none of them.
select set_config('test.al_a', pg_temp.document('SI', 'ACME', 100)::text, true);
select set_config('test.al_b', pg_temp.document('SI', 'ACME', 50)::text, true);
select set_config('test.al_rec', pg_temp.draft('REC', 'ACME', 200)::text, true);
select public.post_payment(current_setting('test.al_rec')::uuid);
select pg_temp.expect_error(
  format($sql$select public.allocate_lines(jsonb_build_object('paymentId', %L), jsonb_build_array(jsonb_build_object('targetHeaderId', %L, 'amount', 100), jsonb_build_object('targetHeaderId', %L, 'amount', 60)))$sql$,
    current_setting('test.al_rec'), current_setting('test.al_a'), current_setting('test.al_b')),
  'still due', 'a set where one amount is too much');
select pg_temp.eq('nothing was applied from a refused set', pg_temp.due(current_setting('test.al_a')::uuid), 100.00);
select pg_temp.eq('two amounts applied together', public.allocate_lines(jsonb_build_object('paymentId', current_setting('test.al_rec')::uuid),
  jsonb_build_array(jsonb_build_object('targetHeaderId', current_setting('test.al_a'), 'amount', 100), jsonb_build_object('targetHeaderId', current_setting('test.al_b'), 'amount', 50))), 2);
select pg_temp.eq('first settled', pg_temp.due(current_setting('test.al_a')::uuid), 0.00);
select pg_temp.eq('second settled', pg_temp.due(current_setting('test.al_b')::uuid), 0.00);
select pg_temp.eq('50 left on account', (select unallocated_amount from public.payments where id = current_setting('test.al_rec')::uuid), 50.00);

-- 7. A member can save, post and delete drafts. An outsider can do none of it.
select pg_temp.act_as('member');
select set_config('test.m1', pg_temp.draft('REC', 'ACME', 10)::text, true);
select public.post_payment(current_setting('test.m1')::uuid);
select set_config('test.m2', pg_temp.draft('REC', 'ACME', 10)::text, true);
select public.delete_payment(current_setting('test.m2')::uuid);
select pg_temp.act_as('outsider');
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.m1')), 'not a member', 'an outsider posting');
select pg_temp.expect_error(format($sql$select public.delete_payment(%L)$sql$, current_setting('test.m1')), 'could not be deleted', 'an outsider deleting');
select pg_temp.expect_error(format($sql$select public.void_payment(%L, 'x')$sql$, current_setting('test.m1')), 'owner or admin', 'an outsider voiding');
select pg_temp.expect_error(format($sql$select pg_temp.draft('REC', 'ACME', 10)$sql$), 'transaction type', 'an outsider saving');

rollback;
