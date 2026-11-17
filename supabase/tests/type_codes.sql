-- The three-character transaction type codes: the two migrations that rename the types made under the old codes.
-- Raises on failure and rolls back. It runs the migration files themselves against types made to look the way they did.
begin;

create temp table tc_users (who text primary key, id uuid not null);
insert into tc_users (who, id) values ('owner', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-codes@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from tc_users;

create function pg_temp.act_as(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from tc_users where who = p_who), 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'type codes: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'type codes: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'type codes: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

create function pg_temp.eq(p_label text, p_actual text, p_expected text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'type codes: % was %, expected %', p_label, p_actual, p_expected;
  end if;
end $$;

-- The codes of one organisation's types, in order, optionally only the system ones.
create function pg_temp.codes(p_org text, p_system boolean) returns text language sql as $$
  select string_agg(code, ',' order by code) from public.transaction_types
  where organisation_id = current_setting(p_org)::uuid and is_system = p_system
$$;
create function pg_temp.prefix(p_org text, p_code text) returns text language sql as $$
  select coalesce(reference_prefix, '(none)') from public.transaction_types
  where organisation_id = current_setting(p_org)::uuid and code = p_code
$$;

select pg_temp.act_as('owner');
set local role authenticated;
select set_config('test.org', (public.create_tenant('Type Codes Books', 'Type Codes Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select set_config('test.org2', (public.create_organisation(current_setting('test.tenant')::uuid, 'Type Codes Second', 'EUR'))::text, true);
reset role;

-- The first organisation has the standard set under its old codes. The credit note has a prefix somebody chose, and
-- the purchase types have no prefix at all, as on the live project.
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PR', 'Purchase requisition', 0, 'Purchases', 'requisition', 'on_insert', 'PR-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PO', 'Purchase order', 0, 'Purchases', 'order', 'on_insert', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', 'on_insert', null, 0),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SO', 'Sales order', 0, 'Sales', 'order', 'on_post', 'SO-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'on_post', 'INV-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SC', 'Sales credit note', 0, 'Sales', 'credit_note', 'on_post', 'CN/', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'REC', 'Customer receipt', 0, 'Sales', 'receipt', 'on_post', 'REC-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PAY', 'Supplier payment', 0, 'Purchases', 'payment', 'on_post', 'PAY-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CREF', 'Customer refund', 0, 'Sales', 'payment', 'on_post', 'CREF-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SREF', 'Supplier refund', 0, 'Purchases', 'receipt', 'on_post', 'SREF-', 5);

-- The second organisation has types that must be left alone: PR is a sales order here, which is not what the standard
-- PR is, and SIN is already taken, so its SI cannot be renamed to it.
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'PR', 'Our own sales order', 0, 'Sales', 'order', 'on_post', 'PR-', 4),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'invoice', 'on_post', 'INV-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'SIN', 'Another sales invoice', 0, 'Sales', 'invoice', 'on_post', 'SIN-', 5);

-- The hidden types of the typed paid amount migration, made as that migration made them.
select set_config('fintran.migration', 'on', true);
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding, is_system)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'MIGREC', 'Migrated customer receipt', 3, 'Sales', 'receipt', 'on_insert', 'MIG-', 4, true),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'MIGPAY', 'Migrated supplier payment', 2, 'Purchases', 'payment', 'on_insert', 'MIG-', 4, true),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'MIGREC', 'Migrated customer receipt', 1, 'Sales', 'receipt', 'on_insert', 'MIG-', 4, true),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'SMR', 'Already using the new code', 0, 'Sales', 'receipt', 'on_insert', 'SMR-', 4, true);
select set_config('fintran.migration', 'off', true);

\echo Running the standard codes migration. Its notices follow.
\i supabase/migrations/20261113184039_three_character_type_codes.sql
\echo end of migration

-- Every standard type has its three-character code.
select pg_temp.eq('first organisation, standard types', pg_temp.codes('test.org', false), 'PIN,POR,PPY,PRF,PRQ,SCN,SIN,SOR,SRC,SRF');
-- A prefix that was still the old default follows the code. A prefix somebody chose is kept, and no prefix stays none.
select pg_temp.eq('sales invoice prefix', pg_temp.prefix('test.org', 'SIN'), 'SIN-');
select pg_temp.eq('credit note prefix chosen by someone', pg_temp.prefix('test.org', 'SCN'), 'CN/');
select pg_temp.eq('purchase invoice has no prefix', pg_temp.prefix('test.org', 'PIN'), '(none)');
select pg_temp.eq('purchase order has no prefix', pg_temp.prefix('test.org', 'POR'), '(none)');
select pg_temp.eq('requisition prefix', pg_temp.prefix('test.org', 'PRQ'), 'PRQ-');
select pg_temp.eq('sales order prefix', pg_temp.prefix('test.org', 'SOR'), 'SOR-');
select pg_temp.eq('customer receipt prefix', pg_temp.prefix('test.org', 'SRC'), 'SRC-');
select pg_temp.eq('supplier payment prefix', pg_temp.prefix('test.org', 'PPY'), 'PPY-');
select pg_temp.eq('customer refund prefix', pg_temp.prefix('test.org', 'SRF'), 'SRF-');
select pg_temp.eq('supplier refund prefix', pg_temp.prefix('test.org', 'PRF'), 'PRF-');
-- A type that is not the standard one, or whose new code is taken, is left alone.
select pg_temp.eq('second organisation is left alone', pg_temp.codes('test.org2', false), 'PR,SI,SIN');
-- The hidden types are not touched by this migration.
select pg_temp.eq('hidden types, before their migration', pg_temp.codes('test.org', true), 'MIGPAY,MIGREC');

-- Running it again changes nothing.
\i supabase/migrations/20261113184039_three_character_type_codes.sql
select pg_temp.eq('first organisation, run again', pg_temp.codes('test.org', false), 'PIN,POR,PPY,PRF,PRQ,SCN,SIN,SOR,SRC,SRF');
select pg_temp.eq('second organisation, run again', pg_temp.codes('test.org2', false), 'PR,SI,SIN');

\echo Running the migrated types migration. Its notices follow.
\i supabase/migrations/20261117093738_three_character_migrated_type_codes.sql
\echo end of migration

select pg_temp.eq('hidden types, first organisation', pg_temp.codes('test.org', true), 'PMP,SMR');
select pg_temp.eq('migrated types keep their prefix', pg_temp.prefix('test.org', 'SMR'), 'MIG-');
select pg_temp.eq('migrated types keep their numbering rule', (select numbering::text || ' ' || reference_padding::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SMR'), 'on_post 4');
select pg_temp.eq('a migrated type whose new code is taken is left', pg_temp.codes('test.org2', true), 'MIGREC,SMR');
select pg_temp.eq('the standard types were not touched', pg_temp.codes('test.org', false), 'PIN,POR,PPY,PRF,PRQ,SCN,SIN,SOR,SRC,SRF');

\i supabase/migrations/20261117093738_three_character_migrated_type_codes.sql
select pg_temp.eq('hidden types, run again', pg_temp.codes('test.org', true), 'PMP,SMR');

-- The rule that a saved code cannot change is back in force, and so is the rule that people cannot edit a system type.
select pg_temp.expect_error(
  format($sql$update public.transaction_types set code = 'ZZZ' where organisation_id = %L and code = 'SIN'$sql$, current_setting('test.org')),
  'A code cannot be changed', 'renaming a type after the migrations');
select pg_temp.expect_error(
  format($sql$update public.transaction_types set description = 'Mine' where organisation_id = %L and code = 'SMR'$sql$, current_setting('test.org')),
  'kept by the system', 'editing a migrated type after the migrations');

rollback;
