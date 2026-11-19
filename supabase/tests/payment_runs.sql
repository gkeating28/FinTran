-- Payment runs (QULAPLUS_PAYMENT_APPROVALS_SPEC.md, phase 4). Raises on failure and rolls back.
begin;

create temp table pr_users (who text primary key, id uuid not null);
insert into pr_users (who, id) values
  ('owner', 'a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3'),
  ('admin', 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3'),
  ('member', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'),
  ('outsider', 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-run@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from pr_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from pr_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'payment runs: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'payment runs: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'payment runs: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'payment runs: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

grant all on table pr_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text), pg_temp.eq(text, anyelement, anyelement) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;
select set_config('test.org', (public.create_tenant('Run Books', 'Run Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-run@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-run@fintran.test', 'member');
reset role;

insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PZ', 'Zero purchases', 0, 'Expense', 'Z');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.name, c.id, 'Quay 4', 'Dublin'
from (values ('VOD', 'Vodafone'), ('HARB', 'Harbour')) as v(code, name)
join public.currencies c on c.organisation_id = current_setting('test.org')::uuid and c.code = 'EUR';
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR1', 'EUR1', 'IE29AIBK93115212345678', c.id
from public.currencies c where c.organisation_id = current_setting('test.org')::uuid and c.code = 'EUR';
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id, active)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'OLD', 'Closed', 'DE89370400440532013000', c.id, false
from public.currencies c where c.organisation_id = current_setting('test.org')::uuid and c.code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.description, 0, v.type, v.kind::public.document_kind, 'on_insert', null, 0
from (values ('PAY', 'Supplier payment', 'Purchases', 'payment'), ('PI', 'Purchase invoice', 'Purchases', 'invoice'), ('REC', 'Customer receipt', 'Sales', 'receipt')) as v(code, description, type, kind);
set local role authenticated;

create function pg_temp.id_of(p_table text, p_code text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  execute format('select id from public.%I where organisation_id = $1 and code = $2', p_table) into v_id using current_setting('test.org')::uuid, p_code;
  return v_id;
end $$;

-- A posted purchase invoice of one line, due on the given date.
create function pg_temp.invoice(p_supplier text, p_price numeric) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.save_document(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', 'PI'),
    'supplierId', pg_temp.id_of('suppliers', p_supplier),
    'supplierReference', 'S-' || left(gen_random_uuid()::text, 8),
    'transactionDate', '2026-11-12', 'dueDate', '2026-12-12',
    'currencyId', (select currency_id from public.suppliers where id = pg_temp.id_of('suppliers', p_supplier)),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Goods', 'quantity', 1, 'price', p_price, 'discountAmount', 0,
      'vatRateId', pg_temp.id_of('vat_rates', 'PZ'), 'glCodeId', pg_temp.id_of('gl_codes', '6000')))));
  perform public.post_document(v_id, null);
  return v_id;
end $$;

create function pg_temp.run(p_ids uuid[], p_bank text default 'EUR1', p_type text default 'PAY') returns uuid language plpgsql as $$
begin
  return public.create_payment_run(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type),
    'bankAccountId', pg_temp.id_of('bank_accounts', p_bank),
    'paymentDate', '2026-11-13',
    'invoiceIds', to_jsonb(p_ids)));
end $$;

create function pg_temp.rule(p_amount numeric, p_role text) returns void language plpgsql as $$
begin
  insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, pg_temp.id_of('transaction_types', 'PAY'), p_amount, p_role);
end $$;

create function pg_temp.due(p_id uuid) returns numeric language sql as $$ select amount_due from public.transaction_headers where id = p_id $$;
create function pg_temp.state(p_id uuid) returns text language sql as $$ select state from public.payment_run_approval_status(array[p_id]) $$;

select pg_temp.act_as('member');
select set_config('test.v1', pg_temp.invoice('VOD', 1000)::text, true);
select set_config('test.v2', pg_temp.invoice('VOD', 500)::text, true);
select set_config('test.h1', pg_temp.invoice('HARB', 2000)::text, true);
select set_config('test.draft', public.save_document(jsonb_build_object(
    'transactionTypeId', pg_temp.id_of('transaction_types', 'PI'), 'supplierId', pg_temp.id_of('suppliers', 'VOD'), 'supplierReference', 'DRAFT-1',
    'transactionDate', '2026-11-12', 'dueDate', '2026-12-12',
    'currencyId', (select currency_id from public.suppliers where id = pg_temp.id_of('suppliers', 'VOD')), 'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Goods', 'quantity', 1, 'price', 10, 'discountAmount', 0,
      'vatRateId', pg_temp.id_of('vat_rates', 'PZ'), 'glCodeId', pg_temp.id_of('gl_codes', '6000')))))::text, true);

-- 1. A run of three invoices for two suppliers makes one draft payment for each supplier.
select set_config('test.run1', pg_temp.run(array[current_setting('test.v1')::uuid, current_setting('test.v2')::uuid, current_setting('test.h1')::uuid])::text, true);
select pg_temp.eq('the run is numbered', (select document_number from public.payment_runs where id = current_setting('test.run1')::uuid), 'RUN-0001');
select pg_temp.eq('and a draft', (select status from public.payment_runs where id = current_setting('test.run1')::uuid), 'draft');
select pg_temp.eq('two draft payments, one for each supplier', (select count(*)::int from public.payments where payment_run_id = current_setting('test.run1')::uuid and status = 'draft'), 2);
select pg_temp.eq('Vodafone is paid 1,500.00', (select amount from public.payments where payment_run_id = current_setting('test.run1')::uuid and party_name = 'Vodafone'), 1500.00);
select pg_temp.eq('Harbour is paid 2,000.00', (select amount from public.payments where payment_run_id = current_setting('test.run1')::uuid and party_name = 'Harbour'), 2000.00);
select pg_temp.eq('each invoice is allocated in full', (select count(*)::int from public.allocations where pending and source_payment_id in (select id from public.payments where payment_run_id = current_setting('test.run1')::uuid)), 3);
select pg_temp.eq('nothing is taken off an invoice until the run posts', pg_temp.due(current_setting('test.v1')::uuid), 1000.00);

-- 2. What a run refuses.
select pg_temp.expect_error(format($sql$select pg_temp.run(array[%L::uuid])$sql$, current_setting('test.draft')), 'not posted', 'a draft invoice');
select pg_temp.expect_error(format($sql$select pg_temp.run(array[%L::uuid])$sql$, current_setting('test.v1')), 'already in another payment run', 'an invoice already in a draft run');
select pg_temp.expect_error($sql$select pg_temp.run(array[]::uuid[])$sql$, 'at least one invoice', 'an empty run');
select pg_temp.expect_error(format($sql$select pg_temp.run(array[%L::uuid], 'OLD')$sql$, current_setting('test.v1')), 'not active', 'an inactive bank account');
select pg_temp.expect_error(format($sql$select pg_temp.run(array[%L::uuid], 'EUR1', 'PI')$sql$, current_setting('test.v1')), 'supplier payment type', 'an invoice type for a run');
select pg_temp.expect_error(format($sql$select pg_temp.run(array[%L::uuid], 'EUR1', 'REC')$sql$, current_setting('test.v1')), 'supplier payment type', 'a receipt type for a run');
select pg_temp.act_as('outsider');
select pg_temp.expect_error(format($sql$select pg_temp.run(array[%L::uuid])$sql$, current_setting('test.v1')), 'Choose a payment type', 'an outsider making a run');
select pg_temp.eq('an outsider sees no run', (select count(*)::int from public.payment_runs), 0);
select pg_temp.act_as('member');

-- 3. A payment in a run cannot be posted on its own, and needs no approval of its own.
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, (select id from public.payments where payment_run_id = current_setting('test.run1')::uuid limit 1)), 'Post the run instead', 'posting one payment of a run');
select pg_temp.expect_error(format($sql$select public.request_payment_approval(%L)$sql$, (select id from public.payments where payment_run_id = current_setting('test.run1')::uuid limit 1)), 'does not need approval', 'asking for approval of a payment in a run');

-- 4. Nobody writes a run directly, and a member can read it.
select pg_temp.expect_error(format($sql$update public.payment_runs set status = 'posted' where id = %L$sql$, current_setting('test.run1')), 'permission denied', 'a direct update');
select pg_temp.eq('a member can read the run', (select count(*)::int from public.payment_runs), 1);

-- 5. With no rule, posting the run posts every payment and makes every allocation effective.
select public.post_payment_run(current_setting('test.run1')::uuid);
select pg_temp.eq('the run is posted', (select status from public.payment_runs where id = current_setting('test.run1')::uuid), 'posted');
select pg_temp.eq('both payments are posted', (select count(*)::int from public.payments where payment_run_id = current_setting('test.run1')::uuid and status = 'posted'), 2);
select pg_temp.eq('the invoices are paid', pg_temp.due(current_setting('test.v1')::uuid) + pg_temp.due(current_setting('test.v2')::uuid) + pg_temp.due(current_setting('test.h1')::uuid), 0.00);
select pg_temp.expect_error(format($sql$select public.post_payment_run(%L)$sql$, current_setting('test.run1')), 'Only a draft', 'posting a run twice');
select pg_temp.expect_error(format($sql$select public.cancel_payment_run(%L)$sql$, current_setting('test.run1')), 'Only a draft', 'cancelling a posted run');
select pg_temp.expect_error(format($sql$select public.remove_run_payment(%L)$sql$, (select id from public.payments where payment_run_id = current_setting('test.run1')::uuid limit 1)), 'draft', 'taking a payment out of a posted run');
select pg_temp.expect_error(format($sql$select pg_temp.run(array[%L::uuid])$sql$, current_setting('test.v1')), 'nothing open', 'an invoice that is paid');

-- 6. A rule of 3,000 for an admin: a run of 3,500 needs approval.
select pg_temp.act_as('admin');
select pg_temp.rule(3000, 'admin');
select pg_temp.act_as('member');
select set_config('test.v3', pg_temp.invoice('VOD', 1800)::text, true);
select set_config('test.h2', pg_temp.invoice('HARB', 1700)::text, true);
select set_config('test.run2', pg_temp.run(array[current_setting('test.v3')::uuid, current_setting('test.h2')::uuid])::text, true);
select pg_temp.eq('3,500.00 needs approval', pg_temp.state(current_setting('test.run2')::uuid), 'required');
select pg_temp.expect_error(format($sql$select public.post_payment_run(%L)$sql$, current_setting('test.run2')), 'Request approval first', 'posting an unapproved run');
select public.request_run_approval(current_setting('test.run2')::uuid, 'Month end');
select pg_temp.eq('requested', pg_temp.state(current_setting('test.run2')::uuid), 'requested');
select pg_temp.expect_error(format($sql$select public.post_payment_run(%L)$sql$, current_setting('test.run2')), 'Waiting for approval', 'posting while waiting');
select pg_temp.expect_error(format($sql$select public.approve_run(%L)$sql$, current_setting('test.run2')), 'needs an admin or owner', 'a member approving');
select pg_temp.act_as('admin');
select pg_temp.eq('an admin can decide it', (select can_decide from public.payment_run_approval_status(array[current_setting('test.run2')::uuid])), true);
select pg_temp.act_as('member');
select pg_temp.eq('the requester cannot', (select can_decide from public.payment_run_approval_status(array[current_setting('test.run2')::uuid])), false);

-- Taking a payment out cancels the request.
select public.remove_run_payment((select id from public.payments where payment_run_id = current_setting('test.run2')::uuid and party_name = 'Harbour'));
select pg_temp.eq('removing a payment leaves one in the run', (select count(*)::int from public.payments where payment_run_id = current_setting('test.run2')::uuid), 1);
select pg_temp.eq('and the run no longer needs approval at 1,800.00', (select count(*)::int from public.payment_run_approval_status(array[current_setting('test.run2')::uuid])), 0);
select pg_temp.eq('the removed payment is an ordinary draft', (select status::text from public.payments where party_name = 'Harbour' and payment_run_id is null and status = 'draft' limit 1), 'draft');
select public.post_payment_run(current_setting('test.run2')::uuid);
select pg_temp.eq('under the rule it posts', (select status from public.payment_runs where id = current_setting('test.run2')::uuid), 'posted');

-- 7. Request, approve, post; the requester can never approve.
select set_config('test.v4', pg_temp.invoice('VOD', 2500)::text, true);
select set_config('test.v5', pg_temp.invoice('VOD', 1000)::text, true);
select set_config('test.run3', pg_temp.run(array[current_setting('test.v4')::uuid, current_setting('test.v5')::uuid])::text, true);
select public.request_run_approval(current_setting('test.run3')::uuid);
select pg_temp.expect_error(format($sql$select public.approve_run(%L)$sql$, current_setting('test.run3')), 'needs an admin or owner', 'a member approving a run');
select pg_temp.act_as('admin');
select public.approve_run(current_setting('test.run3')::uuid, 'Fine');
select pg_temp.eq('approved', pg_temp.state(current_setting('test.run3')::uuid), 'approved');
-- A change to any payment in the run cancels the approval.
select pg_temp.act_as('member');
update public.payments set payment_date = '2026-11-14' where payment_run_id = current_setting('test.run3')::uuid;
select pg_temp.eq('a changed payment cancels the approval', pg_temp.state(current_setting('test.run3')::uuid), 'required');
select public.request_run_approval(current_setting('test.run3')::uuid);
select pg_temp.act_as('admin');
select public.approve_run(current_setting('test.run3')::uuid);
select pg_temp.act_as('member');
select public.post_payment_run(current_setting('test.run3')::uuid);
select pg_temp.eq('approved, a member posts the run', (select status from public.payment_runs where id = current_setting('test.run3')::uuid), 'posted');

-- An admin who asked cannot approve their own run, and an owner can.
select pg_temp.act_as('member');
select set_config('test.v6', pg_temp.invoice('VOD', 3200)::text, true);
select set_config('test.run4', pg_temp.run(array[current_setting('test.v6')::uuid])::text, true);
select pg_temp.act_as('admin');
select public.request_run_approval(current_setting('test.run4')::uuid);
select pg_temp.expect_error(format($sql$select public.approve_run(%L)$sql$, current_setting('test.run4')), 'someone else has to decide', 'an admin approving their own run');
select pg_temp.expect_error(format($sql$select public.reject_run(%L, 'No')$sql$, current_setting('test.run4')), 'someone else has to decide', 'an admin refusing their own run');
select pg_temp.act_as('owner');
select pg_temp.expect_error(format($sql$select public.reject_run(%L, '  ')$sql$, current_setting('test.run4')), 'reason', 'a refusal without a reason');
select public.reject_run(current_setting('test.run4')::uuid, 'Hold until Friday');
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.post_payment_run(%L)$sql$, current_setting('test.run4')), 'Approval was refused: Hold until Friday', 'posting a refused run');
select pg_temp.eq('the requester sees it in the queue as refused', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where header_id = current_setting('test.run4')::uuid and state = 'refused' and item_kind = 'run'), 1);
select public.request_run_approval(current_setting('test.run4')::uuid);
select pg_temp.act_as('owner');
select pg_temp.eq('the owner sees the waiting run', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where header_id = current_setting('test.run4')::uuid and state = 'waiting' and item_kind = 'run'), 1);
select public.approve_run(current_setting('test.run4')::uuid);
select public.post_payment_run(current_setting('test.run4')::uuid);
select pg_temp.eq('posted', (select status from public.payment_runs where id = current_setting('test.run4')::uuid), 'posted');

-- 8. Bank details changed inside the window hold a small run for an admin, and the status names the supplier.
reset role;
update public.organisation_defaults set bank_change_days = 14 where organisation_id = current_setting('test.org')::uuid;
update public.suppliers set iban = 'IE29AIBK93115212345678' where code = 'HARB' and organisation_id = current_setting('test.org')::uuid;
update public.suppliers set iban = 'GB29NWBK60161331926819' where code = 'HARB' and organisation_id = current_setting('test.org')::uuid;
set local role authenticated;
select pg_temp.act_as('member');
select set_config('test.h3', pg_temp.invoice('HARB', 100)::text, true);
select set_config('test.run5', pg_temp.run(array[current_setting('test.h3')::uuid])::text, true);
select pg_temp.eq('a small run to a supplier with new bank details needs approval', pg_temp.state(current_setting('test.run5')::uuid), 'required');
select pg_temp.eq('for its bank details', (select reason from public.payment_run_approval_status(array[current_setting('test.run5')::uuid])), 'bank details');
select pg_temp.eq('and names the supplier', (select bank_suppliers from public.payment_run_approval_status(array[current_setting('test.run5')::uuid])), 'Harbour');
select pg_temp.expect_error(format($sql$select public.post_payment_run(%L)$sql$, current_setting('test.run5')), 'needs approval', 'posting it unapproved');

-- 9. Cancelling a draft run deletes its draft payments and frees the invoices.
select public.cancel_payment_run(current_setting('test.run5')::uuid);
select pg_temp.eq('the run is cancelled', (select status from public.payment_runs where id = current_setting('test.run5')::uuid), 'cancelled');
select pg_temp.eq('its payment is gone', (select count(*)::int from public.payments where payment_run_id = current_setting('test.run5')::uuid), 0);
select set_config('test.run6', pg_temp.run(array[current_setting('test.h3')::uuid])::text, true);
select pg_temp.eq('the invoice can go in another run', (select status from public.payment_runs where id = current_setting('test.run6')::uuid), 'draft');
select pg_temp.eq('numbers keep counting', (select document_number from public.payment_runs where id = current_setting('test.run6')::uuid), 'RUN-0006');
select public.cancel_payment_run(current_setting('test.run6')::uuid);

-- 10. Posting is all or nothing: an invoice paid elsewhere since the run was made stops the whole run.
reset role;
update public.organisation_defaults set bank_change_days = null where organisation_id = current_setting('test.org')::uuid;
delete from public.approval_rules;
set local role authenticated;
select pg_temp.act_as('member');
select set_config('test.v7', pg_temp.invoice('VOD', 400)::text, true);
select set_config('test.h4', pg_temp.invoice('HARB', 600)::text, true);
select set_config('test.run7', pg_temp.run(array[current_setting('test.v7')::uuid, current_setting('test.h4')::uuid])::text, true);
select set_config('test.solo', public.save_payment(jsonb_build_object(
  'transactionTypeId', pg_temp.id_of('transaction_types', 'PAY'), 'paymentDate', '2026-11-13', 'supplierId', pg_temp.id_of('suppliers', 'HARB'),
  'bankAccountId', pg_temp.id_of('bank_accounts', 'EUR1'), 'amount', 600,
  'allocations', jsonb_build_array(jsonb_build_object('targetHeaderId', current_setting('test.h4'), 'amount', 600))))::text, true);
select public.post_payment(current_setting('test.solo')::uuid);
select pg_temp.expect_error(format($sql$select public.post_payment_run(%L)$sql$, current_setting('test.run7')), 'no longer have enough open', 'a run with an invoice paid elsewhere');
select pg_temp.eq('the run is still a draft', (select status from public.payment_runs where id = current_setting('test.run7')::uuid), 'draft');
select pg_temp.eq('and none of its payments posted', (select count(*)::int from public.payments where payment_run_id = current_setting('test.run7')::uuid and status = 'posted'), 0);

-- 11. Email: a request goes to each person who could decide it, not the requester; the decision goes to the requester.
select pg_temp.act_as('owner');
select pg_temp.eq('a run request emailed the owner and the admin', (select count(*)::int from public.email_outbox where run_id = current_setting('test.run3')::uuid and reason = 'approval requested'), 4);
select pg_temp.eq('not the requester', (select count(*)::int from public.email_outbox where run_id = current_setting('test.run3')::uuid and recipient_email = 'member-run@fintran.test' and reason = 'approval requested'), 0);
select pg_temp.eq('the subject names the run and the total', (select count(*)::int from public.email_outbox where run_id = current_setting('test.run3')::uuid and subject = 'Payment run approval needed: RUN-0003 for €3,500.00'), 4);
select pg_temp.eq('the approval emailed the requester', (select count(*)::int from public.email_outbox where run_id = current_setting('test.run3')::uuid and reason = 'approved' and recipient_email = 'member-run@fintran.test'), 2);
select pg_temp.eq('the refusal carries the reason', (select count(*)::int from public.email_outbox where run_id = current_setting('test.run4')::uuid and reason = 'rejected' and body like '%Reason: Hold until Friday%'), 1);
select pg_temp.act_as('member');
select pg_temp.eq('the requester can fetch what to send', (select count(*)::int from public.queued_run_emails(current_setting('test.run3')::uuid)) > 0, true);
select pg_temp.eq('a member cannot read the outbox', (select count(*)::int from public.email_outbox), 0);

rollback;
