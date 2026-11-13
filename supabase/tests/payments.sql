-- Payments release B, phase 2: payment kinds and the payments table. Raises on failure and rolls back.
begin;

create temp table pay_users (who text primary key, id uuid not null);
insert into pay_users (who, id) values
  ('owner', 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5'),
  ('member', 'c6c6c6c6-c6c6-4c6c-8c6c-c6c6c6c6c6c6'),
  ('outsider', 'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-pay@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from pay_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from pay_users where who = p_who), 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'payments: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'payments: %' then
      raise;
    end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'payments: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end;
$$;

grant all on table pay_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;

select set_config('test.org', (public.create_tenant('Pay Books', 'Pay Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Pay Second', 'EUR'))::text, true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-pay@fintran.test', 'member');

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'GBP', 'Pound sterling', 0.85)
on conflict (organisation_id, code) do nothing;

select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'), true);
select set_config('test.gbp', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'GBP'), true);
select set_config('test.eur2', (select id::text from public.currencies where organisation_id = current_setting('test.org2')::uuid and code = 'EUR'), true);

insert into public.customers (tenant_id, organisation_id, code, name, currency_id)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CUS', 'Customer', current_setting('test.eur')::uuid),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CUSGBP', 'Sterling customer', current_setting('test.gbp')::uuid),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'CUS2', 'Other customer', current_setting('test.eur2')::uuid);
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', current_setting('test.eur')::uuid),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'VOD2', 'Other supplier', current_setting('test.eur2')::uuid);
select set_config('test.cus', (select id::text from public.customers where code = 'CUS' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.cusgbp', (select id::text from public.customers where code = 'CUSGBP'), true);
select set_config('test.cus2', (select id::text from public.customers where code = 'CUS2'), true);
select set_config('test.vod', (select id::text from public.suppliers where code = 'VOD' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.vod2', (select id::text from public.suppliers where code = 'VOD2'), true);

insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR1', 'Euro account', 'IE29AIBK93115212345678', current_setting('test.eur')::uuid),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'GBP1', 'Sterling account', 'GB82WEST12345698765432', current_setting('test.gbp')::uuid),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'EUR2', 'Other euro account', 'DE89370400440532013000', current_setting('test.eur2')::uuid);
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id, active)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'OLD', 'Closed account', 'NL91ABNA0417164300', current_setting('test.eur')::uuid, false);
select set_config('test.bank_eur', (select id::text from public.bank_accounts where code = 'EUR1'), true);
select set_config('test.bank_gbp', (select id::text from public.bank_accounts where code = 'GBP1'), true);
select set_config('test.bank_old', (select id::text from public.bank_accounts where code = 'OLD'), true);
select set_config('test.bank_other', (select id::text from public.bank_accounts where code = 'EUR2'), true);

-- Types: customer receipt, supplier payment, customer refund and supplier refund, in the first organisation. One document type.
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'REC', 'Customer receipt', 0, 'Sales', 'receipt', 'on_post', 'R-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PAY', 'Supplier payment', 0, 'Purchases', 'payment', 'on_insert', 'P-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CREF', 'Customer refund', 0, 'Sales', 'payment', 'on_post', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SREF', 'Supplier refund', 0, 'Purchases', 'receipt', 'on_insert', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', 'on_insert', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'REC', 'Other receipt', 0, 'Sales', 'receipt', 'on_post', null, 0);
select set_config('test.t_rec', (select id::text from public.transaction_types where code = 'REC' and organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.t_pay', (select id::text from public.transaction_types where code = 'PAY'), true);
select set_config('test.t_cref', (select id::text from public.transaction_types where code = 'CREF'), true);
select set_config('test.t_sref', (select id::text from public.transaction_types where code = 'SREF'), true);
select set_config('test.t_pi', (select id::text from public.transaction_types where code = 'PI'), true);
select set_config('test.t_rec2', (select id::text from public.transaction_types where code = 'REC' and organisation_id = current_setting('test.org2')::uuid), true);

-- A payment as the tests write it.
create function pg_temp.draft(p_type text, p_party_column text, p_party text, p_bank text, p_amount numeric, p_rate numeric default null)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  execute format(
    'insert into public.payments (tenant_id, organisation_id, transaction_type_id, payment_date, %I, bank_account_id, currency_id, exchange_rate, amount, party_name)
     values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L) returning id',
    p_party_column, current_setting('test.tenant'), current_setting('test.org'), current_setting(p_type), '2026-11-01', p_party,
    nullif(p_bank, ''), current_setting('test.eur'), p_rate, p_amount, 'typed name')
  into v_id;
  return v_id;
end;
$$;
grant execute on function pg_temp.draft(text, text, text, text, numeric, numeric) to authenticated;

-- A customer receipt: the party decides name and currency, the rate is 1 for the home currency, the home amount is set.
select set_config('test.p1', pg_temp.draft('test.t_rec', 'customer_id', current_setting('test.cus'), current_setting('test.bank_eur'), 100.00)::text, true);
do $$
declare
  v record;
begin
  select * into v from public.payments where id = current_setting('test.p1')::uuid;
  if v.party_name <> 'Customer' then raise exception 'payments: the party name was %', v.party_name; end if;
  if v.currency_id <> current_setting('test.eur')::uuid then raise exception 'payments: the currency was not the party currency'; end if;
  if v.exchange_rate <> 1 or v.home_amount <> 100.00 then raise exception 'payments: rate % home amount %', v.exchange_rate, v.home_amount; end if;
  if v.status <> 'draft' or v.reference is not null or v.document_number is not null then
    raise exception 'payments: an on-post draft should have no number yet';
  end if;
  if v.allocated_amount <> 0 or v.unallocated_amount <> 100.00 or v.home_unallocated_amount <> 100.00 then
    raise exception 'payments: a new payment should be wholly unallocated';
  end if;
  if v.payment_means_code <> '58' then raise exception 'payments: the means should default to 58'; end if;
  if v.source <> 'manual' then raise exception 'payments: the source should default to manual'; end if;
end;
$$;

-- An on-insert type numbers the draft straight away, with the prefix and padding.
select set_config('test.p2', pg_temp.draft('test.t_pay', 'supplier_id', current_setting('test.vod'), current_setting('test.bank_eur'), 250.50)::text, true);
do $$
begin
  if (select document_number from public.payments where id = current_setting('test.p2')::uuid) is distinct from 'P-0001' then
    raise exception 'payments: the on-insert number was %', (select document_number from public.payments where id = current_setting('test.p2')::uuid);
  end if;
end;
$$;

-- A foreign currency: the rate defaults from the currency, and the home amount is amount / rate.
select set_config('test.p3', (
  select pg_temp.draft('test.t_rec', 'customer_id', current_setting('test.cusgbp'), current_setting('test.bank_gbp'), 100.00)::text), true);
do $$
declare
  v record;
begin
  select * into v from public.payments where id = current_setting('test.p3')::uuid;
  if v.currency_id <> current_setting('test.gbp')::uuid or v.exchange_rate <> 0.85 or v.home_amount <> 117.65 then
    raise exception 'payments: GBP payment had rate % and home amount %', v.exchange_rate, v.home_amount;
  end if;
end;
$$;

-- Direction and party (K2).
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_sref', 'customer_id', %L, %L, 10)$sql$, current_setting('test.cus'), current_setting('test.bank_eur')),
  'Choose a supplier', 'a Purchases receipt with a customer');
select set_config('test.p4', pg_temp.draft('test.t_sref', 'supplier_id', current_setting('test.vod'), current_setting('test.bank_eur'), 10)::text, true);
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'supplier_id', %L, %L, 10)$sql$, current_setting('test.vod'), current_setting('test.bank_eur')),
  'Choose a customer', 'a Sales receipt with a supplier');
select set_config('test.p5', pg_temp.draft('test.t_cref', 'customer_id', current_setting('test.cus'), current_setting('test.bank_eur'), 10)::text, true);
select pg_temp.expect_error(
  format($sql$insert into public.payments (tenant_id, organisation_id, transaction_type_id, payment_date, customer_id, supplier_id, bank_account_id, currency_id, exchange_rate, amount, party_name) values (%L, %L, %L, '2026-11-01', %L, %L, %L, %L, 1, 10, 'x')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.t_rec'), current_setting('test.cus'), current_setting('test.vod'), current_setting('test.bank_eur'), current_setting('test.eur')),
  'not a supplier', 'both a customer and a supplier')
;
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_pi', 'supplier_id', %L, %L, 10)$sql$, current_setting('test.vod'), current_setting('test.bank_eur')),
  'payment or receipt transaction type', 'a payment on an invoice type');

-- Bank account: required, active, in the payment currency, from the same organisation.
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, %L, 10)$sql$, current_setting('test.cus'), current_setting('test.bank_gbp')),
  'payment currency', 'a bank account in another currency');
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, '', 10)$sql$, current_setting('test.cus')),
  'bank', 'a payment with no bank account');
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, %L, 10)$sql$, current_setting('test.cus'), current_setting('test.bank_old')),
  'not active', 'an inactive bank account');
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, %L, 10)$sql$, current_setting('test.cus'), current_setting('test.bank_other')),
  'from this organisation', 'a bank account from another organisation');

-- Rate and amount.
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, %L, 10, 1.1)$sql$, current_setting('test.cus'), current_setting('test.bank_eur')),
  'must be 1', 'a home currency rate other than 1');
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, %L, 0)$sql$, current_setting('test.cus'), current_setting('test.bank_eur')),
  'payments_amount_check', 'a zero amount');

-- Nothing can reach across organisations.
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, %L, 10)$sql$, current_setting('test.cus2'), current_setting('test.bank_eur')),
  'from this organisation', 'a customer from another organisation');
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec2', 'customer_id', %L, %L, 10)$sql$, current_setting('test.cus'), current_setting('test.bank_eur')),
  'payment or receipt transaction type', 'a type from another organisation');
select pg_temp.expect_error(
  format($sql$insert into public.payments (tenant_id, organisation_id, transaction_type_id, payment_date, customer_id, currency_id, exchange_rate, amount, party_name, source) values (%L, %L, %L, '2026-11-01', %L, %L, 1, 10, 'x', 'migrated')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.t_rec'), current_setting('test.cus'), current_setting('test.eur2')),
  'payments_currency_fkey', 'a currency from another organisation');
select pg_temp.expect_error(
  format($sql$update public.payments set organisation_id = %L where id = %L$sql$, current_setting('test.org2'), current_setting('test.p1')),
  'cannot be moved', 'moving a payment to another organisation');
select pg_temp.expect_error(
  format($sql$update public.payments set transaction_type_id = %L where id = %L$sql$, current_setting('test.t_cref'), current_setting('test.p1')),
  'cannot be moved', 'changing the type of a payment');

-- A header cannot have a payment or receipt type.
select pg_temp.expect_error(
  format($sql$insert into public.transaction_headers (tenant_id, organisation_id, transaction_type_id, transaction_date, customer_id, party_name, currency_id, exchange_rate) values (%L, %L, %L, '2026-11-01', %L, 'Customer', %L, 1)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.t_rec'), current_setting('test.cus'), current_setting('test.eur')),
  'for payments, not documents', 'a document on a receipt type');
select pg_temp.expect_error(
  format($sql$insert into public.transaction_headers (tenant_id, organisation_id, transaction_type_id, transaction_date, supplier_id, party_name, currency_id, exchange_rate) values (%L, %L, %L, '2026-11-01', %L, 'Vodafone', %L, 1)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.t_pay'), current_setting('test.vod'), current_setting('test.eur')),
  'for payments, not documents', 'a document on a payment type');

-- Status can only change through posting and voiding.
select pg_temp.expect_error(
  format($sql$update public.payments set status = 'posted', posted_at = now(), document_number = 'X-1', reference = 1 where id = %L$sql$, current_setting('test.p2')),
  'only be changed by posting or voiding', 'posting by a plain update');
select pg_temp.expect_error(
  format($sql$insert into public.payments (tenant_id, organisation_id, transaction_type_id, payment_date, customer_id, bank_account_id, currency_id, exchange_rate, amount, party_name, status, posted_at, reference, document_number) values (%L, %L, %L, '2026-11-01', %L, %L, %L, 1, 10, 'x', 'posted', now(), 9, 'R-9')$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.t_rec'), current_setting('test.cus'), current_setting('test.bank_eur'), current_setting('test.eur')),
  'only be changed by posting or voiding', 'inserting a posted payment');

-- Allocated amounts are not typed.
select pg_temp.expect_error(
  format($sql$update public.payments set allocated_amount = 50, unallocated_amount = 50 where id = %L$sql$, current_setting('test.p1')),
  'worked out from allocations', 'typing an allocated amount');

-- A draft can be edited, and its amounts follow.
update public.payments set amount = 200, notes = ' a note ', bank_reference = 'INV 77' where id = current_setting('test.p1')::uuid;
do $$
declare
  v record;
begin
  select * into v from public.payments where id = current_setting('test.p1')::uuid;
  if v.amount <> 200 or v.home_amount <> 200 or v.unallocated_amount <> 200 or v.notes <> 'a note' then
    raise exception 'payments: a draft edit was not applied';
  end if;
end;
$$;

-- Posted: the posting function does not exist yet, so the test posts the way the function will, by setting the flag.
select set_config('fintran.status_change', 'on', true);
update public.payments set status = 'posted', posted_at = now(), posted_by = auth.uid(), reference = 1 where id = current_setting('test.p2')::uuid;
select set_config('fintran.status_change', 'off', true);
select pg_temp.expect_error(
  format($sql$update public.payments set amount = 1 where id = %L$sql$, current_setting('test.p2')),
  'notes and the bank reference', 'changing the amount of a posted payment');
select pg_temp.expect_error(
  format($sql$update public.payments set payment_means_code = '30' where id = %L$sql$, current_setting('test.p2')),
  'notes and the bank reference', 'changing the means of a posted payment');
select pg_temp.expect_error(
  format($sql$update public.payments set payment_date = '2026-01-01' where id = %L$sql$, current_setting('test.p2')),
  'notes and the bank reference', 'changing the date of a posted payment');
update public.payments set notes = 'Cleared with the bank', bank_reference = 'REF 1' where id = current_setting('test.p2')::uuid;
do $$
begin
  if (select notes from public.payments where id = current_setting('test.p2')::uuid) <> 'Cleared with the bank' then
    raise exception 'payments: notes on a posted payment were not saved';
  end if;
  if not exists (select 1 from public.audit_log where table_name = 'payments' and row_id = current_setting('test.p2') and action = 'UPDATE' and new_values ? 'notes') then
    raise exception 'payments: a change of notes was not audited';
  end if;
end;
$$;
-- Row level security hides a posted payment from delete, so nothing is deleted.
delete from public.payments where id = current_setting('test.p2')::uuid;
do $$
begin
  if not exists (select 1 from public.payments where id = current_setting('test.p2')::uuid) then
    raise exception 'payments: a posted payment was deleted';
  end if;
end;
$$;

-- Drafts can be deleted.
delete from public.payments where id = current_setting('test.p4')::uuid;
do $$
begin
  if exists (select 1 from public.payments where id = current_setting('test.p4')::uuid) then
    raise exception 'payments: a draft could not be deleted';
  end if;
end;
$$;

-- A member can enter and change drafts, and an outsider sees nothing.
select pg_temp.act_as('member');
select set_config('test.p6', pg_temp.draft('test.t_rec', 'customer_id', current_setting('test.cus'), current_setting('test.bank_eur'), 30)::text, true);
update public.payments set notes = 'member note' where id = current_setting('test.p6')::uuid;
delete from public.payments where id = current_setting('test.p6')::uuid;
select pg_temp.act_as('outsider');
do $$
begin
  if exists (select 1 from public.payments) then
    raise exception 'payments: an outsider can see payments';
  end if;
end;
$$;
select pg_temp.expect_error(
  format($sql$select pg_temp.draft('test.t_rec', 'customer_id', %L, %L, 10)$sql$, current_setting('test.cus'), current_setting('test.bank_eur')),
  'row-level security', 'an outsider entering a payment');

-- A bank account used by a payment cannot be deleted.
select pg_temp.act_as('owner');
select pg_temp.expect_error(
  format($sql$delete from public.bank_accounts where id = %L$sql$, current_setting('test.bank_eur')),
  'payments_bank_account_fkey', 'deleting a bank account that a payment uses');

-- System types: made by migrations only.
select pg_temp.expect_error(
  format($sql$insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, is_system) values (%L, %L, 'MIGREC', 'x', 0, 'Sales', 'receipt', true)$sql$,
    current_setting('test.tenant'), current_setting('test.org')),
  'made by the system', 'a person making a system type');
select pg_temp.expect_error(
  format($sql$update public.transaction_types set is_system = true where id = %L$sql$, current_setting('test.t_rec')),
  'kept by the system', 'a person making a type a system type');
select pg_temp.expect_error(
  format($sql$update public.transaction_types set type = 'Purchases' where id = %L$sql$, current_setting('test.t_rec')),
  'after a payment has been entered', 'changing the direction of a type with payments');
select pg_temp.expect_error(
  format($sql$delete from public.transaction_types where id = %L$sql$, current_setting('test.t_rec')),
  'payments_transaction_type_fkey', 'deleting a type with payments');

-- An organisation with a payment cannot be deleted. Neither can its tenant.
select pg_temp.expect_error(
  format($sql$select public.delete_organisation(%L)$sql$, current_setting('test.org')),
  'has payments and cannot be deleted', 'deleting an organisation with payments');
reset role;
select pg_temp.expect_error(
  format($sql$delete from public.tenants where id = %L$sql$, current_setting('test.tenant')),
  'violates foreign key', 'deleting a tenant with payments');
select pg_temp.act_as('owner');
set local role authenticated;
-- The second organisation has none and can still be deleted.
select public.delete_organisation(current_setting('test.org2')::uuid);

rollback;
