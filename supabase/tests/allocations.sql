-- Payments release B, phase 3: allocations and settlement. Raises on failure and rolls back.
begin;

create temp table al_users (who text primary key, id uuid not null);
insert into al_users (who, id) values
  ('owner', 'a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8'),
  ('member', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9'),
  ('outsider', 'dadadada-dada-4ada-8ada-dadadadadada');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-alloc@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from al_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from al_users where who = p_who), 'role', 'authenticated')::text, true);
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

grant all on table al_users to authenticated;
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

select set_config('test.org', (public.create_tenant('Allocation Books', 'Allocation Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Allocation Second', 'EUR'))::text, true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-alloc@fintran.test', 'member');

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

-- 1. A 1,000 receipt allocated 600 and 400 to two invoices settles both and uses up the receipt.
select set_config('test.inv_a', pg_temp.document('SI', 'ACME', 600)::text, true);
select set_config('test.inv_b', pg_temp.document('SI', 'ACME', 400)::text, true);
select set_config('test.rec1', pg_temp.payment('REC', 'ACME', 1000)::text, true);
select public.allocate(pg_temp.src(current_setting('test.rec1')::uuid), current_setting('test.inv_a')::uuid, 600, null);
select public.allocate(pg_temp.src(current_setting('test.rec1')::uuid), current_setting('test.inv_b')::uuid, 400, null);
select pg_temp.eq('invoice A amount due', pg_temp.due(current_setting('test.inv_a')::uuid), 0.00);
select pg_temp.eq('invoice B amount due', pg_temp.due(current_setting('test.inv_b')::uuid), 0.00);
select pg_temp.eq('invoice A paid', pg_temp.paid(current_setting('test.inv_a')::uuid), 600.00);
select pg_temp.eq('receipt allocated', (select allocated_amount from public.payments where id = current_setting('test.rec1')::uuid), 1000.00);
select pg_temp.eq('receipt unallocated', (select unallocated_amount from public.payments where id = current_setting('test.rec1')::uuid), 0.00);
select pg_temp.eq('receipt home unallocated', (select home_unallocated_amount from public.payments where id = current_setting('test.rec1')::uuid), 0.00);
select pg_temp.eq('invoice home amount due', (select home_amount_due from public.transaction_headers where id = current_setting('test.inv_a')::uuid), 0.00);

-- 2. Over-allocation: 1,200 against a 1,000 invoice is refused. 800 of a 1,000 receipt leaves 200 on account.
select set_config('test.inv_c', pg_temp.document('SI', 'ACME', 1000)::text, true);
select set_config('test.rec2', pg_temp.payment('REC', 'ACME', 1000)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 1200, null)$sql$, current_setting('test.rec2'), current_setting('test.inv_c')),
  'still due', 'allocating 1,200 against a 1,000 invoice');
select public.allocate(pg_temp.src(current_setting('test.rec2')::uuid), current_setting('test.inv_c')::uuid, 800, null);
select pg_temp.eq('invoice C amount due', pg_temp.due(current_setting('test.inv_c')::uuid), 200.00);
select pg_temp.eq('receipt 2 unallocated', (select unallocated_amount from public.payments where id = current_setting('test.rec2')::uuid), 200.00);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 300, null)$sql$, current_setting('test.rec2'), current_setting('test.inv_c')),
  'still due', 'allocating more than is due');
select set_config('test.inv_d', pg_temp.document('SI', 'ACME', 5000)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 300, null)$sql$, current_setting('test.rec2'), current_setting('test.inv_d')),
  'left to allocate', 'allocating more than the payment has left');

-- 3. Who and what can be allocated to.
select set_config('test.draft_inv', pg_temp.document('SI', 'ACME', 100, '2026-11-12', null, null, false)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec2'), current_setting('test.draft_inv')),
  'posted invoice or credit note', 'a draft invoice');
select set_config('test.order', pg_temp.document('SO', 'ACME', 100, '2026-11-12', null, null, false)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec2'), current_setting('test.order')),
  'posted invoice or credit note', 'an order');
select set_config('test.other_inv', pg_temp.document('SI', 'OTHER', 100)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec2'), current_setting('test.other_inv')),
  'same customer', 'another customer''s invoice');
select set_config('test.gbp_inv', pg_temp.document('SI', 'GBPCO', 100)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec2'), current_setting('test.gbp_inv')),
  'same customer', 'a sterling customer''s invoice');
select set_config('test.pur_inv', pg_temp.document('PI', 'VOD', 100)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec2'), current_setting('test.pur_inv')),
  'cannot be applied', 'a customer receipt against a purchase invoice');
-- A receipt is not a refund: it cannot settle a credit note, and a refund cannot settle an invoice.
select set_config('test.cn_alone', pg_temp.open_credit(50)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec2'), current_setting('test.cn_alone')),
  'cannot be applied', 'a receipt against a credit note');
select set_config('test.ref1', pg_temp.payment('CREF', 'ACME', 50)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.ref1'), current_setting('test.inv_c')),
  'cannot be applied', 'a customer refund against an invoice');
-- A credit note is never the target of another credit note.
select set_config('test.cn_two', pg_temp.open_credit(20)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.note(%L), %L, 10, null)$sql$, current_setting('test.cn_two'), current_setting('test.cn_alone')),
  'cannot be applied', 'a credit note against a credit note');
-- A void payment cannot be allocated. A draft payment can, as a pending allocation.
select set_config('test.rec_void', pg_temp.payment('REC', 'ACME', 100)::text, true);
select set_config('fintran.status_change', 'on', true);
update public.payments set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = 'test' where id = current_setting('test.rec_void')::uuid;
select set_config('fintran.status_change', 'off', true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec_void'), current_setting('test.inv_c')),
  'void payment', 'a void payment');

-- Nobody writes allocations directly.
select pg_temp.expect_error(
  format($sql$insert into public.allocations (tenant_id, organisation_id, source_payment_id, target_header_id, amount, allocation_date) values (%L, %L, %L, %L, 1, '2026-11-12')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.rec2'), current_setting('test.inv_c')),
  'permission denied', 'a direct insert');
select pg_temp.expect_error(format($sql$update public.allocations set amount = 1 where target_header_id = %L$sql$, current_setting('test.inv_c')), 'permission denied', 'a direct update');
select pg_temp.expect_error($sql$delete from public.allocations$sql$, 'permission denied', 'a direct delete');

-- 4. Credit notes: posting a 300 credit note against a 1,000 invoice leaves 700 due, with nothing paid at posting.
select set_config('test.inv_e', pg_temp.document('SI', 'ACME', 1000)::text, true);
select set_config('test.cn_e', pg_temp.document('SC', 'ACME', 300, '2026-11-12', null, current_setting('test.inv_e')::uuid)::text, true);
select pg_temp.eq('invoice E amount due after the credit note', pg_temp.due(current_setting('test.inv_e')::uuid), 700.00);
select pg_temp.eq('credit note applied', pg_temp.paid(current_setting('test.cn_e')::uuid), 300.00);
select pg_temp.eq('credit note amount due', pg_temp.due(current_setting('test.cn_e')::uuid), 0.00);
select pg_temp.eq('credit note paid at posting', (select paid_at_posting from public.transaction_headers where id = current_setting('test.cn_e')::uuid), 0.00);
select pg_temp.eq('invoice paid at posting', (select paid_at_posting from public.transaction_headers where id = current_setting('test.inv_e')::uuid), 0.00);
select pg_temp.eq('credit note allocation count', (select count(*) from public.allocations where source_header_id = current_setting('test.cn_e')::uuid and removed_at is null)::int, 1);

-- A credit note against a fully paid invoice makes no allocation and stays open.
select set_config('test.inv_f', pg_temp.document('SI', 'ACME', 100)::text, true);
select set_config('test.rec_f', pg_temp.payment('REC', 'ACME', 100)::text, true);
select public.allocate(pg_temp.src(current_setting('test.rec_f')::uuid), current_setting('test.inv_f')::uuid, 100, null);
select set_config('test.cn_f', pg_temp.document('SC', 'ACME', 30, '2026-11-12', null, current_setting('test.inv_f')::uuid)::text, true);
select pg_temp.eq('no allocation for a settled invoice', (select count(*) from public.allocations where source_header_id = current_setting('test.cn_f')::uuid)::int, 0);
select pg_temp.eq('credit note left open', pg_temp.due(current_setting('test.cn_f')::uuid), 30.00);

-- A credit note's balance can be applied to another invoice, and refunded, but never more than its total together.
select set_config('test.inv_g', pg_temp.document('SI', 'ACME', 500)::text, true);
select public.allocate(pg_temp.note(current_setting('test.cn_f')::uuid), current_setting('test.inv_g')::uuid, 20, null);
select pg_temp.eq('invoice G after the credit note', pg_temp.due(current_setting('test.inv_g')::uuid), 480.00);
select pg_temp.eq('credit note applied 20 of 30', pg_temp.due(current_setting('test.cn_f')::uuid), 10.00);
select set_config('test.ref_f', pg_temp.payment('CREF', 'ACME', 50)::text, true);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 11, null)$sql$, current_setting('test.ref_f'), current_setting('test.cn_f')),
  'still due', 'refunding more than the credit note has left');
select public.allocate(pg_temp.src(current_setting('test.ref_f')::uuid), current_setting('test.cn_f')::uuid, 10, null);
select pg_temp.eq('credit note fully used', pg_temp.due(current_setting('test.cn_f')::uuid), 0.00);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.note(%L), %L, 1, null)$sql$, current_setting('test.cn_f'), current_setting('test.inv_g')),
  'left to apply', 'applying a credit note that is used up');

-- 5. Removing an allocation restores the open amount, and the row stays with its reason.
select set_config('test.alloc_c', (select id::text from public.allocations where target_header_id = current_setting('test.inv_c')::uuid and removed_at is null), true);
select pg_temp.expect_error(format($sql$select public.remove_allocation(%L, '  ')$sql$, current_setting('test.alloc_c')), 'reason', 'removing without a reason');
select public.remove_allocation(current_setting('test.alloc_c')::uuid, 'Wrong invoice');
select pg_temp.eq('invoice C open again', pg_temp.due(current_setting('test.inv_c')::uuid), 1000.00);
select pg_temp.eq('receipt 2 open again', (select unallocated_amount from public.payments where id = current_setting('test.rec2')::uuid), 1000.00);
do $$
declare v record;
begin
  select * into v from public.allocations where id = current_setting('test.alloc_c')::uuid;
  if v.removed_at is null or v.removal_reason <> 'Wrong invoice' or v.removed_by is null then
    raise exception 'allocations: the removed allocation did not keep its removal';
  end if;
end $$;
select pg_temp.expect_error(format($sql$select public.remove_allocation(%L, 'Again')$sql$, current_setting('test.alloc_c')), 'already been removed', 'removing twice');
select pg_temp.expect_error(
  format($sql$update public.allocations set amount = 5 where id = %L$sql$, current_setting('test.alloc_c')), 'permission denied', 'editing a removed allocation');

-- 6. Exchange differences. A 100.00 sterling invoice at 0.85 is 117.65. Paid at 0.86 it is 116.28, a loss of 1.37.
select set_config('test.gbp_a', pg_temp.document('SI', 'GBPCO', 100)::text, true);
select set_config('test.gbp_rec', pg_temp.payment('REC', 'GBPCO', 100, true, 0.86)::text, true);
select public.allocate(pg_temp.src(current_setting('test.gbp_rec')::uuid), current_setting('test.gbp_a')::uuid, 100, null);
select pg_temp.eq('sales exchange difference', (select exchange_difference from public.allocations where target_header_id = current_setting('test.gbp_a')::uuid), -1.37);
select pg_temp.eq('home at target rate', (select home_amount_at_target_rate from public.allocations where target_header_id = current_setting('test.gbp_a')::uuid), 117.65);
select pg_temp.eq('home at source rate', (select home_amount_at_source_rate from public.allocations where target_header_id = current_setting('test.gbp_a')::uuid), 116.28);
select pg_temp.eq('home amount due after a settled sterling invoice', (select home_amount_due from public.transaction_headers where id = current_setting('test.gbp_a')::uuid), 0.00);
-- The same figures on a purchase invoice and a supplier payment are a gain.
select set_config('test.gbp_p', pg_temp.document('PI', 'GBPV', 100)::text, true);
select set_config('test.gbp_pay', pg_temp.payment('PAY', 'GBPV', 100, true, 0.86)::text, true);
select public.allocate(pg_temp.src(current_setting('test.gbp_pay')::uuid), current_setting('test.gbp_p')::uuid, 100, null);
select pg_temp.eq('purchase exchange difference', (select exchange_difference from public.allocations where target_header_id = current_setting('test.gbp_p')::uuid), 1.37);
-- Two 50.00 receipts at the same rate: the second takes the remaining 58.83 and nothing is lost or gained.
select set_config('test.gbp_b', pg_temp.document('SI', 'GBPCO', 100)::text, true);
select set_config('test.gbp_r1', pg_temp.payment('REC', 'GBPCO', 50, true, 0.85)::text, true);
select set_config('test.gbp_r2', pg_temp.payment('REC', 'GBPCO', 50, true, 0.85)::text, true);
select public.allocate(pg_temp.src(current_setting('test.gbp_r1')::uuid), current_setting('test.gbp_b')::uuid, 50, null);
select public.allocate(pg_temp.src(current_setting('test.gbp_r2')::uuid), current_setting('test.gbp_b')::uuid, 50, null);
select pg_temp.eq('first half at target rate', (select home_amount_at_target_rate from public.allocations where source_payment_id = current_setting('test.gbp_r1')::uuid), 58.82);
select pg_temp.eq('second half takes the rest', (select home_amount_at_target_rate from public.allocations where source_payment_id = current_setting('test.gbp_r2')::uuid), 58.83);
select pg_temp.eq('equal rates, no difference', (select sum(exchange_difference) from public.allocations where target_header_id = current_setting('test.gbp_b')::uuid), 0.00);
select pg_temp.eq('home amount due is nothing', (select home_amount_due from public.transaction_headers where id = current_setting('test.gbp_b')::uuid), 0.00);
select pg_temp.eq('a fully used receipt has no home balance', (select home_unallocated_amount from public.payments where id = current_setting('test.gbp_r1')::uuid), 0.00);

-- 7. Posted documents change figures without being edited: no updated_at, no header audit row.
select set_config('test.inv_h', pg_temp.document('SI', 'ACME', 250)::text, true);
select set_config('test.h_updated', (select updated_at::text from public.transaction_headers where id = current_setting('test.inv_h')::uuid), true);
select set_config('test.h_audit', (select count(*)::text from public.audit_log where table_name = 'transaction_headers' and row_id = current_setting('test.inv_h')), true);
select set_config('test.h_einvoice', (select public.en16931_document(current_setting('test.inv_h')::uuid)::text), true);
select set_config('test.rec_h', pg_temp.payment('REC', 'ACME', 250)::text, true);
select public.allocate(pg_temp.src(current_setting('test.rec_h')::uuid), current_setting('test.inv_h')::uuid, 100, null);
select pg_temp.eq('paid after allocating', pg_temp.paid(current_setting('test.inv_h')::uuid), 100.00);
select pg_temp.eq('updated_at unchanged', (select updated_at::text from public.transaction_headers where id = current_setting('test.inv_h')::uuid), current_setting('test.h_updated'));
select pg_temp.eq('no header audit row', (select count(*)::text from public.audit_log where table_name = 'transaction_headers' and row_id = current_setting('test.inv_h')), current_setting('test.h_audit'));
select pg_temp.eq('the e-invoice is unchanged by payment', (select public.en16931_document(current_setting('test.inv_h')::uuid)::text), current_setting('test.h_einvoice'));
select pg_temp.eq('allocation audited', (select count(*)::int from public.audit_log where table_name = 'allocations' and action = 'INSERT' and organisation_id = current_setting('test.org')::uuid and new_values->>'target_header_id' = current_setting('test.inv_h')), 1);

-- 8. Voiding. An effective allocation blocks it. A planned one is dropped.
select set_config('test.pur_a', pg_temp.document('PI', 'VOD', 100)::text, true);
select set_config('test.pay_a', pg_temp.payment('PAY', 'VOD', 100, true)::text, true);
select set_config('test.pay_draft', pg_temp.payment('PAY', 'VOD', 100, false)::text, true);
select public.allocate(pg_temp.src(current_setting('test.pay_a')::uuid), current_setting('test.pur_a')::uuid, 60, null);
select pg_temp.expect_error(
  format($sql$select public.void_document(%L, 'Entered twice')$sql$, current_setting('test.pur_a')), 'Remove this document''s allocations', 'voiding a document with an allocation');
select public.remove_allocation((select id from public.allocations where target_header_id = current_setting('test.pur_a')::uuid and removed_at is null), 'Test');
select set_config('test.pending', public.allocate(pg_temp.src(current_setting('test.pay_draft')::uuid), current_setting('test.pur_a')::uuid, 40, null)::text, true);
select pg_temp.eq('a planned allocation is pending', (select pending from public.allocations where id = current_setting('test.pending')::uuid), true);
select pg_temp.eq('a planned allocation takes nothing off the invoice', pg_temp.due(current_setting('test.pur_a')::uuid), 100.00);
select pg_temp.eq('a planned allocation has no home amounts', (select home_amount_at_target_rate from public.allocations where id = current_setting('test.pending')::uuid), 0.00);
select pg_temp.eq('a draft payment shows nothing allocated', (select allocated_amount from public.payments where id = current_setting('test.pay_draft')::uuid), 0.00);
select public.void_document(current_setting('test.pur_a')::uuid, 'Entered twice');
select pg_temp.eq('the planned allocation is gone', (select count(*)::int from public.allocations where id = current_setting('test.pending')::uuid), 0);
select pg_temp.eq('the removed allocation stays', (select count(*)::int from public.allocations where target_header_id = current_setting('test.pur_a')::uuid and removed_at is not null), 1);

-- 9. Oldest first: the earliest due date takes the money first.
select set_config('test.of_late', pg_temp.document('SI', 'THIRD', 600, '2026-11-01', '2026-12-20')::text, true);
select set_config('test.of_early', pg_temp.document('SI', 'THIRD', 700, '2026-11-02', '2026-11-20')::text, true);
select set_config('test.of_rec', pg_temp.payment('REC', 'THIRD', 1000)::text, true);
select pg_temp.eq('allocations made', public.allocate_oldest_first(pg_temp.src(current_setting('test.of_rec')::uuid)) , 2);
select pg_temp.eq('earliest due date settled first', pg_temp.due(current_setting('test.of_early')::uuid), 0.00);
select pg_temp.eq('the rest goes to the later one', pg_temp.due(current_setting('test.of_late')::uuid), 300.00);
select pg_temp.eq('nothing left to apply', public.allocate_oldest_first(pg_temp.src(current_setting('test.of_rec')::uuid)), 0);

-- 10. Dates and the lock date.
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, '2026-01-01')$sql$, current_setting('test.rec2'), current_setting('test.inv_c')),
  'before the payment', 'an allocation dated before the documents');
select pg_temp.eq('the default allocation date is the later of the two', (select allocation_date::text from public.allocations where target_header_id = current_setting('test.inv_h')::uuid), '2026-11-12');
update public.organisation_defaults set lock_date = '2026-11-30' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec_h'), current_setting('test.inv_h')),
  'locked period', 'an allocation in a locked period');
select pg_temp.expect_error(
  format($sql$select public.remove_allocation(%L, 'Too late')$sql$, (select id from public.allocations where target_header_id = current_setting('test.inv_h')::uuid and removed_at is null)),
  'locked period', 'removing an allocation in a locked period');
update public.organisation_defaults set lock_date = null where organisation_id = current_setting('test.org')::uuid;

-- 11. Members can allocate. Outsiders cannot even see allocations.
select pg_temp.act_as('member');
select public.allocate(pg_temp.src(current_setting('test.rec_h')::uuid), current_setting('test.inv_h')::uuid, 50, null);
select pg_temp.eq('a member sees allocations', (select count(*)::int > 0 from public.allocations), true);
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider sees no allocations', (select count(*)::int from public.allocations), 0);
select pg_temp.expect_error(
  format($sql$select public.allocate(pg_temp.src(%L), %L, 10, null)$sql$, current_setting('test.rec_h'), current_setting('test.inv_h')),
  'could not be found', 'an outsider allocating');
select pg_temp.act_as('owner');

-- 12. A source and a target from different organisations are refused by the foreign keys, even in one tenant.
reset role;
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'EUR', 'Euro', 1) on conflict (organisation_id, code) do nothing;
select pg_temp.expect_error(
  format($sql$insert into public.allocations (tenant_id, organisation_id, source_payment_id, target_header_id, amount, allocation_date)
    values (%L, %L, %L, %L, 1, '2026-11-12')$sql$,
    current_setting('test.tenant'), current_setting('test.org2'), current_setting('test.rec2'), current_setting('test.inv_c')),
  'allocations_source_payment_fkey', 'a payment from another organisation');
-- The same row in the right organisation is accepted, which shows the refusal above came from the key.
insert into public.allocations (tenant_id, organisation_id, source_payment_id, target_header_id, amount, allocation_date)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.rec2')::uuid, current_setting('test.inv_c')::uuid, 1, '2026-11-12');
select pg_temp.eq('a row in the right organisation', (select count(*)::int from public.allocations where source_payment_id = current_setting('test.rec2')::uuid and removed_at is null), 1);

rollback;
