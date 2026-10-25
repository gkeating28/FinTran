-- Phase 5 acceptance tests. Raises on failure and rolls back.
begin;

create temp table phase5_users (who text primary key, id uuid not null);
insert into phase5_users (who, id) values ('owner', 'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase5@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', 'Owner')
from phase5_users;

select set_config('test.owner', (select id::text from phase5_users where who = 'owner'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('test.org', (public.create_tenant('Phase Five Books', 'Phase Five Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Purchase VAT', 23, 'Expense', 'S');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, vat_number)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Old quay', 'IE1234567A'
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');

update public.organisation_defaults
set address_line1 = 'Dock Road', vat_number = 'IE9999999T', banking_details = 'IBAN OLD'
where organisation_id = current_setting('test.org')::uuid;

select set_config('test.type', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.vat', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid), true);

select set_config('test.header', public.save_document(jsonb_build_object(
  'transactionTypeId', current_setting('test.type'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-10-19',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object(
    'description', 'Paper', 'quantity', 1, 'price', 100, 'vatRateId', current_setting('test.vat')
  ))
))::text, true);

do $$
declare
  v_vat numeric;
begin
  select vat_amount into v_vat from public.transaction_lines where header_id = current_setting('test.header')::uuid;
  if v_vat is distinct from 23 then
    raise exception 'phase 5: draft VAT is %, expected 23', v_vat;
  end if;
end;
$$;

update public.vat_rates set rate = 10 where id = current_setting('test.vat')::uuid;

select public.save_document(jsonb_build_object(
  'id', current_setting('test.header'),
  'transactionTypeId', current_setting('test.type'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-10-19',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object(
    'description', 'Paper', 'quantity', 1, 'price', 100, 'vatRateId', current_setting('test.vat')
  ))
));

do $$
declare
  v_vat numeric;
begin
  select vat_amount into v_vat from public.transaction_lines where header_id = current_setting('test.header')::uuid;
  if v_vat is distinct from 10 then
    raise exception 'phase 5: resaved draft VAT is %, expected 10', v_vat;
  end if;
end;
$$;

select public.post_document(current_setting('test.header')::uuid, null);

do $$
declare
  v_posted numeric;
begin
  select vat_amount into v_posted from public.transaction_lines where header_id = current_setting('test.header')::uuid;
  begin
    update public.vat_rates set rate = 5 where id = current_setting('test.vat')::uuid;
    raise exception 'phase 5: a posted VAT rate was changed';
  exception
    when others then
      if sqlerrm not like '%posted documents%' then
        raise exception 'phase 5: VAT change error was %', sqlerrm;
      end if;
  end;
  if (select vat_amount from public.transaction_lines where header_id = current_setting('test.header')::uuid) is distinct from v_posted then
    raise exception 'phase 5: a posted line VAT amount changed';
  end if;
end;
$$;

update public.organisation_defaults
set address_line1 = 'New street', vat_number = 'IE0000000T', banking_details = 'IBAN NEW'
where organisation_id = current_setting('test.org')::uuid;

update public.suppliers
set address_line1 = 'New quay'
where id = current_setting('test.supplier')::uuid;

do $$
declare
  v_issuer jsonb;
  v_party jsonb;
begin
  select issuer_snapshot, party_snapshot into v_issuer, v_party
  from public.transaction_headers
  where id = current_setting('test.header')::uuid;

  if v_issuer->>'addressLine1' is distinct from 'Dock Road'
     or v_issuer->>'vatNumber' is distinct from 'IE9999999T'
     or v_issuer->>'bankingDetails' is distinct from 'IBAN OLD' then
    raise exception 'phase 5: issuer snapshot changed to %', v_issuer;
  end if;
  if v_party->>'addressLine1' is distinct from 'Old quay' then
    raise exception 'phase 5: party snapshot changed to %', v_party;
  end if;

  begin
    update public.transaction_headers
    set issuer_snapshot = '{"name":"Changed"}'::jsonb
    where id = current_setting('test.header')::uuid;
    raise exception 'phase 5: a posted snapshot was updated';
  exception
    when others then
      if sqlerrm not like '%paid amount%' then
        raise exception 'phase 5: snapshot update error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
select 'phase 5 ok' as result;
rollback;
