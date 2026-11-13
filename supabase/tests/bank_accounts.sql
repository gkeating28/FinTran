-- Payments release A, phase 1: bank accounts. Raises on failure and rolls back.
begin;

create temp table ba_users (who text primary key, id uuid not null);
insert into ba_users (who, id) values
  ('owner', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  ('admin', 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'),
  ('member', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'),
  ('outsider', 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-bank@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', who)
from ba_users;

-- Runs a statement as a person and expects it to fail with a message containing the given text.
create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from ba_users where who = p_who), 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'bank accounts: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'bank accounts: %' then
      raise;
    end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'bank accounts: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end;
$$;

grant all on table ba_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;

select set_config('test.org', (public.create_tenant('Bank Books', 'Bank Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-bank@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-bank@fintran.test', 'member');

-- A second organisation in the same tenant, and a third in another tenant.
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Bank Second', 'EUR'))::text, true);

select pg_temp.act_as('outsider');
select set_config('test.org3', (public.create_tenant('Other Books', 'Other Office'))->>'organisation_id', true);
select set_config('test.tenant3', (select tenant_id::text from public.organisations where id = current_setting('test.org3')::uuid), true);

select pg_temp.act_as('owner');

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'GBP', 'Pound sterling', 0.85)
on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '1200', 'Bank', 'Current Asset'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Stationery', 'Expense');

select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'), true);
select set_config('test.gbp', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'GBP'), true);
select set_config('test.eur2', (select id::text from public.currencies where organisation_id = current_setting('test.org2')::uuid and code = 'EUR'), true);
select set_config('test.gl_asset', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '1200'), true);
select set_config('test.gl_expense', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '6000'), true);

-- IBAN: normalised on save, validated, and unique once normalised.
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, bic, currency_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ops', ' Operating account ',
  'ie29 aibk 9311 5212 3456 78', 'aibkie2d', current_setting('test.eur')::uuid);

do $$
declare
  v record;
begin
  select * into v from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'OPS';
  if v.id is null then
    raise exception 'bank accounts: the code was not uppercased';
  end if;
  if v.iban is distinct from 'IE29AIBK93115212345678' then
    raise exception 'bank accounts: the IBAN was stored as %', v.iban;
  end if;
  if v.bic is distinct from 'AIBKIE2D' then
    raise exception 'bank accounts: the BIC was stored as %', v.bic;
  end if;
  if v.name is distinct from 'Operating account' then
    raise exception 'bank accounts: the name was not trimmed';
  end if;
  if v.is_default or not v.active then
    raise exception 'bank accounts: a new account should be active and not the default';
  end if;
end;
$$;

select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id) values (%L, %L, 'BADIBAN', 'Bad', 'IE29AIBK93115212345679', %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.eur')),
  'valid IBAN', 'an invalid IBAN');
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id) values (%L, %L, 'DUPIBAN', 'Duplicate', 'IE29 AIBK 9311 5212 3456 78', %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.eur')),
  'bank_accounts_organisation_id_iban_key', 'the same IBAN typed with different spacing');

-- BIC.
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, bic, currency_id) values (%L, %L, 'BADBIC', 'Bad BIC', 'GB82WEST12345698765432', 'ABC123', %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.gbp')),
  'BIC', 'an invalid BIC');

-- A BIC is optional, and an IBAN is not.
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'GBP1', 'Sterling', 'GB82 WEST 1234 5698 7654 32', current_setting('test.gbp')::uuid);
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id) values (%L, %L, 'NOIBAN', 'No IBAN', '', %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.eur')),
  'IBAN', 'an empty IBAN');

-- The code is fixed after save.
select pg_temp.expect_error(
  format($sql$update public.bank_accounts set code = 'RENAMED' where organisation_id = %L and code = 'OPS'$sql$, current_setting('test.org')),
  'code', 'a renamed code');

-- Currency and GL code must belong to the organisation. The GL code must be a Current Asset.
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id) values (%L, %L, 'OTHERCUR', 'Other currency', 'DE89370400440532013000', %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.eur2')),
  'bank_accounts_currency_fkey', 'a currency from another organisation');
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id, gl_code_id) values (%L, %L, 'EXPGL', 'Expense GL', 'DE89370400440532013000', %L, %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.eur'), current_setting('test.gl_expense')),
  'Current Asset', 'an expense GL code');
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id, gl_code_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SAVINGS', 'Savings', 'DE89 3704 0044 0532 0130 00', current_setting('test.eur')::uuid, current_setting('test.gl_asset')::uuid);

-- Defaults: one per currency. A new default takes it from the old one.
update public.bank_accounts set is_default = true where organisation_id = current_setting('test.org')::uuid and code = 'OPS';
update public.bank_accounts set is_default = true where organisation_id = current_setting('test.org')::uuid and code = 'GBP1';
do $$
begin
  if (select count(*) from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and is_default) <> 2 then
    raise exception 'bank accounts: one default per currency should allow two defaults in different currencies';
  end if;
end;
$$;
update public.bank_accounts set is_default = true where organisation_id = current_setting('test.org')::uuid and code = 'SAVINGS';
do $$
begin
  if not (select is_default from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'SAVINGS') then
    raise exception 'bank accounts: the new default was not saved';
  end if;
  if (select is_default from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'OPS') then
    raise exception 'bank accounts: the previous EUR default was not cleared';
  end if;
  if not (select is_default from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'GBP1') then
    raise exception 'bank accounts: the GBP default was cleared by a EUR change';
  end if;
  if not exists (
    select 1 from pg_indexes
    where indexname = 'bank_accounts_default_currency_key' and indexdef like '%WHERE is_default%'
  ) then
    raise exception 'bank accounts: the one default per currency index is missing';
  end if;
end;
$$;

-- An inactive account cannot be made the default. Making a default inactive takes the flag off.
update public.bank_accounts set active = false where organisation_id = current_setting('test.org')::uuid and code = 'OPS';
select pg_temp.expect_error(
  format($sql$update public.bank_accounts set is_default = true where organisation_id = %L and code = 'OPS'$sql$, current_setting('test.org')),
  'inactive account cannot be the default', 'an inactive default');
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id, active, is_default) values (%L, %L, 'DORMANT', 'Dormant', 'FR1420041010050500013M02606', %L, false, true)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.eur')),
  'inactive account cannot be the default', 'a new inactive default');
update public.bank_accounts set active = false where organisation_id = current_setting('test.org')::uuid and code = 'SAVINGS';
do $$
begin
  if (select is_default or active from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'SAVINGS') then
    raise exception 'bank accounts: deactivating the default should clear its default flag';
  end if;
end;
$$;

-- Changes are audited.
do $$
begin
  if (select count(*) from public.audit_log
      where table_name = 'bank_accounts' and organisation_id = current_setting('test.org')::uuid and action = 'INSERT') < 3 then
    raise exception 'bank accounts: inserts were not audited';
  end if;
  if not exists (
    select 1 from public.audit_log
    where table_name = 'bank_accounts' and organisation_id = current_setting('test.org')::uuid and action = 'UPDATE'
      and new_values ? 'is_default'
  ) then
    raise exception 'bank accounts: a change of default was not audited';
  end if;
end;
$$;

-- A member can read but not change. An admin can change.
select pg_temp.act_as('member');
do $$
begin
  if (select count(*) from public.bank_accounts where organisation_id = current_setting('test.org')::uuid) <> 3 then
    raise exception 'bank accounts: a member should see the three accounts';
  end if;
end;
$$;
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id) values (%L, %L, 'MEMBERACC', 'Member', 'NL91ABNA0417164300', %L)$sql$,
    current_setting('test.tenant'), current_setting('test.org'), current_setting('test.eur')),
  'row-level security', 'a member inserting an account');
do $$
declare
  v_rows integer;
begin
  update public.bank_accounts set name = 'Changed by member' where organisation_id = current_setting('test.org')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'bank accounts: a member updated % accounts', v_rows;
  end if;
  delete from public.bank_accounts where organisation_id = current_setting('test.org')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'bank accounts: a member deleted % accounts', v_rows;
  end if;
end;
$$;

select pg_temp.act_as('admin');
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ADMINACC', 'Admin account', 'NL91 ABNA 0417 1643 00', current_setting('test.eur')::uuid);
update public.bank_accounts set name = 'Changed by admin' where organisation_id = current_setting('test.org')::uuid and code = 'ADMINACC';
delete from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'ADMINACC';
do $$
begin
  if exists (select 1 from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'ADMINACC') then
    raise exception 'bank accounts: an admin could not delete an account';
  end if;
end;
$$;

-- Another organisation, even in the same tenant, and another tenant: no sight, no move, no mismatched tenant.
select pg_temp.act_as('owner');
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'OPS', 'Same code, other organisation',
  'IE29AIBK93115212345678', current_setting('test.eur2')::uuid);
do $$
begin
  if (select count(*) from public.bank_accounts where organisation_id = current_setting('test.org2')::uuid) <> 1 then
    raise exception 'bank accounts: the same code and IBAN should be allowed in two organisations';
  end if;
end;
$$;
select pg_temp.expect_error(
  format($sql$update public.bank_accounts set organisation_id = %L where organisation_id = %L and code = 'SAVINGS'$sql$,
    current_setting('test.org2'), current_setting('test.org')),
  'another organisation', 'moving an account to another organisation');
select pg_temp.expect_error(
  format($sql$insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id) values (%L, %L, 'WRONGTEN', 'Wrong tenant', 'BE68539007547034', %L)$sql$,
    current_setting('test.tenant3'), current_setting('test.org'), current_setting('test.eur')),
  'does not belong to this tenant', 'a tenant that does not own the organisation');

select pg_temp.act_as('outsider');
do $$
begin
  if exists (select 1 from public.bank_accounts where organisation_id in (current_setting('test.org')::uuid, current_setting('test.org2')::uuid)) then
    raise exception 'bank accounts: a person from another tenant can see accounts';
  end if;
end;
$$;

-- Anonymous visitors have no access at all.
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.bank_accounts', 'select') then
    raise exception 'bank accounts: anon can read bank accounts';
  end if;
end;
$$;

-- The migration copies an organisation IBAN into a main account, and does nothing when there is none.
-- This is the statement from the migration, run on the test organisations.
update public.organisation_defaults set iban = 'GB82WEST12345698765432', bic = 'WESTGB2L'
where organisation_id = current_setting('test.org2')::uuid;
update public.organisation_defaults set iban = null where organisation_id = current_setting('test.org3')::uuid;
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, bic, currency_id, is_default)
select defaults.tenant_id, defaults.organisation_id, 'MAIN', coalesce(defaults.bank_account_name, 'Main account'),
  defaults.iban, defaults.bic,
  defaults.home_currency_id, true
from public.organisation_defaults defaults
where nullif(btrim(defaults.iban), '') is not null
  and defaults.organisation_id in (current_setting('test.org2')::uuid, current_setting('test.org3')::uuid);
do $$
declare
  v record;
begin
  select * into v from public.bank_accounts where organisation_id = current_setting('test.org2')::uuid and code = 'MAIN';
  if v.id is null or not v.is_default or v.iban is distinct from 'GB82WEST12345698765432' or v.bic is distinct from 'WESTGB2L'
     or v.currency_id is distinct from current_setting('test.eur2')::uuid then
    raise exception 'bank accounts: the migration did not make the main account from the organisation IBAN';
  end if;
  if exists (select 1 from public.bank_accounts where organisation_id = current_setting('test.org3')::uuid) then
    raise exception 'bank accounts: the migration made an account for an organisation with no IBAN';
  end if;
  if (select iban from public.organisation_defaults where organisation_id = current_setting('test.org2')::uuid) is distinct from 'GB82WEST12345698765432' then
    raise exception 'bank accounts: the organisation IBAN was changed';
  end if;
end;
$$;

-- An organisation and a tenant can still be deleted when they only hold bank accounts.
select pg_temp.act_as('owner');
set local role authenticated;
select public.delete_organisation(current_setting('test.org2')::uuid);
do $$
begin
  if exists (select 1 from public.bank_accounts where organisation_id = current_setting('test.org2')::uuid) then
    raise exception 'bank accounts: deleting an organisation should delete its bank accounts';
  end if;
end;
$$;

-- A tenant can be deleted when it only holds bank accounts. Payments will be what blocks that (release B).
reset role;
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
select o.tenant_id, o.id, 'TENANT', 'Tenant delete', 'IE29AIBK93115212345678',
  (select id from public.currencies where organisation_id = o.id and code = 'EUR')
from public.organisations o where o.id = current_setting('test.org3')::uuid;
delete from public.tenants where id = current_setting('test.tenant3')::uuid;
do $$
begin
  if exists (select 1 from public.bank_accounts where tenant_id = current_setting('test.tenant3')::uuid) then
    raise exception 'bank accounts: deleting a tenant should delete its bank accounts';
  end if;
end;
$$;

rollback;
