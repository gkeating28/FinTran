-- Phase 8 acceptance tests. Raises on failure and rolls back.
begin;
create temp table phase8_users (who text primary key, id uuid not null);
insert into phase8_users values
  ('owner', 'a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8'),
  ('admin', 'b8b8b8b8-b8b8-4b8b-8b8b-b8b8b8b8b8b8');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-phase8@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from phase8_users;
select set_config('test.owner', (select id::text from phase8_users where who = 'owner'), true);
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Eight Books', 'Phase Eight Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
select public.grant_organisation_access(current_setting('test.org')::uuid, 'admin-phase8@fintran.test', 'admin');
select set_config('test.empty', public.create_organisation(current_setting('test.tenant')::uuid, 'Phase Eight Empty')::text, true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.empty')::uuid, 'EUR', 'Euro', 1);

select public.delete_organisation(current_setting('test.empty')::uuid);
do $$
begin
  if exists (select 1 from public.organisations where id = current_setting('test.empty')::uuid) then
    raise exception 'phase 8: the empty organisation was not deleted';
  end if;
  if exists (select 1 from public.currencies where organisation_id = current_setting('test.empty')::uuid) then
    raise exception 'phase 8: setup rows survived the deletion';
  end if;
end;
$$;

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1);
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');
select public.save_purchase_invoice(jsonb_build_object(
  'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid),
  'supplierId', (select id from public.suppliers where organisation_id = current_setting('test.org')::uuid),
  'transactionDate', '2026-10-19',
  'currencyId', (select id from public.currencies where organisation_id = current_setting('test.org')::uuid),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Draft', 'quantity', 1, 'price', 1))
));

do $$
begin
  begin
    perform public.delete_organisation(current_setting('test.org')::uuid);
    raise exception 'phase 8: an organisation with a draft was deleted';
  exception
    when others then
      if sqlerrm not like '%has documents%' then
        raise exception 'phase 8: document delete error was %', sqlerrm;
      end if;
  end;
  delete from public.organisations where id = current_setting('test.org')::uuid;
  if not exists (select 1 from public.organisations where id = current_setting('test.org')::uuid) then
    raise exception 'phase 8: a direct delete removed the organisation';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase8_users where who = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.delete_organisation(current_setting('test.org')::uuid);
    raise exception 'phase 8: an admin deleted an organisation';
  exception
    when others then
      if sqlerrm not like '%owner role%' then
        raise exception 'phase 8: admin delete error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
select 'phase 8 ok' as result;
rollback;
