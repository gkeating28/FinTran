-- Purchase approvals and price tolerance (QULAPLUS_APPROVALS_SPEC.md, phases 1 and 2). Raises on failure and rolls back.
begin;

create temp table ap_users (who text primary key, id uuid not null);
insert into ap_users (who, id) values
  ('owner', 'a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9'),
  ('admin', 'b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9'),
  ('member', 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8'),
  ('solo', 'd8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d8'),
  ('outsider', 'e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-approve@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from ap_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from ap_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'approvals: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'approvals: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'approvals: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'approvals: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

grant all on table ap_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text), pg_temp.eq(text, anyelement, anyelement) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;

select set_config('test.org', (public.create_tenant('Approval Books', 'Approval Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-approve@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-approve@fintran.test', 'member');

-- A second organisation where one person is the only one who could approve.
select pg_temp.act_as('solo');
select set_config('test.org2', (public.create_tenant('Solo Books', 'Solo Office'))->>'organisation_id', true);
select set_config('test.tenant2', (select tenant_id::text from public.organisations where id = current_setting('test.org2')::uuid), true);
select pg_temp.act_as('owner');
reset role;

insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense'),
  (current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PZ', 'Zero purchases', 0, 'Expense', 'Z'),
  (current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid, 'PZ', 'Zero purchases', 0, 'Expense', 'Z');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select o.tenant, o.org, 'VOD', 'Vodafone', c.id, 'Quay 4', 'Dublin'
from (values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid), (current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid)) as o(tenant, org)
join public.currencies c on c.organisation_id = o.org and c.code = 'EUR';

insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
select o.tenant, o.org, v.code, v.description, 0, v.type, v.kind::public.document_kind, 'on_insert', null, 0
from (values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid), (current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid)) as o(tenant, org)
cross join (values
  ('PI', 'Purchase invoice', 'Purchases', 'invoice'),
  ('PJ', 'Purchase invoice without rules', 'Purchases', 'invoice'),
  ('PC', 'Purchase credit', 'Purchases', 'credit_note'),
  ('PO', 'Purchase order', 'Purchases', 'order'),
  ('PR', 'Purchase requisition', 'Purchases', 'requisition'),
  ('SI', 'Sales invoice', 'Sales', 'invoice')
) as v(code, description, type, kind);
set local role authenticated;

create function pg_temp.id_of(p_table text, p_code text, p_org text default 'test.org') returns uuid language plpgsql as $$
declare v_id uuid;
begin
  execute format('select id from public.%I where organisation_id = $1 and code = $2', p_table) into v_id using current_setting(p_org)::uuid, p_code;
  return v_id;
end $$;

-- A draft purchase document of one line, optionally with an id to change it.
create function pg_temp.draft(p_type text, p_price numeric, p_org text default 'test.org', p_id uuid default null, p_discount numeric default 0, p_preceding text default null)
returns uuid language plpgsql as $$
begin
  return public.save_document(jsonb_build_object(
    'id', p_id,
    'transactionTypeId', pg_temp.id_of('transaction_types', p_type, p_org),
    'supplierId', pg_temp.id_of('suppliers', 'VOD', p_org),
    'supplierReference', case when p_id is null then 'S-' || left(gen_random_uuid()::text, 8) else (select supplier_reference from public.transaction_headers where id = p_id) end,
    'transactionDate', '2026-11-12', 'dueDate', '2026-12-12',
    'currencyId', pg_temp.id_of('currencies', 'EUR', p_org),
    'exchangeRate', 1,
    'precedingReference', p_preceding, 'precedingDate', case when p_preceding is not null then '2026-11-01' end,
    'lines', jsonb_build_array(jsonb_build_object(
      'description', 'Goods', 'quantity', 1, 'price', p_price, 'discountAmount', p_discount,
      'vatRateId', pg_temp.id_of('vat_rates', 'PZ', p_org),
      'glCodeId', pg_temp.id_of('gl_codes', '6000', p_org)))
  ));
end $$;

create function pg_temp.status_of(p_id uuid) returns text language sql as $$ select status::text from public.transaction_headers where id = p_id $$;
create function pg_temp.approval_of(p_id uuid) returns text language sql as $$ select approval_status from public.transaction_headers where id = p_id $$;

-- 1. With no rule set, posting and activating behave as before.
select pg_temp.act_as('member');
select set_config('test.a1', pg_temp.draft('PI', 50000)::text, true);
select public.post_document(current_setting('test.a1')::uuid, null);
select pg_temp.eq('a large invoice posts when there is no rule', pg_temp.status_of(current_setting('test.a1')::uuid), 'posted');
select set_config('test.o1', pg_temp.draft('PO', 90000)::text, true);
select public.set_order_status(current_setting('test.o1')::uuid, 'open');
select pg_temp.eq('a large order activates when there is no rule', pg_temp.status_of(current_setting('test.o1')::uuid), 'open');
select pg_temp.expect_error(format($sql$select public.request_approval(%L, 'please')$sql$, current_setting('test.a1')), 'does not need approval', 'asking for approval on a posted document');

-- 2. Rules: who can write them, and what they can be for.
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 1000, 'admin')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'PI')),
  'row-level security', 'a member writing a rule');
select pg_temp.act_as('admin');
insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, pg_temp.id_of('transaction_types', 'PI'), 1000, 'admin'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, pg_temp.id_of('transaction_types', 'PI'), 10000, 'owner'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, pg_temp.id_of('transaction_types', 'PO'), 5000, 'admin');
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 100, 'admin')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'PC')),
  'purchase invoices', 'a rule on a credit note type');
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 100, 'admin')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'PR')),
  'purchase invoices', 'a rule on a requisition type');
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 100, 'admin')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'SI')),
  'purchase invoices', 'a rule on a sales type');
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 0, 'admin')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'PI')),
  'approval_rules_amount_check', 'a rule of nothing');
select pg_temp.expect_error(
  format($sql$insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role) values (%L, %L, %L, 1000, 'owner')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'PI')),
  'approval_rules_organisation_id_transaction_type_id_amount_key', 'two rules for one amount');
select pg_temp.act_as('member');
select pg_temp.eq('a member can read the rules', (select count(*)::int from public.approval_rules), 3);
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider cannot see the rules', (select count(*)::int from public.approval_rules), 0);

-- 3. An amount under the lowest rule posts. At it, approval is needed.
select pg_temp.act_as('member');
select set_config('test.a2', pg_temp.draft('PI', 999.99)::text, true);
select public.post_document(current_setting('test.a2')::uuid, null);
select pg_temp.eq('999.99 posts for a member', pg_temp.status_of(current_setting('test.a2')::uuid), 'posted');
select set_config('test.a3', pg_temp.draft('PI', 1000)::text, true);
select pg_temp.expect_error(format($sql$select public.post_document(%L, null)$sql$, current_setting('test.a3')), 'needs approval from an admin or owner. Request approval first', 'posting 1,000.00');

-- 4. Ask, wait, approve, post.
select public.request_approval(current_setting('test.a3')::uuid, 'Quarterly service');
select pg_temp.eq('asked', pg_temp.approval_of(current_setting('test.a3')::uuid), 'requested');
select pg_temp.expect_error(format($sql$select public.post_document(%L, null)$sql$, current_setting('test.a3')), 'Waiting for approval from an admin or owner', 'posting while waiting');
select pg_temp.expect_error(format($sql$select public.request_approval(%L, null)$sql$, current_setting('test.a3')), 'already been asked for', 'asking twice');
select pg_temp.expect_error(format($sql$select public.approve_document(%L, null)$sql$, current_setting('test.a3')), 'This needs an admin or owner', 'a member approving');
select pg_temp.act_as('admin');
select public.approve_document(current_setting('test.a3')::uuid, 'Fine');
select pg_temp.eq('approved', pg_temp.approval_of(current_setting('test.a3')::uuid), 'approved');
select pg_temp.eq('approved by someone else', (select approval_self from public.transaction_headers where id = current_setting('test.a3')::uuid), false);
select pg_temp.act_as('member');
select public.post_document(current_setting('test.a3')::uuid, null);
select pg_temp.eq('a member posts it once approved', pg_temp.status_of(current_setting('test.a3')::uuid), 'posted');
select pg_temp.expect_error(
  format($sql$update public.transaction_headers set approval_status = 'requested' where id = %L$sql$, current_setting('test.a3')),
  'cannot be changed', 'changing the approval on a posted document');

-- The status the screens read: waiting, who can decide, and what the document was asked for.
select pg_temp.act_as('member');
select set_config('test.s0', pg_temp.draft('PI', 1500)::text, true);
select pg_temp.eq('a document that needs approval is listed', (select count(*)::int from public.approval_status(array[current_setting('test.s0')::uuid])), 1);
select pg_temp.eq('and says it is required', (select state from public.approval_status(array[current_setting('test.s0')::uuid])), 'required');
select pg_temp.eq('a document that needs nothing is not listed', (select count(*)::int from public.approval_status(array[current_setting('test.a2')::uuid])), 0);
select public.request_approval(current_setting('test.s0')::uuid, 'Please');
select pg_temp.eq('waiting', (select state from public.approval_status(array[current_setting('test.s0')::uuid])), 'requested');
select pg_temp.eq('the requester knows who asked', (select requested_by_name from public.approval_status(array[current_setting('test.s0')::uuid])), 'member');
select pg_temp.eq('a member cannot decide', (select can_decide from public.approval_status(array[current_setting('test.s0')::uuid])), false);
select pg_temp.act_as('admin');
select pg_temp.eq('an admin can decide', (select can_decide from public.approval_status(array[current_setting('test.s0')::uuid])), true);
select public.approve_document(current_setting('test.s0')::uuid, 'Fine');
select pg_temp.eq('approved', (select state from public.approval_status(array[current_setting('test.s0')::uuid])), 'approved');
select pg_temp.eq('and who approved it', (select decided_by_name from public.approval_status(array[current_setting('test.s0')::uuid])), 'admin');
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider sees nothing', (select count(*)::int from public.approval_status(array[current_setting('test.s0')::uuid])), 0);

-- 5. The ladder: an admin for 5,000, an owner for 12,000.
select pg_temp.act_as('member');
select set_config('test.a4', pg_temp.draft('PI', 5000)::text, true);
select public.request_approval(current_setting('test.a4')::uuid, null);
select pg_temp.act_as('admin');
select public.approve_document(current_setting('test.a4')::uuid, null);
select pg_temp.act_as('member');
select set_config('test.a5', pg_temp.draft('PI', 12000)::text, true);
select public.request_approval(current_setting('test.a5')::uuid, null);
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.approve_document(%L, null)$sql$, current_setting('test.a5')), 'This needs an owner', 'an admin approving 12,000');
select pg_temp.act_as('owner');
select public.approve_document(current_setting('test.a5')::uuid, null);
select pg_temp.eq('an owner approves 12,000', pg_temp.approval_of(current_setting('test.a5')::uuid), 'approved');

-- 6. The person who asked cannot decide while someone else could.
select pg_temp.act_as('admin');
select set_config('test.a6', pg_temp.draft('PI', 2000)::text, true);
select public.request_approval(current_setting('test.a6')::uuid, null);
select pg_temp.expect_error(format($sql$select public.approve_document(%L, null)$sql$, current_setting('test.a6')), 'someone else has to decide', 'an admin approving their own request');
select pg_temp.expect_error(format($sql$select public.reject_document(%L, 'no')$sql$, current_setting('test.a6')), 'someone else has to decide', 'an admin refusing their own request');
select pg_temp.act_as('owner');
select public.approve_document(current_setting('test.a6')::uuid, null);

-- 7. Nobody else could, so the requester decides, and it is recorded.
select pg_temp.act_as('solo');
insert into public.approval_rules (tenant_id, organisation_id, transaction_type_id, amount, required_role)
values (current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid, pg_temp.id_of('transaction_types', 'PI', 'test.org2'), 1000, 'owner');
select set_config('test.s1', pg_temp.draft('PI', 3000, 'test.org2')::text, true);
select public.request_approval(current_setting('test.s1')::uuid, 'Only me');
select public.approve_document(current_setting('test.s1')::uuid, null);
select pg_temp.eq('the only owner approves their own', pg_temp.approval_of(current_setting('test.s1')::uuid), 'approved');
select pg_temp.eq('and it says so', (select approval_self from public.transaction_headers where id = current_setting('test.s1')::uuid), true);
select public.post_document(current_setting('test.s1')::uuid, null);
select pg_temp.eq('and posts', pg_temp.status_of(current_setting('test.s1')::uuid), 'posted');

-- 8. A change cancels an approval, and saving without a change does not.
select pg_temp.act_as('member');
select set_config('test.e1', pg_temp.draft('PI', 3000)::text, true);
select public.request_approval(current_setting('test.e1')::uuid, null);
select pg_temp.act_as('admin');
select public.approve_document(current_setting('test.e1')::uuid, null);
select pg_temp.act_as('member');
select pg_temp.draft('PI', 3000, 'test.org', current_setting('test.e1')::uuid);
select pg_temp.eq('saving it unchanged keeps the approval', pg_temp.approval_of(current_setting('test.e1')::uuid), 'approved');
select pg_temp.draft('PI', 3100, 'test.org', current_setting('test.e1')::uuid);
select pg_temp.expect_error(format($sql$select public.post_document(%L, null)$sql$, current_setting('test.e1')), 'Request approval first', 'posting after a price change');
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.approve_document(%L, null)$sql$, current_setting('test.e1')), 'Ask again', 'approving a version nobody asked about');
select pg_temp.act_as('member');
select public.request_approval(current_setting('test.e1')::uuid, 'Changed price');
select pg_temp.act_as('admin');
select public.approve_document(current_setting('test.e1')::uuid, null);
select pg_temp.act_as('member');
select public.post_document(current_setting('test.e1')::uuid, null);
select pg_temp.eq('approved again, it posts', pg_temp.status_of(current_setting('test.e1')::uuid), 'posted');

-- 9. Refusing needs a reason, shows it, and a changed document can be asked about again.
select set_config('test.r1', pg_temp.draft('PI', 4000)::text, true);
select public.request_approval(current_setting('test.r1')::uuid, null);
select pg_temp.act_as('admin');
select pg_temp.expect_error(format($sql$select public.reject_document(%L, '  ')$sql$, current_setting('test.r1')), 'Enter a reason', 'a refusal without a reason');
select public.reject_document(current_setting('test.r1')::uuid, 'Wrong supplier');
select pg_temp.act_as('member');
select pg_temp.expect_error(format($sql$select public.post_document(%L, null)$sql$, current_setting('test.r1')), 'Approval was refused: Wrong supplier', 'posting a refused document');
select pg_temp.draft('PI', 3900, 'test.org', current_setting('test.r1')::uuid);
select pg_temp.expect_error(format($sql$select public.post_document(%L, null)$sql$, current_setting('test.r1')), 'Request approval first', 'posting after the refusal was answered');
select public.request_approval(current_setting('test.r1')::uuid, 'Fixed');
select pg_temp.eq('asked again', pg_temp.approval_of(current_setting('test.r1')::uuid), 'requested');

-- 10. Orders: the same gate on Activate. A requisition and a credit note are not gated.
select set_config('test.o2', pg_temp.draft('PO', 6000)::text, true);
select pg_temp.expect_error(format($sql$select public.set_order_status(%L, 'open')$sql$, current_setting('test.o2')), 'needs approval from an admin or owner', 'activating a 6,000 order');
select set_config('test.o3', pg_temp.draft('PO', 4999)::text, true);
select public.set_order_status(current_setting('test.o3')::uuid, 'open');
select pg_temp.eq('an order under the rule activates', pg_temp.status_of(current_setting('test.o3')::uuid), 'open');
select public.request_approval(current_setting('test.o2')::uuid, null);
select pg_temp.act_as('admin');
select public.approve_document(current_setting('test.o2')::uuid, null);
select pg_temp.act_as('member');
select public.set_order_status(current_setting('test.o2')::uuid, 'open');
select pg_temp.eq('an approved order activates', pg_temp.status_of(current_setting('test.o2')::uuid), 'open');
select set_config('test.q1', pg_temp.draft('PR', 90000)::text, true);
select public.set_order_status(current_setting('test.q1')::uuid, 'open');
select pg_temp.eq('a requisition is not gated', pg_temp.status_of(current_setting('test.q1')::uuid), 'open');
select set_config('test.c1', pg_temp.draft('PC', 90000, 'test.org', null, 0, 'EXT-1')::text, true);
select public.post_document(current_setting('test.c1')::uuid, null);
select pg_temp.eq('a purchase credit note is not gated', pg_temp.status_of(current_setting('test.c1')::uuid), 'posted');

-- 11. Nobody writes the approval columns or the rules around the functions.
select set_config('test.d1', pg_temp.draft('PI', 2500)::text, true);
select pg_temp.expect_error(format($sql$update public.transaction_headers set approval_status = 'approved' where id = %L$sql$, current_setting('test.d1')), 'approval buttons', 'a member approving by update');
select pg_temp.expect_error(format($sql$update public.transaction_headers set approval_self = true where id = %L$sql$, current_setting('test.d1')), 'approval buttons', 'a member setting the self flag');
select pg_temp.expect_error(
  format($sql$insert into public.transaction_headers (tenant_id, organisation_id, transaction_type_id, transaction_date, supplier_id, party_name, currency_id, exchange_rate, approval_status) values (%L, %L, %L, '2026-11-12', %L, 'x', %L, 1, 'approved')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), pg_temp.id_of('transaction_types', 'PI'), pg_temp.id_of('suppliers', 'VOD'), pg_temp.id_of('currencies', 'EUR')),
  'approval buttons', 'a document made approved');
select pg_temp.act_as('outsider');
select pg_temp.expect_error(format($sql$select public.request_approval(%L, null)$sql$, current_setting('test.d1')), 'not a member', 'an outsider asking');

-- 12. A type that has rules keeps its direction and kind.
select pg_temp.act_as('owner');
select pg_temp.expect_error(
  format($sql$update public.transaction_types set document_kind = 'credit_note' where id = %L$sql$, pg_temp.id_of('transaction_types', 'PO')),
  'cannot change', 'changing the kind of a type with rules');

-- 13. Requests, approvals and refusals are in the audit log.
reset role;
select pg_temp.eq('the request is in the audit log with its note', (
  select count(*)::int from public.audit_log
  where table_name = 'transaction_headers' and row_id = current_setting('test.a3')
    and new_values->>'approval_status' = 'requested' and new_values->>'approval_note' = 'Quarterly service'), 1);
select pg_temp.eq('the approval is in the audit log', (
  select count(*)::int from public.audit_log
  where table_name = 'transaction_headers' and row_id = current_setting('test.a3') and new_values->>'approval_status' = 'approved'), 1);
select pg_temp.eq('the refusal is in the audit log with its reason', (
  select count(*)::int from public.audit_log
  where table_name = 'transaction_headers' and row_id = current_setting('test.r1') and new_values->>'approval_status' = 'rejected' and new_values->>'approval_note' = 'Wrong supplier'), 1);
select pg_temp.eq('a rule is in the audit log', (
  select count(*)::int from public.audit_log where table_name = 'approval_rules' and action = 'INSERT'), 4);
set local role authenticated;

-- 14. Price tolerance. An order for 100.00 is invoiced and the price on the invoice line is changed.
select pg_temp.act_as('owner');
update public.organisation_defaults set price_tolerance_percent = 5 where organisation_id = current_setting('test.org')::uuid;
select pg_temp.act_as('member');
-- Each invoice comes from an order of its own, because an invoice uses up what is left on the order it came from.
create function pg_temp.invoice_at(p_price numeric, p_type text default 'PI', p_discount numeric default 0) returns uuid language plpgsql as $$
declare
  v_order uuid;
  v_id uuid;
begin
  v_order := pg_temp.draft('PO', 100);
  perform public.set_order_status(v_order, 'open');
  v_id := public.create_from_order(v_order, pg_temp.id_of('transaction_types', p_type));
  update public.transaction_lines set price = p_price, discount_amount = p_discount where header_id = v_id;
  return v_id;
end $$;
create function pg_temp.over(p_id uuid) returns boolean language sql as $$ select bool_or(over) from public.price_checks(p_id) $$;

select set_config('test.t1', pg_temp.invoice_at(104)::text, true);
select pg_temp.eq('4% over a 5% tolerance is not over', pg_temp.over(current_setting('test.t1')::uuid), false);
select pg_temp.eq('the percentage is shown', (select difference_percent from public.price_checks(current_setting('test.t1')::uuid)), 4.00::numeric);
select public.post_document(current_setting('test.t1')::uuid, null);
select pg_temp.eq('an invoice within the tolerance posts', pg_temp.status_of(current_setting('test.t1')::uuid), 'posted');

select set_config('test.t2', pg_temp.invoice_at(105.01)::text, true);
select pg_temp.eq('5.01% over a 5% tolerance is over', pg_temp.over(current_setting('test.t2')::uuid), true);
select pg_temp.expect_error(format($sql$select public.post_document(%L, null)$sql$, current_setting('test.t2')), 'needs approval from an admin or owner', 'posting an invoice over the tolerance, under every rule');
select public.request_approval(current_setting('test.t2')::uuid, 'Price rise agreed by phone');
select pg_temp.eq('the reason is the price', (select approval_reason from public.transaction_headers where id = current_setting('test.t2')::uuid), 'price');
select pg_temp.act_as('admin');
select public.approve_document(current_setting('test.t2')::uuid, null);
select pg_temp.act_as('member');
select public.post_document(current_setting('test.t2')::uuid, null);
select pg_temp.eq('approved, the price breach posts', pg_temp.status_of(current_setting('test.t2')::uuid), 'posted');

select set_config('test.t3', pg_temp.invoice_at(90)::text, true);
select pg_temp.eq('a lower price is never over', pg_temp.over(current_setting('test.t3')::uuid), false);
select set_config('test.t4', pg_temp.invoice_at(110, 'PI', 10)::text, true);
select pg_temp.eq('a higher price with an offsetting discount is not over', pg_temp.over(current_setting('test.t4')::uuid), false);

-- A line typed in with no order line is not compared.
select set_config('test.t5', pg_temp.draft('PI', 500)::text, true);
select pg_temp.eq('a line with no order line has nothing to compare', (select count(*)::int from public.price_checks(current_setting('test.t5')::uuid)), 0);

-- Where the type has no rules a breach is a warning only.
select set_config('test.t6', pg_temp.invoice_at(120, 'PJ')::text, true);
select pg_temp.eq('the breach is still shown', pg_temp.over(current_setting('test.t6')::uuid), true);
select public.post_document(current_setting('test.t6')::uuid, null);
select pg_temp.eq('without rules a breach does not block posting', pg_temp.status_of(current_setting('test.t6')::uuid), 'posted');

-- The switch: a breach is shown and does not block.
select pg_temp.act_as('owner');
update public.organisation_defaults set price_tolerance_needs_approval = false where organisation_id = current_setting('test.org')::uuid;
select pg_temp.act_as('member');
select set_config('test.t7', pg_temp.invoice_at(130)::text, true);
select pg_temp.eq('with the switch off the breach is shown', pg_temp.over(current_setting('test.t7')::uuid), true);
select public.post_document(current_setting('test.t7')::uuid, null);
select pg_temp.eq('and does not block posting', pg_temp.status_of(current_setting('test.t7')::uuid), 'posted');

-- No percentage, nothing is checked.
select pg_temp.act_as('owner');
update public.organisation_defaults set price_tolerance_percent = null, price_tolerance_needs_approval = true where organisation_id = current_setting('test.org')::uuid;
select pg_temp.act_as('member');
select set_config('test.t8', pg_temp.invoice_at(500)::text, true);
select pg_temp.eq('with no tolerance nothing is checked', (select count(*)::int from public.price_checks(current_setting('test.t8')::uuid)), 0);
select public.post_document(current_setting('test.t8')::uuid, null);
select pg_temp.eq('and a big rise posts', pg_temp.status_of(current_setting('test.t8')::uuid), 'posted');
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider sees no price checks', (select count(*)::int from public.price_checks(current_setting('test.t2')::uuid)), 0);

-- A member cannot change the tolerance.
select pg_temp.act_as('member');
do $$
declare
  v_rows integer;
begin
  update public.organisation_defaults set price_tolerance_percent = 50 where organisation_id = current_setting('test.org')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'approvals: a member changed the tolerance';
  end if;
end $$;

-- 7. Email (phase 5). A request writes one row for each person who could decide it, not the requester.
select pg_temp.act_as('member');
select set_config('test.e1', pg_temp.draft('PI', 1500)::text, true);
select public.request_approval(current_setting('test.e1')::uuid, 'Needed for Friday');
select pg_temp.act_as('owner');
select pg_temp.eq('a request emails the owner and the admin', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and reason = 'approval requested'), 2);
select pg_temp.eq('and not the requester', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and recipient_email = 'member-approve@fintran.test'), 0);
select pg_temp.eq('the subject names the document and the amount', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and subject ~ '^Approval needed: PI [0-9a-zA-Z-]+ for €1,500.00$'), 2);
select pg_temp.eq('the note is in the text', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and body like '%Needed for Friday%'), 2);
select pg_temp.act_as('member');
select pg_temp.eq('a member cannot read the outbox', (select count(*)::int from public.email_outbox), 0);
select pg_temp.expect_error(
  format($sql$insert into public.email_outbox (tenant_id, organisation_id, header_id, recipient_email, reason, subject, body, link_path) values (%L, %L, %L, 'x@y.test', 'approved', 's', 'b', '/')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.e1')),
  'permission denied', 'a member writing the outbox');
select pg_temp.eq('the requester can fetch the queued emails to send', (select count(*)::int from public.queued_emails(current_setting('test.e1')::uuid)), 2);
select pg_temp.act_as('admin');
select pg_temp.eq('someone else cannot', (select count(*)::int from public.queued_emails(current_setting('test.e1')::uuid)), 0);
select pg_temp.act_as('member');
select public.record_email_result(id) from public.queued_emails(current_setting('test.e1')::uuid) order by recipient_email limit 1;
select public.record_email_result(id, 'The mail server refused it') from public.queued_emails(current_setting('test.e1')::uuid);
select pg_temp.act_as('owner');
select pg_temp.eq('one row is sent', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and status = 'sent' and sent_at is not null), 1);
select pg_temp.eq('one is failed with the reason', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and status = 'failed' and error = 'The mail server refused it'), 1);
select pg_temp.act_as('outsider');
select pg_temp.expect_error(
  format($sql$select public.record_email_result(%L)$sql$, (select id from public.email_outbox limit 1)), 'could not be found', 'an outsider marking an email');
select pg_temp.act_as('admin');
select pg_temp.eq('an admin sees the queue as waiting', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where header_id = current_setting('test.e1')::uuid and state = 'waiting'), 1);
select pg_temp.act_as('member');
select pg_temp.eq('the requester has nothing waiting on them', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where state = 'waiting'), 0);
select pg_temp.act_as('admin');
select public.approve_document(current_setting('test.e1')::uuid, 'Fine');
select pg_temp.act_as('owner');
select pg_temp.eq('an approval emails the requester once', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and reason = 'approved' and recipient_email = 'member-approve@fintran.test'), 1);
select pg_temp.eq('and carries the decider and the note', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e1')::uuid and reason = 'approved' and body like 'admin approved%' and body like '%Note: Fine%'), 1);

-- A refusal emails the requester with the reason, and the requester sees it in the queue.
select pg_temp.act_as('member');
select set_config('test.e2', pg_temp.draft('PI', 2500)::text, true);
select public.request_approval(current_setting('test.e2')::uuid, null);
select pg_temp.act_as('admin');
select public.reject_document(current_setting('test.e2')::uuid, 'Too dear');
select pg_temp.act_as('owner');
select pg_temp.eq('a refusal emails the requester with the reason', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e2')::uuid and reason = 'rejected' and body like '%Reason: Too dear%'), 1);
select pg_temp.act_as('member');
select pg_temp.eq('the requester sees it refused', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where header_id = current_setting('test.e2')::uuid and state = 'refused' and note = 'Too dear'), 1);
select pg_temp.act_as('admin');
select pg_temp.eq('the admin does not', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid) where header_id = current_setting('test.e2')::uuid), 0);
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider sees no queue', (select count(*)::int from public.approval_queue(current_setting('test.org')::uuid)), 0);

-- With the switch off nothing is queued, and the request still works.
select pg_temp.act_as('owner');
update public.organisation_defaults set approval_emails = false where organisation_id = current_setting('test.org')::uuid;
select pg_temp.act_as('member');
select set_config('test.e3', pg_temp.draft('PI', 3500)::text, true);
select public.request_approval(current_setting('test.e3')::uuid, null);
select pg_temp.eq('the request is recorded', pg_temp.approval_of(current_setting('test.e3')::uuid), 'requested');
select pg_temp.act_as('owner');
select pg_temp.eq('with the switch off no email is queued', (select count(*)::int from public.email_outbox where header_id = current_setting('test.e3')::uuid), 0);
select pg_temp.act_as('member');
do $$
declare
  v_rows integer;
begin
  update public.organisation_defaults set approval_emails = true where organisation_id = current_setting('test.org')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'approvals: a member changed the email switch';
  end if;
end $$;

rollback;
