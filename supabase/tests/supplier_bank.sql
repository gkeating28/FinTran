-- Supplier bank details and their history (QULAPLUS_PAYMENT_APPROVALS_SPEC.md, phase 1). Raises on failure and rolls back.
begin;

create temp table sb_users (who text primary key, id uuid not null);
insert into sb_users (who, id) values
  ('owner', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'),
  ('admin', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'),
  ('member', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1'),
  ('outsider', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-bank@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from sb_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from sb_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'supplier bank: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'supplier bank: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'supplier bank: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'supplier bank: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

grant all on table sb_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.expect_error(text, text, text), pg_temp.eq(text, anyelement, anyelement) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;
select set_config('test.org', (public.create_tenant('Bank Books', 'Bank Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-bank@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-bank@fintran.test', 'member');
reset role;

insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', c.id, 'Quay 4', 'Dublin'
from public.currencies c where c.organisation_id = current_setting('test.org')::uuid and c.code = 'EUR';
select set_config('test.sup', (select id::text from public.suppliers where code = 'VOD' and organisation_id = current_setting('test.org')::uuid), true);

-- 1. An IBAN is checked and tidied.
select pg_temp.act_as('member');
set local role authenticated;
update public.suppliers set iban = 'ie29 aibk 9311 5212 3456 78', bic = 'aibkie2d', bank_account_name = '  Vodafone Ireland  ' where id = current_setting('test.sup')::uuid;
select pg_temp.eq('the IBAN is stored in capitals without spaces', (select iban from public.suppliers where id = current_setting('test.sup')::uuid), 'IE29AIBK93115212345678');
select pg_temp.eq('the BIC is tidied', (select bic from public.suppliers where id = current_setting('test.sup')::uuid), 'AIBKIE2D');
select pg_temp.eq('the account name is trimmed', (select bank_account_name from public.suppliers where id = current_setting('test.sup')::uuid), 'Vodafone Ireland');
select pg_temp.expect_error(format($sql$update public.suppliers set iban = 'IE00AIBK93115212345678' where id = %L$sql$, current_setting('test.sup')), 'valid IBAN', 'a wrong IBAN');
select pg_temp.expect_error(format($sql$update public.suppliers set bic = 'NOPE' where id = %L$sql$, current_setting('test.sup')), 'BIC', 'a wrong BIC');

-- 2. Setting details for the first time is not a change.
reset role;
select pg_temp.eq('no change row for the first time', (select count(*)::int from public.supplier_bank_changes), 0);

-- 3. A change writes a row with the old and new values and who made it.
select pg_temp.act_as('member');
set local role authenticated;
update public.suppliers set iban = 'GB29NWBK60161331926819' where id = current_setting('test.sup')::uuid;
select pg_temp.act_as('owner');
select pg_temp.eq('one change is recorded', (select count(*)::int from public.supplier_bank_changes), 1);
select pg_temp.eq('with the old IBAN', (select old_iban from public.supplier_bank_changes), 'IE29AIBK93115212345678');
select pg_temp.eq('and the new one', (select new_iban from public.supplier_bank_changes), 'GB29NWBK60161331926819');
select pg_temp.eq('and who changed it', (select changed_by from public.supplier_bank_changes), (select id from sb_users where who = 'member'));

-- Saving the same details again, or changing something else, writes nothing.
select pg_temp.act_as('member');
update public.suppliers set iban = 'GB29 NWBK 6016 1331 9268 19', name = 'Vodafone Ireland Ltd' where id = current_setting('test.sup')::uuid;
select pg_temp.act_as('owner');
select pg_temp.eq('an unchanged IBAN is not a change', (select count(*)::int from public.supplier_bank_changes), 1);

-- A BIC or account name change counts too.
select pg_temp.act_as('member');
update public.suppliers set bank_account_name = 'Vodafone Group' where id = current_setting('test.sup')::uuid;
select pg_temp.act_as('admin');
select pg_temp.eq('an account name change is recorded', (select count(*)::int from public.supplier_bank_changes), 2);

-- 4. Who can read the history.
select pg_temp.act_as('member');
select pg_temp.eq('a member sees no history', (select count(*)::int from public.supplier_bank_changes), 0);
select pg_temp.act_as('outsider');
select pg_temp.eq('an outsider sees no history', (select count(*)::int from public.supplier_bank_changes), 0);
select pg_temp.act_as('member');
select pg_temp.expect_error(
  format($sql$insert into public.supplier_bank_changes (tenant_id, organisation_id, supplier_id) values (%L, %L, %L)$sql$, current_setting('test.tenant'), current_setting('test.org'), current_setting('test.sup')),
  'permission denied', 'a direct write to the history');
reset role;
select pg_temp.eq('the changes are in the audit log', (select count(*)::int from public.audit_log where table_name = 'supplier_bank_changes' and action = 'INSERT'), 2);

-- 5. The window.
select pg_temp.eq('with no window nothing is recent', private.bank_changed_recently(current_setting('test.sup')::uuid), false);
update public.organisation_defaults set bank_change_days = 14 where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('a change made today is inside 14 days', private.bank_changed_recently(current_setting('test.sup')::uuid), true);
update public.supplier_bank_changes set changed_at = now() - interval '15 days';
select pg_temp.eq('a change made 15 days ago is outside 14', private.bank_changed_recently(current_setting('test.sup')::uuid), false);
update public.supplier_bank_changes set changed_at = now() - interval '13 days' where id = (select id from public.supplier_bank_changes order by id limit 1);
select pg_temp.eq('one change inside the window is enough', private.bank_changed_recently(current_setting('test.sup')::uuid), true);
select pg_temp.expect_error(format($sql$update public.organisation_defaults set bank_change_days = 0 where organisation_id = %L$sql$, current_setting('test.org')), 'bank_change_days_check', 'a window of 0 days');
select pg_temp.expect_error(format($sql$update public.organisation_defaults set bank_change_days = 91 where organisation_id = %L$sql$, current_setting('test.org')), 'bank_change_days_check', 'a window of 91 days');

-- Only owners and admins set the window.
select pg_temp.act_as('member');
set local role authenticated;
do $$
declare
  v_rows integer;
begin
  update public.organisation_defaults set bank_change_days = 30 where organisation_id = current_setting('test.org')::uuid;
  get diagnostics v_rows = row_count;
end $$;
reset role;
select pg_temp.eq('a member did not change the window', (select bank_change_days from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), 14);

rollback;
