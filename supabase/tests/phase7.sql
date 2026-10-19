-- Phase 7 acceptance tests. Raises on failure and rolls back.
begin;
create temp table phase7_users (id uuid primary key);
insert into phase7_users values ('a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase7@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb
from phase7_users;
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase7_users), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Seven Books', 'Phase Seven Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1);
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EIR', 'Eir', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.customers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'CUS', 'Customer', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000-01', 'Hyphen', 'Expense'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VAT.23', 'Dot', 'Expense');

select set_config('test.type', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.vod', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid and code = 'VOD'), true);
select set_config('test.eir', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid and code = 'EIR'), true);
select set_config('test.customer', (select id::text from public.customers where organisation_id = current_setting('test.org')::uuid), true);

select public.save_purchase_invoice(jsonb_build_object(
  'transactionTypeId', current_setting('test.type'),
  'supplierId', current_setting('test.vod'),
  'supplierReference', ' inv-9 ',
  'transactionDate', '2026-10-19',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'One', 'quantity', 1, 'price', 1))
));

do $$
begin
  begin
    perform public.save_purchase_invoice(jsonb_build_object(
      'transactionTypeId', current_setting('test.type'),
      'supplierId', current_setting('test.vod'),
      'supplierReference', 'INV-9',
      'transactionDate', '2026-10-19',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Two', 'quantity', 1, 'price', 1))
    ));
    raise exception 'phase 7: a duplicate supplier invoice number was saved';
  exception
    when unique_violation then null;
  end;

  perform public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.eir'),
    'supplierReference', 'INV-9',
    'transactionDate', '2026-10-19',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Other', 'quantity', 1, 'price', 1))
  ));

  perform public.post_document((
    select id from public.transaction_headers
    where organisation_id = current_setting('test.org')::uuid
      and supplier_id = current_setting('test.vod')::uuid
    limit 1
  ), null);
  perform public.void_document((
    select id from public.transaction_headers
    where organisation_id = current_setting('test.org')::uuid
      and supplier_id = current_setting('test.vod')::uuid
    limit 1
  ), 'Re-enter');

  perform public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.vod'),
    'supplierReference', 'INV-9',
    'transactionDate', '2026-10-19',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Again', 'quantity', 1, 'price', 1))
  ));

  begin
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, transaction_date, supplier_id, customer_id,
      supplier_name, currency_id, exchange_rate
    ) values (
      current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.type')::uuid,
      '2026-10-19', current_setting('test.vod')::uuid, current_setting('test.customer')::uuid,
      'Vodafone', current_setting('test.currency')::uuid, 1
    );
    raise exception 'phase 7: a purchase with a customer was saved';
  exception
    when others then
      if sqlerrm not like '%cannot have a customer%' then
        raise exception 'phase 7: customer error was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, transaction_date, supplier_name, currency_id, exchange_rate
    ) values (
      current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting('test.type')::uuid,
      '2026-10-19', 'Vodafone', current_setting('test.currency')::uuid, 1
    );
    raise exception 'phase 7: a purchase without a supplier was saved';
  exception
    when others then
      if sqlerrm not like '%Choose a supplier%' then
        raise exception 'phase 7: missing supplier error was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
    values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '-4000', 'Bad', 'Expense');
    raise exception 'phase 7: a leading hyphen code was saved';
  exception when check_violation then null;
  end;
  begin
    insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
    values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '4000 01', 'Bad', 'Expense');
    raise exception 'phase 7: a spaced code was saved';
  exception when check_violation then null;
  end;
end;
$$;

reset role;
select 'phase 7 ok' as result;
rollback;
