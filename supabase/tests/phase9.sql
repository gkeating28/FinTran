-- Phase 9 acceptance tests. Raises on failure and rolls back.
begin;
create temp table phase9_users (id uuid primary key);
insert into phase9_users values ('a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase9@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb
from phase9_users;
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase9_users), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Nine Books', 'Phase Nine Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SI', 'Sales invoice', 0, 'Sales');

select set_config('test.standard', $json${
  "version": 1,
  "title": "Tax Invoice",
  "pageSize": "A4",
  "showLogo": true,
  "showVatSummary": true,
  "showBanking": true,
  "organisationFields": ["name", "address", "phone", "contactEmail", "vatNumber"],
  "partyFields": ["contactDetails", "name", "address"],
  "headerFields": ["reference", "transactionDate", "terms", "dueDate"],
  "lineColumns": ["date", "item", "description", "tax", "quantity", "price", "amount"]
}$json$, true);

insert into public.transaction_forms (tenant_id, organisation_id, transaction_type_id, layout)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, id, current_setting('test.standard')::jsonb
from public.transaction_types
where organisation_id = current_setting('test.org')::uuid;

do $$
declare
  v_purchase uuid;
  v_sales uuid;
begin
  select id into v_purchase from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI';
  select id into v_sales from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SI';

  begin
    update public.transaction_forms
    set layout = jsonb_set(layout, '{extra}', 'true')
    where transaction_type_id = v_purchase;
    raise exception 'phase 9: an unknown key was saved';
  exception
    when others then
      if sqlerrm not like '%unknown setting%' then
        raise exception 'phase 9: unknown key error was %', sqlerrm;
      end if;
  end;

  begin
    update public.transaction_forms
    set layout = layout || '{"headerFields":["reference","transactionDate","nope"]}'::jsonb
    where transaction_type_id = v_purchase;
    raise exception 'phase 9: an unknown field was saved';
  exception
    when others then
      if sqlerrm not like '%unknown field%' then
        raise exception 'phase 9: unknown field error was %', sqlerrm;
      end if;
  end;

  update public.transaction_forms
  set layout = jsonb_set(layout, '{organisationFields}', '["name","address","phone"]'::jsonb)
  where transaction_type_id = v_purchase;

  begin
    update public.transaction_forms
    set layout = jsonb_set(layout, '{showVatSummary}', 'false'::jsonb)
    where transaction_type_id = v_sales;
    raise exception 'phase 9: a sales form hid the VAT summary';
  exception
    when others then
      if sqlerrm not like '%VAT summary%' then
        raise exception 'phase 9: sales summary error was %', sqlerrm;
      end if;
  end;

  begin
    update public.transaction_forms
    set layout = jsonb_set(layout, '{organisationFields}', '["name","address","phone"]'::jsonb)
    where transaction_type_id = v_sales;
    raise exception 'phase 9: a sales form omitted the VAT number';
  exception
    when others then
      if sqlerrm not like '%VAT number%' then
        raise exception 'phase 9: sales VAT error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
select 'phase 9 ok' as result;
rollback;
