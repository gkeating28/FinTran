-- Payment approvals (QULAPLUS_PAYMENT_APPROVALS_SPEC.md, phase 2). Raises on failure and rolls back.
begin;

create temp table pa_users (who text primary key, id uuid not null);
insert into pa_users (who, id) values
  ('owner', 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'),
  ('admin', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'),
  ('member', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2'),
  ('outsider', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-payappr@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from pa_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from pa_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'payment approvals: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'payment approvals: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'payment approvals: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'payment approvals: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

grant all on table pa_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text), pg_temp.eq(text, anyelement, anyelement) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;
select set_config('test.org', (public.create_tenant('Payment Approval Books', 'Payment Approval Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-payappr@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-payappr@fintran.test', 'member');
reset role;

insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PZ', 'Zero purchases', 0, 'Expense', 'Z');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.name, c.id, 'Quay 4', 'Dublin'
from (values ('VOD', 'Vodafone'), ('HARB', 'Harbour')) as v(code, name)
join public.currencies c on c.organisation_id = current_setting('test.org')::uuid and c.code = 'EUR';
insert into public.customers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CUS', 'Customer', c.id, 'Quay 4', 'Dublin'
from public.currencies c where c.organisation_id = current_setting('test.org')::uuid and c.code = 'EUR';
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.code, v.iban, c.id
from (values ('EUR1', 'IE29AIBK93115212345678'), ('EUR2', 'DE89370400440532013000')) as v(code, iban)
join public.currencies c on c.organisation_id = current_setting('test.org')::uuid and c.code = 'EUR';

insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v.code, v.description, 0, v.type, v.kind::public.document_kind, 'on_insert', null, 0
from (values
  ('PAY', 'Supplier payment', 'Purchases', 'payment'),
  ('PAY2', 'Supplier payment without rules', 'Purchases', 'payment'),
  ('CREF', 'Customer refund', 'Sales', 'payment'),
  ('REC', 'Customer receipt', 'Sales', 'receipt'),
  ('SREF', 'Supplier refund', 'Purchases', 'receipt'),
  ('PI', 'Purchase invoice', 'Purchases', 'invoice')
) as v(code, description, type, kind);
set local role authenticated;

create function pg_temp.id_of(p_table text, p_code text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  execute format('select id from public.%I where organisation_id = $1 and code = $2', p_table) into v_id using current_setting('test.org')::uuid, p_code;
  return v_id;
end $$;

-- A draft payment saved through save_payment, to a supplier or a customer, optionally with an id to change it.
create function pg_temp.pay(p_type text, p_amount numeric, p_party text default 'VOD', p_id uuid default null, p_bank text default 'EUR1', p_date date default '2026-11-12', p_plan jsonb default '[]')
returns uuid language plpgsql as $$
declare
  v_sales boolean := p_type in ('REC', 'CREF');
begin
  return public.save_payment(jsonb_build_object(
    'id', p_id,
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type),
    'paymentDate', p_date,
    'customerId', case when v_sales then pg_temp.id_of('customers', p_party) end,
    'supplierId', case when not v_sales then pg_temp.id_of('suppliers', p_party) end,
    'bankAccountId', pg_temp.id_of('bank_accounts', p_bank),
    'amount', p_amount,
    'allocations', p_plan
  ));
end $$;

create function pg_temp.status_of(p_id uuid) returns text language sql as $$ select status::text from public.payments where id = p_id $$;
create function pg_temp.approval_of(p_id uuid) returns text language sql as $$ select approval_status from public.payments where id = p_id $$;
create function pg_temp.rule(p_type text, p_amount numeric, p_role text) returns void language plpgsql as $$
begin
  insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, pg_temp.id_of('transaction_types', p_type), p_amount, p_role);
end $$;

-- 1. With no rule and no window, posting is as before.
select pg_temp.act_as('member');
select set_config('test.p1', pg_temp.pay('PAY', 40000)::text, true);
select public.post_payment(current_setting('test.p1')::uuid);
select pg_temp.eq('a large payment posts when there is no rule', pg_temp.status_of(current_setting('test.p1')::uuid), 'posted');
select set_config('test.p2', pg_temp.pay('PAY', 100)::text, true);
select pg_temp.expect_error(format($sql$select public.request_payment_approval(%L, 'please')$sql$, current_setting('test.p2')), 'does not need approval', 'asking for approval where none is needed');

-- 2. Rules can be made for payment types that send money out, and for no other payment type.
select pg_temp.act_as('admin');
select pg_temp.rule('PAY', 5000, 'admin');
select pg_temp.rule('CREF', 1000, 'admin');
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 100, 'admin')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'REC')),
  'payments that send money out', 'a rule for a receipt type');
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 100, 'admin')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'SREF')),
  'payments that send money out', 'a rule for a supplier refund type');
select pg_temp.expect_error(
  format($sql$update public.transaction_types set document_kind = 'receipt' where id = %L$sql$, pg_temp.id_of('transaction_types', 'CREF')),
  'approval rules', 'changing the kind of a type with rules');

-- 3. A rule of 5,000 for an admin: 4,999.99 posts, 5,000.00 is refused with the request message.
select pg_temp.act_as('member');
select set_config('test.p3', pg_temp.pay('PAY', 4999.99)::text, true);
select public.post_payment(current_setting('test.p3')::uuid);
select pg_temp.eq('under the rule posts', pg_temp.status_of(current_setting('test.p3')::uuid), 'posted');
select set_config('test.p4', pg_temp.pay('PAY', 5000)::text, true);
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.p4')), 'needs approval from an admin or owner', 'posting at the rule');

-- 4. Request, approve, post.
select public.request_payment_approval(current_setting('test.p4')::uuid, 'Rent');
select pg_temp.eq('requested', pg_temp.approval_of(current_setting('test.p4')::uuid), 'requested');
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.p4')), 'Waiting for approval', 'posting while waiting');
select pg_temp.expect_error(format($sql$select public.request_payment_approval(%L)$sql$, current_setting('test.p4')), 'already been asked', 'asking twice');
select pg_temp.expect_error(format($sql$select public.approve_payment(%L)$sql$, current_setting('test.p4')), 'needs an admin or owner', 'a member approving');
select pg_temp.act_as('admin');
select public.approve_payment(current_setting('test.p4')::uuid, 'Fine');
select pg_temp.act_as('member');
select public.post_payment(current_setting('test.p4')::uuid);
select pg_temp.eq('approved, a member posts it', pg_temp.status_of(current_setting('test.p4')::uuid), 'posted');

-- 5. A ladder: 25,000 needs an owner.
select pg_temp.act_as('owner');
select pg_temp.rule('PAY', 25000, 'owner');
select pg_temp.act_as('member');
select set_config('test.p5', pg_temp.pay('PAY', 12000)::text, true);
select public.request_payment_approval(current_setting('test.p5')::uuid);
select pg_temp.act_as('admin');
select public.approve_payment(current_setting('test.p5')::uuid);
select pg_temp.eq('an admin approves 12,000', pg_temp.approval_of(current_setting('test.p5')::uuid), 'approved');
select pg_temp.act_as('member');
select set_config('test.p6', pg_temp.pay('PAY', 30000)::text, true);
select public.request_payment_approval(current_setting('test.p6')::uuid);
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.approve_payment(%L)$sql$, current_setting('test.p6')), 'needs an owner', 'an admin approving an owner payment');
select pg_temp.act_as('owner');
select public.approve_payment(current_setting('test.p6')::uuid);
select pg_temp.eq('an owner approves 30,000', pg_temp.approval_of(current_setting('test.p6')::uuid), 'approved');

-- 6. The requester can never decide, even as the only owner.
select set_config('test.p7', pg_temp.pay('PAY', 30000, 'HARB')::text, true);
select public.request_payment_approval(current_setting('test.p7')::uuid);
select pg_temp.expect_error(format($sql$select public.approve_payment(%L)$sql$, current_setting('test.p7')), 'someone else has to decide', 'the only owner approving their own request');
select pg_temp.expect_error(format($sql$select public.reject_payment(%L, 'No')$sql$, current_setting('test.p7')), 'someone else has to decide', 'the only owner refusing their own request');
select pg_temp.eq('nothing changed', pg_temp.approval_of(current_setting('test.p7')::uuid), 'requested');
select pg_temp.act_as('admin');
select pg_temp.eq('an admin cannot decide an owner payment', (select can_decide from public.payment_approval_status(array[current_setting('test.p7')::uuid])), false);
select pg_temp.act_as('owner');
select pg_temp.eq('nor can the requester', (select can_decide from public.payment_approval_status(array[current_setting('test.p7')::uuid])), false);

-- A 6,000 request by an admin cannot be approved by that admin, and the owner can.
select pg_temp.act_as('admin');
select set_config('test.p8', pg_temp.pay('PAY', 6000)::text, true);
select public.request_payment_approval(current_setting('test.p8')::uuid);
select pg_temp.expect_error(format($sql$select public.approve_payment(%L)$sql$, current_setting('test.p8')), 'someone else has to decide', 'an admin approving their own request');
select pg_temp.act_as('owner');
select pg_temp.eq('the owner can decide it', (select can_decide from public.payment_approval_status(array[current_setting('test.p8')::uuid])), true);
select public.approve_payment(current_setting('test.p8')::uuid);

-- 7. A change cancels an approval, and saving without a change does not.
select pg_temp.act_as('member');
select set_config('test.p9', pg_temp.pay('PAY', 7000)::text, true);
select public.request_payment_approval(current_setting('test.p9')::uuid);
select pg_temp.act_as('admin');
select public.approve_payment(current_setting('test.p9')::uuid);
select pg_temp.act_as('member');
select pg_temp.pay('PAY', 7000, 'VOD', current_setting('test.p9')::uuid);
select pg_temp.eq('an unchanged save keeps the approval', (select state from public.payment_approval_status(array[current_setting('test.p9')::uuid])), 'approved');
select pg_temp.pay('PAY', 7000.01, 'VOD', current_setting('test.p9')::uuid);
select pg_temp.eq('a changed amount cancels it', (select state from public.payment_approval_status(array[current_setting('test.p9')::uuid])), 'required');
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.p9')), 'Request approval first', 'posting after a change');
select public.request_payment_approval(current_setting('test.p9')::uuid);
select pg_temp.act_as('admin');
select public.approve_payment(current_setting('test.p9')::uuid);
select pg_temp.act_as('member');
select pg_temp.pay('PAY', 7000.01, 'VOD', current_setting('test.p9')::uuid, 'EUR2');
select pg_temp.eq('a changed bank account cancels it', (select state from public.payment_approval_status(array[current_setting('test.p9')::uuid])), 'required');
select public.request_payment_approval(current_setting('test.p9')::uuid);
select pg_temp.act_as('admin');
select public.approve_payment(current_setting('test.p9')::uuid);
select pg_temp.act_as('member');
select pg_temp.pay('PAY', 7000.01, 'VOD', current_setting('test.p9')::uuid, 'EUR2', '2026-11-13');
select pg_temp.eq('a changed date cancels it', (select state from public.payment_approval_status(array[current_setting('test.p9')::uuid])), 'required');
select public.request_payment_approval(current_setting('test.p9')::uuid);
select pg_temp.act_as('admin');
select public.approve_payment(current_setting('test.p9')::uuid);
select pg_temp.act_as('member');
select pg_temp.pay('PAY', 7000.01, 'HARB', current_setting('test.p9')::uuid, 'EUR2', '2026-11-13');
select pg_temp.eq('a changed supplier cancels it', (select state from public.payment_approval_status(array[current_setting('test.p9')::uuid])), 'required');

-- 8. A refusal needs a reason, shows it, and the payment can be changed and asked again.
select set_config('test.p10', pg_temp.pay('PAY', 8000)::text, true);
select public.request_payment_approval(current_setting('test.p10')::uuid);
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.reject_payment(%L, '  ')$sql$, current_setting('test.p10')), 'reason', 'a refusal without a reason');
select public.reject_payment(current_setting('test.p10')::uuid, 'Not due yet');
select pg_temp.act_as('member');
select pg_temp.eq('the reason is kept', (select note from public.payment_approval_status(array[current_setting('test.p10')::uuid])), 'Not due yet');
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.p10')), 'Approval was refused: Not due yet', 'posting a refused payment');
select pg_temp.eq('the requester sees it in the queue as refused', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where header_id = current_setting('test.p10')::uuid and state = 'refused' and item_kind = 'payment'), 1);
select pg_temp.pay('PAY', 7999, 'VOD', current_setting('test.p10')::uuid);
select public.request_payment_approval(current_setting('test.p10')::uuid);
select pg_temp.eq('asked again after a change', pg_temp.approval_of(current_setting('test.p10')::uuid), 'requested');

-- 9. The queue shows an admin what waits for them, and a member nothing.
select pg_temp.act_as('admin');
select pg_temp.eq('an admin sees the waiting payment', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where header_id = current_setting('test.p10')::uuid and state = 'waiting'), 1);
select pg_temp.act_as('member');
select pg_temp.eq('a member sees no waiting payment', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where state = 'waiting'), 0);
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider sees nothing', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid)), 0);
select pg_temp.eq('and no status', (select count(*)::int from public.payment_approval_status(array[current_setting('test.p10')::uuid])), 0);

-- 10. Receipts, supplier refunds and the other kinds are never held back.
select pg_temp.act_as('member');
select set_config('test.r1', pg_temp.pay('REC', 90000, 'CUS')::text, true);
select public.post_payment(current_setting('test.r1')::uuid);
select pg_temp.eq('a large receipt posts', pg_temp.status_of(current_setting('test.r1')::uuid), 'posted');
select set_config('test.r2', pg_temp.pay('SREF', 90000)::text, true);
select public.post_payment(current_setting('test.r2')::uuid);
select pg_temp.eq('a large supplier refund posts', pg_temp.status_of(current_setting('test.r2')::uuid), 'posted');
-- A customer refund has its own rule, on its amount only.
select set_config('test.c1', pg_temp.pay('CREF', 1500, 'CUS')::text, true);
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.c1')), 'needs approval', 'a customer refund over its rule');

-- 11. Nobody writes the approval columns directly.
select pg_temp.expect_error(format($sql$update public.payments set approval_status = 'approved' where id = %L$sql$, current_setting('test.p10')), 'approval buttons', 'a direct approval');
select pg_temp.act_as('owner');
select pg_temp.expect_error(format($sql$update public.payments set approval_status = 'approved' where id = %L$sql$, current_setting('test.p10')), 'approval buttons', 'an owner writing approval directly');

-- 12. The bank change window: a recent change holds a small payment, whatever the rules say.
reset role;
update public.organisation_defaults set bank_change_days = 14 where organisation_id = current_setting('test.org')::uuid;
update public.suppliers set iban = 'IE29AIBK93115212345678' where code = 'HARB' and organisation_id = current_setting('test.org')::uuid;
update public.suppliers set iban = 'GB29NWBK60161331926819' where code = 'HARB' and organisation_id = current_setting('test.org')::uuid;
set local role authenticated;
select pg_temp.act_as('member');
select set_config('test.b1', pg_temp.pay('PAY2', 10, 'HARB')::text, true);
select pg_temp.expect_error(format($sql$select public.post_payment(%L)$sql$, current_setting('test.b1')), 'needs approval from an admin or owner', 'a payment to a supplier with new bank details');
select public.request_payment_approval(current_setting('test.b1')::uuid);
select pg_temp.eq('the reason is the bank details', (select reason from public.payment_approval_status(array[current_setting('test.b1')::uuid])), 'bank details');
select pg_temp.eq('an admin is needed', (select required_role from public.payment_approval_status(array[current_setting('test.b1')::uuid])), 'admin');
select pg_temp.act_as('admin');
select public.approve_payment(current_setting('test.b1')::uuid);
select pg_temp.act_as('member');
select public.post_payment(current_setting('test.b1')::uuid);
select pg_temp.eq('approved, it posts', pg_temp.status_of(current_setting('test.b1')::uuid), 'posted');
-- A supplier whose details did not change is not held back, and nor is a customer refund by this rule.
select set_config('test.b2', pg_temp.pay('PAY2', 10, 'VOD')::text, true);
select public.post_payment(current_setting('test.b2')::uuid);
select pg_temp.eq('a supplier with no change posts', pg_temp.status_of(current_setting('test.b2')::uuid), 'posted');
-- With a rule as well, the reason says both.
select set_config('test.b3', pg_temp.pay('PAY', 6000, 'HARB')::text, true);
select pg_temp.eq('amount and bank details together', (select reason from public.payment_approval_status(array[current_setting('test.b3')::uuid])), 'amount and bank details');
-- Outside the window the supplier is not held back.
reset role;
update public.supplier_bank_changes set changed_at = now() - interval '20 days';
set local role authenticated;
select pg_temp.act_as('member');
select set_config('test.b4', pg_temp.pay('PAY2', 10, 'HARB')::text, true);
select public.post_payment(current_setting('test.b4')::uuid);
select pg_temp.eq('outside the window it posts', pg_temp.status_of(current_setting('test.b4')::uuid), 'posted');

-- 13. Email: a request goes to each person who could decide it, not the requester; a decision goes to the requester.
select pg_temp.act_as('owner');
select pg_temp.eq('a request emailed the owner and the admin', (select count(*)::int from public.email_outbox where payment_id = current_setting('test.p4')::uuid and reason = 'approval requested'), 2);
select pg_temp.eq('and not the requester', (select count(*)::int from public.email_outbox where payment_id = current_setting('test.p4')::uuid and recipient_email = 'member-payappr@fintran.test' and reason = 'approval requested'), 0);
select pg_temp.eq('the subject names the payment and the amount', (select count(*)::int from public.email_outbox where payment_id = current_setting('test.p4')::uuid and subject ~ '^Payment approval needed: PAY [0-9a-zA-Z-]+ for €5,000.00$'), 2);
select pg_temp.eq('the approval emailed the requester', (select count(*)::int from public.email_outbox where payment_id = current_setting('test.p4')::uuid and reason = 'approved' and recipient_email = 'member-payappr@fintran.test'), 1);
select pg_temp.eq('the refusal carries the reason', (select count(*)::int from public.email_outbox where payment_id = current_setting('test.p10')::uuid and reason = 'rejected' and body like '%Reason: Not due yet%'), 1);
select pg_temp.act_as('member');
select pg_temp.eq('the requester can fetch what to send (two requests, two approvers each)', (select count(*)::int from public.queued_payment_emails(current_setting('test.p10')::uuid) where subject like 'Payment approval needed%'), 4);
select pg_temp.eq('a member cannot read the outbox', (select count(*)::int from public.email_outbox), 0);

-- 14. A posted payment's approval record cannot change.
select pg_temp.expect_error(format($sql$update public.payments set approval_note = 'later' where id = %L$sql$, current_setting('test.p4')), 'posted payment', 'changing a posted payment''s approval');

rollback;
