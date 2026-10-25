-- Phase 6 acceptance tests. Raises on failure and rolls back.
begin;

create temp table phase6_users (who text primary key, id uuid not null);
insert into phase6_users (who, id) values ('owner', 'a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase6@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb
from phase6_users;

select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase6_users), 'role', 'authenticated')::text, true);
set local role authenticated;

select set_config('test.org', (public.create_tenant('Phase Six Books', 'Phase Six Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1)
on conflict (organisation_id, code) do nothing;
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;

insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, numbering)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'on_insert');
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, numbering)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PO', 'Purchase order', 0, 'Purchases', 'on_post');
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, numbering)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales', 'on_insert');

do $$
begin
  if (select numbering from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI') is distinct from 'on_post' then
    raise exception 'phase 6: a Sales type was not forced to on_post';
  end if;
  if (select numbering from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI') is distinct from 'on_insert' then
    raise exception 'phase 6: an existing-style Purchases type did not stay on_insert';
  end if;
end;
$$;

select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.po', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PO'), true);

select set_config('test.draft', public.save_document(jsonb_build_object(
  'transactionTypeId', current_setting('test.po'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-10-19',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'One', 'quantity', 1, 'price', 1))
))::text, true);

do $$
declare i integer;
begin
  if (select reference from public.transaction_headers where id = current_setting('test.draft')::uuid) is not null then
    raise exception 'phase 6: an on_post draft was numbered';
  end if;
  for i in 1..2 loop
    perform public.save_document(jsonb_build_object(
      'transactionTypeId', current_setting('test.po'),
      'supplierId', current_setting('test.supplier'),
      'transactionDate', '2026-10-19',
      'currencyId', current_setting('test.currency'),
      'exchangeRate', 1,
      'lines', jsonb_build_array(jsonb_build_object('description', 'Extra', 'quantity', 1, 'price', 1))
    ));
  end loop;
  delete from public.transaction_headers
  where transaction_type_id = current_setting('test.po')::uuid
    and id <> current_setting('test.draft')::uuid;
  delete from public.transaction_headers where id = current_setting('test.draft')::uuid;
end;
$$;

select set_config('test.posted', public.save_document(jsonb_build_object(
  'transactionTypeId', current_setting('test.po'),
  'supplierId', current_setting('test.supplier'),
  'transactionDate', '2026-10-19',
  'currencyId', current_setting('test.currency'),
  'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Kept', 'quantity', 1, 'price', 1))
))::text, true);
select public.post_document(current_setting('test.posted')::uuid, null);

do $$
begin
  if (select reference from public.transaction_headers where id = current_setting('test.posted')::uuid) is distinct from 1 then
    raise exception 'phase 6: posted reference is %, expected 1', (select reference from public.transaction_headers where id = current_setting('test.posted')::uuid);
  end if;
  begin
    update public.transaction_headers set reference = 9 where id = current_setting('test.posted')::uuid;
    raise exception 'phase 6: a posted reference was changed';
  exception
    when others then
      if sqlerrm not like '%renumbered%' then
        raise exception 'phase 6: renumber error was %', sqlerrm;
      end if;
  end;
  begin
    update public.transaction_types set numbering = 'on_insert' where id = current_setting('test.po')::uuid;
    raise exception 'phase 6: numbering changed after a document existed';
  exception
    when others then
      if sqlerrm not like '%Numbering cannot change%' then
        raise exception 'phase 6: numbering change error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
select 'phase 6 ok' as result;
rollback;
