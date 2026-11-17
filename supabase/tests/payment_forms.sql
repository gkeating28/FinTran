-- Payments release B, phase 7b: the form designer for payments, receipts and refunds. Raises on failure and rolls back.
begin;

create temp table pf_users (who text primary key, id uuid not null);
insert into pf_users (who, id) values ('owner', 'a8a8a8a8-a8a8-4a8a-8a8a-a8a8a8a8a8a8');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, who || '-pform@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('display_name', who)
from pf_users;

create function pg_temp.expect_error(p_sql text, p_fragment text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'payment forms: % was accepted', p_label;
exception
  when others then
    if sqlerrm like 'payment forms: %' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'payment forms: % failed with "%", expected "%"', p_label, sqlerrm, p_fragment;
    end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select id from pf_users where who = 'owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Payment Forms Books', 'Payment Forms Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);
reset role;

insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering, reference_prefix, reference_padding)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PPY', 'Purchases payment', 0, 'Purchases', 'payment', 'on_post', 'PPY-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SRF', 'Sales payment', 0, 'Sales', 'payment', 'on_post', 'SRF-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SRC', 'Sales receipt', 0, 'Sales', 'receipt', 'on_post', 'SRC-', 5),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'SIN', 'Sales invoice', 0, 'Sales', 'invoice', 'on_post', 'SIN-', 5);
select set_config('test.ppy', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PPY'), true);
select set_config('test.srf', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SRF'), true);
select set_config('test.src', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SRC'), true);
select set_config('test.sin', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'SIN'), true);

create function pg_temp.save(p_type text, p_layout text) returns void language plpgsql as $$
begin
  insert into public.transaction_forms (tenant_id, organisation_id, transaction_type_id, layout)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, current_setting(p_type)::uuid, p_layout::jsonb)
  on conflict (organisation_id, transaction_type_id) do update set layout = excluded.layout;
end $$;

create function pg_temp.layout(p_party text, p_header text, p_lines text, p_org text default '["name","address"]') returns text language sql as $$
  select format('{"version":1,"title":"Remittance advice","pageSize":"A4","showLogo":true,"organisationFields":%s,"partyFields":%s,"headerFields":%s,"lineColumns":%s}', p_org, p_party, p_header, p_lines)
$$;

-- The standard layout of a payment is accepted for money out and money in, for a purchase type and a sales type.
select pg_temp.save('test.ppy', pg_temp.layout('["name","address","vatNumber"]', '["documentNumber","transactionDate","paymentMeans","bankReference","bankAccount","currency"]', '["document","date","total","applied"]'));
select pg_temp.save('test.srf', pg_temp.layout('["name","address"]', '["documentNumber","transactionDate"]', '["document","applied"]'));
select pg_temp.save('test.src', pg_temp.layout('["name"]', '["transactionDate","documentNumber","bankAccount"]', '["applied","document"]'));

-- A payment form needs no VAT number, quantity or price, which a sales form does.
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.sin', %L)$s$, pg_temp.layout('["name","address"]', '["documentNumber","transactionDate"]', '["document","applied"]')),
  'unknown field', 'a payment line column on an invoice form');

-- A payment form cannot use document fields.
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["name"]', '["documentNumber","transactionDate","dueDate"]', '["document","applied"]')),
  'unknown field', 'a document header field on a payment form');
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["name"]', '["documentNumber","transactionDate"]', '["document","applied","quantity"]')),
  'unknown field', 'a document line column on a payment form');
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["name","phone"]', '["documentNumber","transactionDate"]', '["document","applied"]')),
  'unknown field', 'a party field a payment does not print');

-- What a payment must show.
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["name"]', '["documentNumber","transactionDate"]', '["document","applied"]', '["address"]')),
  'organisation name', 'no organisation name');
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["address"]', '["documentNumber","transactionDate"]', '["document","applied"]')),
  'name of who was paid', 'no party name');
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["name"]', '["documentNumber"]', '["document","applied"]')),
  'number and date', 'no date');
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["name"]', '["documentNumber","transactionDate"]', '["document"]')),
  'amount applied', 'no amount applied');
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.ppy', %L)$s$, pg_temp.layout('["name"]', '["documentNumber","transactionDate","bankReference","bankReference"]', '["document","applied"]')),
  'repeats the field', 'a repeated field');

-- The sales rules for documents still hold.
select pg_temp.expect_error(
  format($s$select pg_temp.save('test.sin', %L)$s$, '{"version":1,"title":"Invoice","organisationFields":["name"],"partyFields":["name"],"headerFields":["documentNumber","transactionDate"],"lineColumns":["description"]}'),
  'A sales form must show', 'a sales invoice without its required fields');

rollback;
