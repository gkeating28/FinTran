-- Codes on setup rows cannot be renamed. Other columns can. Rolls back.
begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c0dec0de-c0de-4c0d-8c0d-c0dec0dec0de', 'owner-codes@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);

select set_config('request.jwt.claims', json_build_object('sub', 'c0dec0de-c0de-4c0d-8c0d-c0dec0dec0de', 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('test.org', (public.create_tenant('Code Books', 'Code Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);

insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Stationery', 'Expense'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '5000', 'Sales', 'Income');
insert into public.departments (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'GEN', 'General');
insert into public.cost_centres (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'HQ', 'Head office');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Purchase VAT', 23, 'Expense', 'S'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S23', 'Sales VAT', 23, 'Sales', 'S');
insert into public.customers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CUS', 'Customer', id
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.products (
  tenant_id, organisation_id, code, description, purchase_price, sales_price,
  purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id
)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'MBP', 'Laptop', 10, 20,
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '6000'),
  (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '5000'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'P23'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'S23');
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');

do $$
declare
  spec record;
  v_before text;
  v_after text;
  v_code text;
  v_count bigint;
  v_code_logged boolean;
  v_triggers int;
begin
  select count(*) into v_triggers
  from pg_trigger
  where tgname = 'aa_code_unchanged'
    and not tgisinternal
    and tgrelid in (
      'public.gl_codes'::regclass,
      'public.departments'::regclass,
      'public.cost_centres'::regclass,
      'public.vat_rates'::regclass,
      'public.customers'::regclass,
      'public.suppliers'::regclass,
      'public.products'::regclass,
      'public.currencies'::regclass,
      'public.transaction_types'::regclass
    );
  if v_triggers <> 9 then
    raise exception 'immutable: expected 9 code guards, found %', v_triggers;
  end if;

  for spec in
    select * from (values
      ('gl_codes', '6000', 'description'),
      ('departments', 'GEN', 'description'),
      ('cost_centres', 'HQ', 'description'),
      ('vat_rates', 'P23', 'description'),
      ('customers', 'CUS', 'name'),
      ('suppliers', 'VOD', 'name'),
      ('products', 'MBP', 'description'),
      ('currencies', 'EUR', 'name'),
      ('transaction_types', 'PI', 'description')
    ) as t(relname, code, column_name)
  loop
    execute format(
      'select %I from public.%I where organisation_id = %L::uuid and code = %L',
      spec.column_name, spec.relname, current_setting('test.org'), spec.code
    ) into v_before;

    if v_before is null then
      raise exception 'immutable: missing % %', spec.relname, spec.code;
    end if;

    begin
      execute format(
        'update public.%I set code = %L, %I = %L where organisation_id = %L::uuid and code = %L',
        spec.relname,
        spec.code || '-X',
        spec.column_name,
        'SHOULD-NOT-STICK',
        current_setting('test.org'),
        spec.code
      );
      raise exception 'immutable: % code was changed', spec.relname;
    exception
      when others then
        if sqlerrm not like '%A code cannot be changed%' or sqlerrm like 'immutable:%' then
          raise exception 'immutable: % error was %', spec.relname, sqlerrm;
        end if;
    end;

    execute format(
      'select code, %I from public.%I where organisation_id = %L::uuid and code = %L',
      spec.column_name, spec.relname, current_setting('test.org'), spec.code
    ) into v_code, v_after;

    if v_code is distinct from spec.code or v_after is distinct from v_before then
      raise exception 'immutable: rejected % change stuck (% / %)', spec.relname, v_code, v_after;
    end if;

    execute format(
      'update public.%I set %I = %L where organisation_id = %L::uuid and code = %L',
      spec.relname, spec.column_name, v_before || ' revised', current_setting('test.org'), spec.code
    );

    execute format(
      'update public.%I set code = %L, %I = %L where organisation_id = %L::uuid and code = %L',
      spec.relname,
      ' ' || lower(spec.code) || ' ',
      spec.column_name,
      v_before || ' revised again',
      current_setting('test.org'),
      spec.code
    );

    execute format(
      'select count(*) from public.%I where organisation_id = %L::uuid and code = %L and %I = %L',
      spec.relname,
      current_setting('test.org'),
      spec.code,
      spec.column_name,
      v_before || ' revised again'
    ) into v_count;

    if v_count <> 1 then
      raise exception 'immutable: % kept neither its code nor the other edit', spec.relname;
    end if;
  end loop;

  select new_values ? 'code'
    into v_code_logged
  from public.audit_log
  where organisation_id = current_setting('test.org')::uuid
    and table_name = 'gl_codes'
    and action = 'UPDATE'
    and new_values ? 'description'
  order by id desc
  limit 1;

  if v_code_logged is distinct from false then
    raise exception 'immutable: a GL code edit was audited as a code change';
  end if;

  insert into public.departments (tenant_id, organisation_id, code, description)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'new', 'Still allowed');
  if not exists (
    select 1 from public.departments
    where organisation_id = current_setting('test.org')::uuid and code = 'NEW'
  ) then
    raise exception 'immutable: a new code could not be added';
  end if;
end;
$$;

reset role;
select 'immutable codes ok' as result;
rollback;
