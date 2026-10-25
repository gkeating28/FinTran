-- Phase 3 acceptance tests. Raises on failure and rolls back.
begin;

create temp table phase3_users (who text primary key, id uuid not null);
insert into phase3_users (who, id) values
  ('owner', 'a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-phase3@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', who)
from phase3_users;

select set_config('request.jwt.claims', json_build_object('sub', (select id from phase3_users where who = 'owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('test.org1', (public.create_tenant('Phase Three Books', 'Phase Three Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org1')::uuid), true);
select set_config('test.org2', public.create_organisation(current_setting('test.tenant')::uuid, 'Phase Three Elsewhere')::text, true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'EUR', 'Euro', 1),
  (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, '6000', 'Other expense', 'Expense');
insert into public.departments (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'GEN', 'Other department');
insert into public.cost_centres (tenant_id, organisation_id, code, description)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'HQ', 'Other centre');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org2')::uuid, 'P23', 'Other VAT', 23, 'Expense', 'S');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org1')::uuid and code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org1')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');

select set_config('test.header', public.save_document(jsonb_build_object(
  'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org1')::uuid and code = 'PI'),
  'supplierId', (select id from public.suppliers where organisation_id = current_setting('test.org1')::uuid and code = 'VOD'),
  'transactionDate', '2026-10-18',
  'currencyId', (select id from public.currencies where organisation_id = current_setting('test.org1')::uuid and code = 'EUR'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Plain line', 'quantity', 1, 'price', 10))
))::text, true);

do $$
declare
  v_header uuid := current_setting('test.header')::uuid;
  v_org uuid := current_setting('test.org1')::uuid;
  v_tenant uuid := current_setting('test.tenant')::uuid;
  v_other_gl uuid;
  v_other_dept uuid;
  v_other_centre uuid;
  v_other_vat uuid;
  v_other_currency uuid;
begin
  select id into v_other_gl from public.gl_codes where organisation_id = current_setting('test.org2')::uuid and code = '6000';
  select id into v_other_dept from public.departments where organisation_id = current_setting('test.org2')::uuid and code = 'GEN';
  select id into v_other_centre from public.cost_centres where organisation_id = current_setting('test.org2')::uuid and code = 'HQ';
  select id into v_other_vat from public.vat_rates where organisation_id = current_setting('test.org2')::uuid and code = 'P23';
  select id into v_other_currency from public.currencies where organisation_id = current_setting('test.org2')::uuid and code = 'EUR';

  begin
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      description, gl_code_id, quantity, price, discount_amount, nett_amount, vat_amount
    )
    select v_tenant, v_org, v_header, transaction_type_id, reference, 2,
      'Wrong GL', v_other_gl, 1, 1, 0, 1, 0
    from public.transaction_headers where id = v_header;
    raise exception 'phase 3: a line accepted another organisation GL code';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      description, department_id, quantity, price, discount_amount, nett_amount, vat_amount
    )
    select v_tenant, v_org, v_header, transaction_type_id, reference, 3,
      'Wrong department', v_other_dept, 1, 1, 0, 1, 0
    from public.transaction_headers where id = v_header;
    raise exception 'phase 3: a line accepted another organisation department';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      description, cost_centre_id, quantity, price, discount_amount, nett_amount, vat_amount
    )
    select v_tenant, v_org, v_header, transaction_type_id, reference, 4,
      'Wrong centre', v_other_centre, 1, 1, 0, 1, 0
    from public.transaction_headers where id = v_header;
    raise exception 'phase 3: a line accepted another organisation cost centre';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      description, vat_rate_id, quantity, price, discount_amount, nett_amount, vat_amount
    )
    select v_tenant, v_org, v_header, transaction_type_id, reference, 5,
      'Wrong VAT', v_other_vat, 1, 1, 0, 1, 0
    from public.transaction_headers where id = v_header;
    raise exception 'phase 3: a line accepted another organisation VAT code';
  exception
    when foreign_key_violation then null;
  end;

  begin
    update public.organisation_defaults
    set home_currency_id = v_other_currency
    where organisation_id = v_org;
    raise exception 'phase 3: home currency accepted another organisation currency';
  exception
    when foreign_key_violation then null;
    when others then
      if sqlerrm not like '%Home currency must belong to this organisation%'
         and sqlerrm not like '%home currency cannot be changed%' then
        raise;
      end if;
  end;

  insert into public.transaction_lines (
    tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
    description, quantity, price, discount_amount, nett_amount, vat_amount
  )
  select v_tenant, v_org, v_header, transaction_type_id, reference, 6,
    'Optional codes blank', 1, 1, 0, 1, 0
  from public.transaction_headers where id = v_header;

  begin
    delete from public.currencies
    where organisation_id = v_org and code = 'EUR';
    raise exception 'phase 3: a referenced currency was deleted';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;

reset role;
select 'phase 3 ok' as result;
rollback;
