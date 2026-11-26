-- Ledger release A, phase 2: the mode columns and the journal tables (QULAPLUS_LEDGER_SPEC.md). Raises on failure and rolls back.
begin;

create temp table lj_users (who text primary key, id uuid not null);
insert into lj_users (who, id) values
  ('owner', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1'),
  ('admin', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2'),
  ('member', 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3'),
  ('other', 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-journal@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from lj_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from lj_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.eq(p_label text, p_actual anyelement, p_expected anyelement) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'journal tables: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;
create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'journal tables: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'journal tables: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'journal tables: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;
grant all on table lj_users to authenticated;
grant execute on function pg_temp.act_as(text), pg_temp.eq(text, anyelement, anyelement), pg_temp.expect_error(text, text, text) to authenticated;

select pg_temp.act_as('owner');
set local role authenticated;
select set_config('test.org', (public.create_tenant('Journal Books', 'Journal Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-journal@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org')::uuid, 'member-journal@fintran.test', 'member');
select pg_temp.act_as('other');
select set_config('test.org2', (public.create_tenant('Other Books', 'Other Office'))->>'organisation_id', true);
select set_config('test.tenant2', (select tenant_id::text from public.organisations where id = current_setting('test.org2')::uuid), true);
select pg_temp.act_as('owner');

-- Fixtures are made as the table owner, the way the posting functions will.
reset role;
select set_config('test.eur', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR'), true);
select set_config('test.bank', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role = 'suspense'), true);
select set_config('test.debtors', (select id::text from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role = 'debtors_control'), true);
select set_config('fintran.ledger_post', 'on', true);

create function pg_temp.entry(p_date date default '2026-11-12', p_type text default 'manual', p_status text default 'posted') returns uuid language plpgsql as $$
declare v_id uuid; v_n bigint;
begin
  v_n := case when p_status = 'posted' then private.next_entry_number(current_setting('test.tenant')::uuid, current_setting('test.org')::uuid) end;
  insert into public.journal_entries (tenant_id, organisation_id, entry_number, entry_date, status, source_type, description, posted_at)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, v_n, p_date, p_status, p_type, 'Test entry', case when p_status = 'posted' then now() end)
  returning id into v_id;
  return v_id;
end $$;
create function pg_temp.line(p_entry uuid, p_no int, p_gl text, p_debit numeric, p_credit numeric) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.journal_lines (tenant_id, organisation_id, entry_id, line_number, gl_code_id, debit, credit, currency_id, exchange_rate, foreign_amount)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, p_entry, p_no, current_setting(p_gl)::uuid, p_debit, p_credit,
    current_setting('test.eur')::uuid, 1, p_debit - p_credit)
  returning id into v_id;
  return v_id;
end $$;

-- 1. Numbers and a balanced entry.
select pg_temp.eq('the first number is 1', private.next_entry_number(current_setting('test.tenant')::uuid, current_setting('test.org')::uuid), 1::bigint);
select set_config('test.e1', pg_temp.entry()::text, true);
select pg_temp.line(current_setting('test.e1')::uuid, 1, 'test.bank', 100, 0);
select pg_temp.line(current_setting('test.e1')::uuid, 2, 'test.debtors', 0, 100);
set constraints all immediate;
set constraints all deferred;
select pg_temp.eq('the number follows the counter', (select entry_number from public.journal_entries where id = current_setting('test.e1')::uuid), 2::bigint);
select pg_temp.eq('another organisation counts on its own', private.next_entry_number(current_setting('test.tenant2')::uuid, current_setting('test.org2')::uuid), 1::bigint);

-- 2. Balance, line count and the shape of a line. The cases run inside the error check, so they leave nothing behind.
create function pg_temp.bad_entry(p_debit numeric, p_lines int) returns void language plpgsql as $$
declare v_id uuid;
begin
  v_id := pg_temp.entry();
  if p_lines >= 1 then perform pg_temp.line(v_id, 1, 'test.bank', p_debit, 0); end if;
  if p_lines >= 2 then perform pg_temp.line(v_id, 2, 'test.debtors', 0, 100); end if;
  set constraints all immediate;
end $$;
select pg_temp.expect_error($$select pg_temp.bad_entry(100.01, 2)$$, 'does not balance', 'an entry out by one cent');
select pg_temp.expect_error($$select pg_temp.bad_entry(100, 0)$$, 'at least two lines', 'an entry with no lines');
select pg_temp.expect_error($$select pg_temp.bad_entry(100, 1)$$, 'at least two lines', 'an entry with one line');
select pg_temp.bad_entry(100, 2);
select pg_temp.eq('a balanced entry passes', (select count(*) from public.journal_entries where organisation_id = current_setting('test.org')::uuid)::int, 2);
set constraints all deferred;
select pg_temp.expect_error($$select pg_temp.line(current_setting('test.e1')::uuid, 3, 'test.bank', 5, 5)$$, 'journal_lines_amount_check', 'a line with a debit and a credit');
select pg_temp.expect_error($$select pg_temp.line(current_setting('test.e1')::uuid, 3, 'test.bank', 0, 0)$$, 'journal_lines_amount_check', 'a line with neither');
select pg_temp.expect_error($$select pg_temp.line(current_setting('test.e1')::uuid, 1, 'test.bank', 1, 0)$$, 'journal_lines_number_key', 'a repeated line number');

-- 3. Posted entries and their lines are immutable, even for the table owner.
select pg_temp.expect_error(format($sql$update public.journal_entries set description = 'Changed' where id = %L$sql$, current_setting('test.e1')), 'cannot be changed or deleted', 'updating a posted entry');
select pg_temp.expect_error(format($sql$delete from public.journal_entries where id = %L$sql$, current_setting('test.e1')), 'cannot be changed or deleted', 'deleting a posted entry');
select pg_temp.expect_error(format($sql$update public.journal_lines set debit = 1 where entry_id = %L and line_number = 1$sql$, current_setting('test.e1')), 'cannot be changed or deleted', 'updating a line');
select pg_temp.expect_error(format($sql$delete from public.journal_lines where entry_id = %L$sql$, current_setting('test.e1')), 'cannot be changed or deleted', 'deleting a line');
select set_config('fintran.ledger_post', 'off', true);
select pg_temp.expect_error($$select pg_temp.line(current_setting('test.e1')::uuid, 9, 'test.bank', 1, 0)$$, 'cannot be changed', 'adding a line to a posted entry');
select set_config('fintran.ledger_post', 'on', true);

-- 4. Draft manual entries can be edited and deleted. System entries cannot be drafts.
select set_config('test.d1', pg_temp.entry('2026-11-12', 'manual', 'draft')::text, true);
select pg_temp.line(current_setting('test.d1')::uuid, 1, 'test.bank', 7, 0);
update public.journal_entries set description = 'Edited draft' where id = current_setting('test.d1')::uuid;
delete from public.journal_entries where id = current_setting('test.d1')::uuid;
select pg_temp.eq('a draft was deleted with its lines', (select count(*) from public.journal_lines where entry_id = current_setting('test.d1')::uuid)::int, 0);
select pg_temp.expect_error($$select pg_temp.entry('2026-11-12', 'payment', 'draft')$$, 'journal_entries_draft_manual_check', 'a draft that is not manual');
select pg_temp.expect_error($$select pg_temp.entry('2026-11-12', 'document')$$, 'journal_entries_source_check', 'a document entry with no document');

-- 5. Reversals: an entry is reversed once.
create function pg_temp.reversal(p_original uuid, p_date date) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.journal_entries (tenant_id, organisation_id, entry_number, entry_date, status, source_type, reverses_entry_id, description, posted_at)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, private.next_entry_number(current_setting('test.tenant')::uuid, current_setting('test.org')::uuid),
          p_date, 'posted', 'reversal', p_original, 'Reversal', now())
  returning id into v_id;
  insert into public.journal_lines (tenant_id, organisation_id, entry_id, line_number, gl_code_id, debit, credit, currency_id, exchange_rate, foreign_amount)
  select tenant_id, organisation_id, v_id, line_number, gl_code_id, credit, debit, currency_id, exchange_rate, -foreign_amount
  from public.journal_lines where entry_id = p_original;
  return v_id;
end $$;
select pg_temp.reversal(current_setting('test.e1')::uuid, '2026-11-13');
set constraints all immediate;
set constraints all deferred;
select pg_temp.eq('the entry was reversed', (select count(*) from public.journal_entries where reverses_entry_id = current_setting('test.e1')::uuid)::int, 1);
select pg_temp.expect_error($$select pg_temp.reversal(current_setting('test.e1')::uuid, '2026-11-14')$$, 'journal_entries_reverses_key', 'a second reversal');
select pg_temp.eq('the ledger nets to zero', (select sum(debit) - sum(credit) from public.journal_lines where organisation_id = current_setting('test.org')::uuid), 0::numeric);

-- 6. The lock date, and the backfill that is allowed past it.
create function pg_temp.full_entry(p_date date) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := pg_temp.entry(p_date);
  perform pg_temp.line(v_id, 1, 'test.bank', 10, 0);
  perform pg_temp.line(v_id, 2, 'test.debtors', 0, 10);
  return v_id;
end $$;
update public.organisation_defaults set lock_date = '2026-11-30' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error($$select pg_temp.full_entry('2026-11-30')$$, 'locked period', 'an entry on the lock date');
select pg_temp.expect_error($$select pg_temp.full_entry('2026-11-12')$$, 'locked period', 'an entry before the lock date');
select pg_temp.eq('the day after is open', pg_temp.full_entry('2026-12-01') is not null, true);
select set_config('fintran.ledger_backfill', 'on', true);
select pg_temp.eq('the backfill may post before the lock date', pg_temp.full_entry('2026-11-12') is not null, true);
select set_config('fintran.ledger_backfill', 'off', true);
set constraints all immediate;
set constraints all deferred;
update public.organisation_defaults set lock_date = null where organisation_id = current_setting('test.org')::uuid;

-- 7. Who can read, and nobody writes.
select pg_temp.act_as('owner');
set local role authenticated;
select pg_temp.eq('an owner reads the entries', (select count(*) from public.journal_entries)::int, 5);
select pg_temp.eq('an owner reads the lines', (select count(*) from public.journal_lines)::int, 10);
select pg_temp.expect_error(format($sql$insert into public.journal_entries (tenant_id, organisation_id, entry_number, entry_date, status, source_type, description, posted_at)
  values (%L, %L, 99, '2026-12-05', 'posted', 'manual', 'Direct', now())$sql$, current_setting('test.tenant'), current_setting('test.org')), 'permission denied', 'an owner inserting an entry');
select pg_temp.expect_error(format($sql$update public.journal_entries set description = 'x' where id = %L$sql$, current_setting('test.e1')), 'permission denied', 'an owner updating an entry');
select pg_temp.expect_error(format($sql$delete from public.journal_lines where entry_id = %L$sql$, current_setting('test.e1')), 'permission denied', 'an owner deleting a line');
select pg_temp.expect_error('select * from public.ledger_counters', 'permission denied', 'reading the counter');
select pg_temp.act_as('admin');
select pg_temp.eq('an admin reads the entries', (select count(*) from public.journal_entries)::int, 5);
select pg_temp.act_as('member');
select pg_temp.eq('a member reads no entries', (select count(*) from public.journal_entries)::int, 0);
select pg_temp.eq('a member reads no lines', (select count(*) from public.journal_lines)::int, 0);
select pg_temp.act_as('other');
select pg_temp.eq('the owner of another organisation reads none', (select count(*) from public.journal_entries)::int, 0);

-- 8. An account the ledger has used stays as it is.
select pg_temp.act_as('owner');
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'ASSET2', 'Another asset', 'Current Asset');
select pg_temp.expect_error(format($sql$select public.set_system_role(%L, 'debtors_control', (select id from public.gl_codes where organisation_id = %L and code = 'ASSET2'))$sql$, current_setting('test.org'), current_setting('test.org')),
  'has journal lines', 'moving a role whose account has journal lines');
select pg_temp.expect_error(format($sql$update public.gl_codes set active = false where id = %L$sql$, current_setting('test.bank')), 'made inactive', 'deactivating a role account that has journal lines');
select public.set_system_role(current_setting('test.org')::uuid, 'retained_earnings', (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role = 'retained_earnings'));
select pg_temp.eq('an unused role can still move', (select count(*) from public.gl_codes where organisation_id = current_setting('test.org')::uuid and system_role is not null)::int, 8);
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'MAIN', 'Main', 'IE29AIBK93115212345678', current_setting('test.eur')::uuid);
reset role;
select set_config('fintran.ledger_post', 'on', true);
select set_config('test.mainbank', (select gl_code_id::text from public.bank_accounts where organisation_id = current_setting('test.org')::uuid and code = 'MAIN'), true);
select set_config('test.e5', pg_temp.entry('2026-12-02')::text, true);
select pg_temp.line(current_setting('test.e5')::uuid, 1, 'test.mainbank', 5, 0);
select pg_temp.line(current_setting('test.e5')::uuid, 2, 'test.debtors', 0, 5);
set constraints all immediate;
set constraints all deferred;
select pg_temp.act_as('owner');
set local role authenticated;
select pg_temp.expect_error(format($sql$update public.bank_accounts set gl_code_id = (select id from public.gl_codes where organisation_id = %L and code = 'ASSET2') where organisation_id = %L and code = 'MAIN'$sql$, current_setting('test.org'), current_setting('test.org')),
  'has journal lines', 'changing the GL code of a bank account with journal lines');

update public.gl_codes set active = false where id = current_setting('test.mainbank')::uuid;
select pg_temp.eq('an ordinary account with journal lines can be made inactive', (select active from public.gl_codes where id = current_setting('test.mainbank')::uuid), false);

-- 9. The mode and the period columns.
select pg_temp.eq('a new organisation starts as the book of record', (select ledger_mode from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), 'book');
select pg_temp.eq('and does not lock exported periods', (select lock_exported from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), false);
select pg_temp.expect_error(format($sql$update public.organisation_defaults set ledger_mode = 'feed' where organisation_id = %L$sql$, current_setting('test.org')), 'by the system', 'changing the mode by hand');
select pg_temp.expect_error(format($sql$update public.organisation_defaults set exported_through = '2026-12-31' where organisation_id = %L$sql$, current_setting('test.org')), 'by the system', 'setting exported-through by hand');
update public.organisation_defaults set lock_exported = true, ledger_start_date = '2026-12-01' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.eq('an owner sets the lock switch and the go-live date', (select lock_exported::text || ledger_start_date::text from public.organisation_defaults where organisation_id = current_setting('test.org')::uuid), 'true2026-12-01');
select pg_temp.expect_error(format($sql$update public.organisation_defaults set ledger_mode = 'sideways' where organisation_id = %L$sql$, current_setting('test.org')), 'by the system', 'an unknown mode');
reset role;
select set_config('fintran.ledger_admin', 'on', true);
update public.organisation_defaults set exported_through = '2026-12-31' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error(format($sql$update public.organisation_defaults set exported_through = '2026-12-30' where organisation_id = %L$sql$, current_setting('test.org')), 'only moves forward', 'moving exported-through back');
update public.organisation_defaults set ledger_mode = 'book' where organisation_id = current_setting('test.org')::uuid;
select pg_temp.expect_error(format($sql$update public.organisation_defaults set ledger_mode = 'sideways' where organisation_id = %L$sql$, current_setting('test.org')), 'organisation_defaults_ledger_mode_check', 'an unknown mode as the system');

rollback;
