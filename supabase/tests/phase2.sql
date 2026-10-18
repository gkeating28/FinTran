-- Phase 2 acceptance tests. Raises on failure and rolls back.
begin;

create temp table phase2_users (who text primary key, id uuid not null);
insert into phase2_users (who, id) values
  ('owner', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('admin', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('member', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('outsider', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-phase2@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', who)
from phase2_users;

select set_config('test.owner_id', (select id::text from phase2_users where who = 'owner'), true);

select set_config('request.jwt.claims', json_build_object('sub', (select id from phase2_users where who = 'owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('test.org1', (public.create_tenant('Phase Two Books', 'Phase Two Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org1')::uuid), true);
select public.grant_organisation_access(current_setting('test.org1')::uuid, 'admin-phase2@fintran.test', 'admin');
select public.grant_organisation_access(current_setting('test.org1')::uuid, 'member-phase2@fintran.test', 'member');

insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, '6000', 'Stationery', 'Expense');
insert into public.departments (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'GEN', 'General');
insert into public.cost_centres (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'HQ', 'Head office');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'P23', 'Purchase VAT', 23, 'Expense'),
  (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'S23', 'Sales VAT', 23, 'Sales');
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, '5000', 'Sales', 'Income');
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'EUR', 'Euro', 1);
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'VOD', 'Vodafone', id
from public.currencies
where organisation_id = current_setting('test.org1')::uuid and code = 'EUR';

select set_config('test.type', (select id::text from public.transaction_types where organisation_id = current_setting('test.org1')::uuid and code = 'PI'), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org1')::uuid and code = 'VOD'), true);
select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org1')::uuid and code = 'EUR'), true);
select set_config('test.gl', (select id::text from public.gl_codes where organisation_id = current_setting('test.org1')::uuid and code = '6000'), true);

insert into public.products (
  tenant_id, organisation_id, code, description, purchase_price, sales_price,
  purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id
)
select current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'MBP', 'Laptop', 10, 20,
  (select id from public.gl_codes where organisation_id = current_setting('test.org1')::uuid and code = '6000'),
  (select id from public.gl_codes where organisation_id = current_setting('test.org1')::uuid and code = '5000'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org1')::uuid and code = 'P23'),
  (select id from public.vat_rates where organisation_id = current_setting('test.org1')::uuid and code = 'S23');

insert into public.transaction_forms (tenant_id, organisation_id, transaction_type_id, layout)
values (
  current_setting('test.tenant')::uuid,
  current_setting('test.org1')::uuid,
  current_setting('test.type')::uuid,
  '{"version":1,"title":"Purchase invoice"}'::jsonb
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select id from phase2_users where who = 'member'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  setup_table text;
  before_count integer;
  after_count integer;
begin
  begin
    insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
    values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, '6100', 'Member code', 'Expense');
    raise exception 'phase 2: a member inserted a GL code';
  exception
    when insufficient_privilege then
      null;
  end;

  foreach setup_table in array array['gl_codes','departments','cost_centres','vat_rates','currencies','products','transaction_types','transaction_forms']
  loop
    execute format(
      'select count(*) from public.%I where organisation_id = %L::uuid',
      setup_table,
      current_setting('test.org1')
    ) into before_count;
    execute format(
      'delete from public.%I where organisation_id = %L::uuid',
      setup_table,
      current_setting('test.org1')
    );
    execute format(
      'select count(*) from public.%I where organisation_id = %L::uuid',
      setup_table,
      current_setting('test.org1')
    ) into after_count;
    if after_count is distinct from before_count then
      raise exception 'phase 2: a member deleted from % (% to %)', setup_table, before_count, after_count;
    end if;
  end loop;

  begin
    update public.organisation_defaults
    set banking_details = 'Member edit'
    where organisation_id = current_setting('test.org1')::uuid;
    if found then
      raise exception 'phase 2: a member updated organisation defaults';
    end if;
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

select set_config(
  'test.header',
  public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-18',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Line', 'quantity', 1, 'price', 10))
  ))::text,
  true
);

do $$
declare
  v_reference integer;
begin
  select reference into v_reference
  from public.transaction_headers
  where id = current_setting('test.header')::uuid;
  if v_reference is distinct from 1 then
    raise exception 'phase 2: member document reference is %, expected 1', v_reference;
  end if;
end;
$$;

reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select id from phase2_users where who = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;

update public.organisation_defaults
set banking_details = 'Admin edit'
where organisation_id = current_setting('test.org1')::uuid;

do $$
declare
  unknown_email text;
  known_email text;
begin
  begin
    perform public.grant_organisation_access(current_setting('test.org1')::uuid, 'nobody-phase2@fintran.test', 'member');
    raise exception 'phase 2: unknown email was granted';
  exception
    when others then
      unknown_email := sqlerrm;
  end;
  begin
    perform public.grant_organisation_access(current_setting('test.org1')::uuid, 'member-phase2@fintran.test', 'admin');
    raise exception 'phase 2: an admin granted the admin role';
  exception
    when others then
      known_email := sqlerrm;
  end;
  if unknown_email is distinct from known_email then
    raise exception 'phase 2: grant errors differ: [%] [%]', unknown_email, known_email;
  end if;
  if unknown_email not like '%Could not grant access to that email address.%' then
    raise exception 'phase 2: unexpected grant error %', unknown_email;
  end if;

  begin
    perform public.revoke_organisation_access(current_setting('test.org1')::uuid, current_setting('test.owner_id')::uuid);
    raise exception 'phase 2: an admin revoked an owner';
  exception
    when others then
      if sqlerrm not like '%You can only remove a member%' then
        raise exception 'phase 2: admin revoke error was %', sqlerrm;
      end if;
  end;

  begin
    perform public.create_organisation(current_setting('test.tenant')::uuid, 'Admin Office');
    raise exception 'phase 2: an admin created an organisation';
  exception
    when others then
      if sqlerrm not like '%owner role in this tenant%' then
        raise exception 'phase 2: create organisation error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;

do $$
begin
  update public.organisation_access
  set role = 'member'
  where organisation_id = current_setting('test.org1')::uuid
    and user_id = (select id from phase2_users where who = 'owner');
  raise exception 'phase 2: the last owner was demoted by a direct update';
exception
  when others then
    if sqlerrm not like '%at least one owner%' then
      raise exception 'phase 2: direct demote error was %', sqlerrm;
    end if;
end;
$$;

select set_config('request.jwt.claims', json_build_object('sub', (select id from phase2_users where who = 'owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.revoke_organisation_access(current_setting('test.org1')::uuid, current_setting('test.owner_id')::uuid);
  raise exception 'phase 2: the last owner was revoked';
exception
  when others then
    if sqlerrm not like '%at least one owner%' then
      raise exception 'phase 2: revoke last owner error was %', sqlerrm;
    end if;
end;
$$;

select set_config('test.org2', public.create_organisation(current_setting('test.tenant')::uuid, 'Phase Two Elsewhere')::text, true);
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');

do $$
begin
  perform public.save_purchase_invoice(jsonb_build_object(
    'id', current_setting('test.header'),
    'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org2')::uuid and code = 'PI'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-18',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', '[]'::jsonb
  ));
  raise exception 'phase 2: a cross-organisation invoice update was saved';
exception
  when others then
    if sqlerrm not like '%another organisation%' and sqlerrm not like '%could not be updated%' and sqlerrm not like '%Choose a supplier%' then
      raise exception 'phase 2: cross-organisation error was %', sqlerrm;
    end if;
end;
$$;

reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select id from phase2_users where who = 'outsider'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_tenant('Phase Two Outsider', 'Phase Two Outpost');

do $$
declare
  seen integer;
begin
  select count(*) into seen
  from public.profiles
  where id = current_setting('test.owner_id')::uuid;
  if seen <> 0 then
    raise exception 'phase 2: a user can select a profile that shares no organisation';
  end if;
end;
$$;

reset role;
select 'phase 2 ok' as result;
rollback;
