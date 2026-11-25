-- Ledger release A, phase 1: the chart of accounts (QULAPLUS_LEDGER_SPEC.md). Raises on failure and rolls back.
begin;

create temp table lc_users (who text primary key, id uuid not null);
insert into lc_users (who, id) values
  ('owner', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'),
  ('admin', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2'),
  ('member', 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-chart@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from lc_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from lc_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'chart of accounts: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'chart of accounts: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'chart of accounts: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'chart of accounts: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;
create function pg_temp.gl(p_org text, p_code text) returns uuid language sql as
  $$ select id from public.gl_codes where organisation_id = current_setting(p_org)::uuid and code = p_code $$;
create function pg_temp.role_code(p_org text, p_role text) returns text language sql as
  $$ select code from public.gl_codes where organisation_id = current_setting(p_org)::uuid and system_role = p_role $$;
grant all on table lc_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.eq(text, anyelement, anyelement), pg_temp.expect_error(text, text, text),
  pg_temp.gl(text, text), pg_temp.role_code(text, text) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;
select set_config('test.org', (public.create_tenant('Chart Books', 'Chart Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-chart@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-chart@fintran.test', 'member');
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Chart Second', 'EUR'))::text, true);

-- 1. A new organisation has one account for each of the eight roles, of the right type.
select pg_temp.eq('eight roles', (select count(*) from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role is not null)::int, 8);
select pg_temp.eq('role codes',
  (select string_agg(system_role || '=' || code, ' ' order by system_role) from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role is not null),
  'creditors_control=2100 debtors_control=1100 fx_difference=7900 retained_earnings=3200 rounding=7910 suspense=9990 vat_input=1200 vat_output=2200');
select pg_temp.eq('role types',
  (select count(*) from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role is not null
     and account_type = private.role_account_type(system_role))::int, 8);
select pg_temp.eq('a second organisation has its own', (select count(*) from public.gl_codes where organisation_id = current_setting('test.org2')::uuid and system_role is not null)::int, 8);
select pg_temp.eq('normal balances', private.account_normal_balance('Income') || '/' || private.account_normal_balance('Cost of Sales') || '/' || private.account_normal_balance('Equity'), 'credit/debit/credit');
select pg_temp.eq('the Accounting tab columns follow the roles',
  (select receivables_gl_code_id from public.accounting_settings where organisation_id = current_setting('test.org')::uuid), pg_temp.gl('test.org', '1100'));

-- 2. Types and roles.
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'LIAB', 'A liability', 'Current Liability'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ASSET2', 'Another asset', 'Current Asset'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'COS', 'Cost of sales', 'Cost of Sales'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'INC', 'Income', 'Income'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'NCL', 'Loan', 'Non-current Liability'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EQ', 'Share capital', 'Equity');
select pg_temp.eq('the new types are accepted', (select count(*) from public.gl_codes where organisation_id = current_setting('test.org')::uuid and account_type in ('Cost of Sales', 'Non-current Liability', 'Equity'))::int, 4);
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'vat_input', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org', 'LIAB')), 'needs a Current Asset account', 'a liability as VAT on purchases');
select pg_temp.expect_error(format($sql$update public.gl_codes set system_role = 'vat_input' where id = %L$sql$, pg_temp.gl('test.org', 'LIAB')), 'needs a Current Asset account', 'a liability given a role directly');
select pg_temp.expect_error(format($sql$update public.gl_codes set account_type = 'Income' where id = %L$sql$, pg_temp.gl('test.org', '1100')), 'needs a Current Asset account', 'changing the type of a role account');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'suspense', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org', '1100')), 'already has the role debtors_control', 'one code for two roles');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'suspense', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org2', '1100')), 'Choose a GL code of this organisation', 'another organisation''s code');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'nonsense', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org', 'ASSET2')), 'not a system role', 'an unknown role');

select pg_temp.act_as('member');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'suspense', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org', 'ASSET2')), 'owner or admin', 'a member setting a role');
select pg_temp.act_as('admin');
select public.set_system_role(current_setting('test.org')::uuid, 'suspense', pg_temp.gl('test.org', 'ASSET2'));
select pg_temp.eq('an admin moved the suspense role', pg_temp.role_code('test.org', 'suspense'), 'ASSET2');
select pg_temp.eq('the old holder lost it', (select system_role from public.gl_codes where id = pg_temp.gl('test.org', '9990')), null::text);
select pg_temp.eq('the Accounting tab columns moved with it',
  (select suspense_gl_code_id from public.accounting_settings where organisation_id = current_setting('test.org')::uuid), pg_temp.gl('test.org', 'ASSET2'));
select pg_temp.eq('still one holder', (select count(*) from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role = 'suspense')::int, 1);
select pg_temp.expect_error(format($sql$update public.accounting_settings set suspense_gl_code_id = %L where organisation_id = %L$sql$, pg_temp.gl('test.org', '9990'), current_setting('test.org')), 'set_system_role', 'writing an account in the Accounting tab columns');
update public.accounting_settings set start_date = '2026-01-01' where organisation_id = current_setting('test.org')::uuid;
update public.accounting_settings set start_date = null where organisation_id = current_setting('test.org')::uuid;

select pg_temp.expect_error(format($sql$delete from public.gl_codes where id = %L$sql$, pg_temp.gl('test.org', '1100')), 'cannot be deleted', 'deleting a role account');
select pg_temp.expect_error(format($sql$update public.gl_codes set active = false where id = %L$sql$, pg_temp.gl('test.org', '1100')), 'cannot be made inactive', 'deactivating a role account');
update public.gl_codes set active = false where id = pg_temp.gl('test.org', 'EQ');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'retained_earnings', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org', 'EQ')), 'inactive', 'an inactive code as a role');
update public.gl_codes set external_code = '  A-100 ', external_name = '', report_group = null where id = pg_temp.gl('test.org', 'INC');
select pg_temp.eq('external code is trimmed', (select external_code from public.gl_codes where id = pg_temp.gl('test.org', 'INC')), 'A-100');
select pg_temp.eq('blank external name is null', (select external_name from public.gl_codes where id = pg_temp.gl('test.org', 'INC')), null::text);

-- 3. Control accounts are not used on lines, products or journals.
select pg_temp.act_as('owner');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PV', 'Purchase VAT', 23, 'Expense', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SV', 'Sales VAT', 23, 'Sales', 'S');
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
select pg_temp.expect_error(format($sql$insert into public.products (tenant_id, organisation_id, code, description, purchase_price, sales_price, purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id)
  values (%L, %L, 'P1', 'Widget', 1, 1, %L, %L, %L, %L)$sql$, current_setting('test.tenant'), current_setting('test.org'),
  pg_temp.gl('test.org', '2100'), pg_temp.gl('test.org', 'INC'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'PV'), (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'SV')),
  'Purchase GL code must be an Expense or Cost of Sales account', 'a liability control account as a purchase GL code');
select pg_temp.expect_error(format($sql$insert into public.products (tenant_id, organisation_id, code, description, purchase_price, sales_price, purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id)
  values (%L, %L, 'P1', 'Widget', 1, 1, %L, %L, %L, %L)$sql$, current_setting('test.tenant'), current_setting('test.org'),
  pg_temp.gl('test.org', '6000'), pg_temp.gl('test.org', '1100'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'PV'), (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'SV')),
  'Sales GL code must be an Income account', 'the debtors control account as a sales GL code');
insert into public.products (tenant_id, organisation_id, code, description, purchase_price, sales_price, purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P2', 'Widget', 1, 1, pg_temp.gl('test.org', 'COS'), pg_temp.gl('test.org', 'INC'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'PV'), (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'SV'));
select pg_temp.eq('a Cost of Sales purchase GL code is accepted', (select count(*) from public.products where code = 'P2')::int, 1);
select pg_temp.expect_error(format($sql$update public.gl_codes set account_type = 'Equity' where id = %L$sql$, pg_temp.gl('test.org', 'COS')), 'must stay Expense or Cost of Sales', 'changing the type of a product purchase GL code');

-- A document line cannot use a control account, or an inactive code.
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1) on conflict (organisation_id, code) do nothing;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PIN', 'Purchase invoice', 0, 'Purchases', 'invoice');
create function pg_temp.purchase(p_gl uuid) returns uuid language sql as $$
  select public.save_document(jsonb_build_object(
    'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PIN'),
    'supplierId', (select id from public.suppliers where organisation_id = current_setting('test.org')::uuid and code = 'VOD'),
    'transactionDate', '2026-11-12', 'exchangeRate', 1,
    'currencyId', (select id from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'),
    'lines', jsonb_build_array(jsonb_build_object('description', 'Item', 'quantity', 1, 'price', 10, 'glCodeId', p_gl,
      'vatRateId', (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'PV')))))
$$;
grant execute on function pg_temp.purchase(uuid) to authenticated;
select pg_temp.expect_error(format($sql$select pg_temp.purchase(%L)$sql$, pg_temp.gl('test.org', '2100')), 'control account', 'creditors control on a purchase line');
select pg_temp.expect_error(format($sql$select pg_temp.purchase(%L)$sql$, pg_temp.gl('test.org', '1100')), 'control account', 'debtors control on a purchase line');
select pg_temp.expect_error(format($sql$select pg_temp.purchase(%L)$sql$, pg_temp.gl('test.org', 'EQ')), 'inactive', 'an inactive code on a line');
select pg_temp.purchase(pg_temp.gl('test.org', '6000'));
select pg_temp.eq('an ordinary code is accepted', (select count(*) from public.transaction_lines where organisation_id = current_setting('test.org')::uuid)::int, 1);
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'debtors_control', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org', '6000')), 'needs a Current Asset account', 'an expense account as debtors control');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'rounding', %L)$sql$, current_setting('test.org'), pg_temp.gl('test.org', 'INC')), 'needs a Expense account', 'income as rounding');

-- 4. Bank accounts have a GL code of their own.
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'MAIN', 'Main account', 'IE29AIBK93115212345678', id
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SAVE', 'Savings', 'GB29NWBK60161331926819', id
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
select pg_temp.eq('each bank account has a Current Asset code of its own',
  (select count(distinct b.gl_code_id) from public.bank_accounts b join public.gl_codes g on g.id = b.gl_code_id
   where b.organisation_id = current_setting('test.org')::uuid and g.account_type = 'Current Asset' and g.system_role is null)::int, 2);
select pg_temp.eq('they are named after the account',
  (select description from public.gl_codes g join public.bank_accounts b on b.gl_code_id = g.id where b.organisation_id = current_setting('test.org')::uuid and b.code = 'MAIN'), 'Bank: Main account');
select pg_temp.eq('they start at 1210', (select min(g.code) from public.gl_codes g join public.bank_accounts b on b.gl_code_id = g.id where b.organisation_id = current_setting('test.org')::uuid), '1210');
select pg_temp.expect_error(format($sql$update public.bank_accounts set gl_code_id = (select gl_code_id from public.bank_accounts where organisation_id = %L and code = 'MAIN') where organisation_id = %L and code = 'SAVE'$sql$, current_setting('test.org'), current_setting('test.org')),
  'bank_accounts_gl_code_key', 'two bank accounts on one GL code');
select pg_temp.expect_error(format($sql$update public.bank_accounts set gl_code_id = %L where organisation_id = %L and code = 'SAVE'$sql$, pg_temp.gl('test.org', '1100'), current_setting('test.org')),
  'no system role', 'a bank account on a role account');
select pg_temp.expect_error(format($sql$update public.bank_accounts set gl_code_id = %L where organisation_id = %L and code = 'SAVE'$sql$, pg_temp.gl('test.org', 'INC'), current_setting('test.org')),
  'Current Asset', 'a bank account on an income account');
select pg_temp.expect_error(format($sql$update public.bank_accounts set gl_code_id = null where organisation_id = %L and code = 'SAVE'$sql$, current_setting('test.org')), 'needs a GL code', 'removing the GL code');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'suspense', (select gl_code_id from public.bank_accounts where organisation_id = %L and code = 'MAIN'))$sql$, current_setting('test.org'), current_setting('test.org')),
  'bank account code', 'a bank account code as a role');

-- 5. The migration: an existing choice keeps its account, a taken code gets a suffix, and bad choices stop it.
reset role;
update public.gl_codes set system_role = null where organisation_id = current_setting('test.org2')::uuid;
select pg_temp.eq('the roles were cleared to look like the old data', (select count(*) from public.accounting_settings where organisation_id = current_setting('test.org2')::uuid and receivables_gl_code_id is not null)::int, 0);
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'TRADE', 'Trade debtors', 'Current Asset'),
       (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'WRONG', 'Typed as income', 'Income');
select set_config('fintran.role_mirror', 'on', true);
update public.accounting_settings set receivables_gl_code_id = pg_temp.gl('test.org2', 'TRADE') where organisation_id = current_setting('test.org2')::uuid;
select set_config('fintran.role_mirror', 'off', true);
select pg_temp.eq('a good choice has no problems', private.ledger_role_problems(), '');
select private.ledger_adopt_roles();
select pg_temp.eq('the existing receivables choice kept its account', pg_temp.role_code('test.org2', 'debtors_control'), 'TRADE');
select pg_temp.eq('no second debtors account was created', (select count(*) from public.gl_codes where organisation_id = current_setting('test.org2')::uuid and description = 'Debtors control')::int, 1);
select pg_temp.eq('a taken code gets a suffix', pg_temp.role_code('test.org2', 'creditors_control'), '2100-1');
select pg_temp.eq('every role is held again', (select count(*) from public.gl_codes where organisation_id = current_setting('test.org2')::uuid and system_role is not null)::int, 8);

select set_config('fintran.role_mirror', 'on', true);
update public.accounting_settings set vat_sales_gl_code_id = pg_temp.gl('test.org2', 'WRONG') where organisation_id = current_setting('test.org2')::uuid;
select set_config('fintran.role_mirror', 'off', true);
select pg_temp.eq('a choice of the wrong type is listed', position('WRONG is Income, and the role vat_output needs Current Liability' in private.ledger_role_problems()) > 0, true);
select set_config('fintran.role_mirror', 'on', true);
update public.accounting_settings set vat_sales_gl_code_id = pg_temp.gl('test.org2', '2200') where organisation_id = current_setting('test.org2')::uuid;
update public.accounting_settings set payables_gl_code_id = receivables_gl_code_id where organisation_id = current_setting('test.org2')::uuid;
select set_config('fintran.role_mirror', 'off', true);
select pg_temp.eq('one code for two roles is listed', position('TRADE is chosen for debtors_control, creditors_control' in private.ledger_role_problems()) > 0
  or position('TRADE is chosen for creditors_control, debtors_control' in private.ledger_role_problems()) > 0, true);

rollback;
