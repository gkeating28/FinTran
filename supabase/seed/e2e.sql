-- Seed for the end-to-end tests. scripts/seed-e2e.ts runs it against the local Supabase stack, after it has signed
-- the three test people up through the sign-up API. It is never run against the hosted project.
--
-- psql variables: owner, admin, member (user ids), admin_email, member_email, hmac (the e-invoice signing key),
-- ai_secret (the mock AI key, encrypted with the test secrets key).
\set ON_ERROR_STOP on

-- The e-invoice signing key the app also has, so signatures made by the app check out in the database.
select vault.create_secret(:'hmac', 'einvoice_hmac_k1', 'End-to-end test signing key')
where not exists (select 1 from vault.secrets where name = 'einvoice_hmac_k1');

-- Everything below is done as the owner, through the same rules a signed-in person meets.
select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, false);
set role authenticated;

select set_config('seed.org', (public.create_tenant('Qula Test Books', 'Qula Test One'))->>'organisation_id', false);
select set_config('seed.tenant', (select tenant_id::text from public.organisations where id = current_setting('seed.org')::uuid), false);
select public.create_organisation(current_setting('seed.tenant')::uuid, 'Qula Test Two', 'EUR');
select set_config('seed.org2', (select id::text from public.organisations where tenant_id = current_setting('seed.tenant')::uuid and name = 'Qula Test Two'), false);

select public.grant_organisation_access(current_setting('seed.org')::uuid, :'admin_email', 'admin');
select public.grant_organisation_access(current_setting('seed.org')::uuid, :'member_email', 'member');
select public.grant_organisation_access(current_setting('seed.org2')::uuid, :'admin_email', 'admin');

-- The usual setup lists, in both organisations.
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
select tenant_id, id, 'EUR', 'Euro', 1 from public.organisations where tenant_id = current_setting('seed.tenant')::uuid
on conflict (organisation_id, code) do nothing;

insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
select o.tenant_id, o.id, v.code, v.description, v.account_type
from public.organisations as o
cross join (values ('4000', 'Sales', 'Income'), ('6000', 'Purchases', 'Expense')) as v(code, description, account_type)
where o.tenant_id = current_setting('seed.tenant')::uuid;

insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
select o.tenant_id, o.id, v.code, v.description, v.rate, v.vat_type, v.vat_category
from public.organisations as o
cross join (values
  ('S23', 'Sales standard 23%', 23, 'Sales', 'S'),
  ('P23', 'Purchases standard 23%', 23, 'Expense', 'S')
) as v(code, description, rate, vat_type, vat_category)
where o.tenant_id = current_setting('seed.tenant')::uuid;

insert into public.departments (tenant_id, organisation_id, code, description)
select tenant_id, id, 'OPS', 'Operations' from public.organisations where tenant_id = current_setting('seed.tenant')::uuid;
insert into public.cost_centres (tenant_id, organisation_id, code, description)
select tenant_id, id, 'HQ', 'Head office' from public.organisations where tenant_id = current_setting('seed.tenant')::uuid;

-- A Peppol ID belongs to one organisation, so each has its own.
update public.organisation_defaults
set address_line1 = '1 Dock Road', city = 'Dublin', post_code = 'D01 AB12', country_code = 'IE',
    vat_number = 'IE1234567T', peppol_scheme = '9935', peppol_id = 'IE1234567T'
where organisation_id = current_setting('seed.org')::uuid;
update public.organisation_defaults
set address_line1 = '2 Dock Road', city = 'Dublin', post_code = 'D01 AB13', country_code = 'IE',
    vat_number = 'IE2345678T', peppol_scheme = '9935', peppol_id = 'IE2345678T'
where organisation_id = current_setting('seed.org2')::uuid;

-- A Purchases and a Sales type for each kind of document.
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, reference_prefix, reference_padding)
select o.tenant_id, o.id, v.code, v.description, 0, v.type, v.kind::public.document_kind, v.prefix, 5
from public.organisations as o
cross join (values
  ('PRQ', 'Purchase requisition', 'Purchases', 'requisition', 'PRQ-'),
  ('POR', 'Purchase order', 'Purchases', 'order', 'POR-'),
  ('PIN', 'Purchase invoice', 'Purchases', 'invoice', 'PIN-'),
  ('PCN', 'Purchase credit note', 'Purchases', 'credit_note', 'PCN-'),
  ('SOR', 'Sales order', 'Sales', 'order', 'SOR-'),
  ('SIN', 'Sales invoice', 'Sales', 'invoice', 'SIN-'),
  ('SCN', 'Sales credit note', 'Sales', 'credit_note', 'SCN-')
) as v(code, description, type, kind, prefix)
where o.tenant_id = current_setting('seed.tenant')::uuid;

-- Received e-invoices become Purchases drafts of these types.
update public.organisation_defaults as d
set inbound_invoice_type_id = (select id from public.transaction_types where organisation_id = d.organisation_id and code = 'PIN'),
    inbound_credit_note_type_id = (select id from public.transaction_types where organisation_id = d.organisation_id and code = 'PCN')
where d.organisation_id in (current_setting('seed.org')::uuid, current_setting('seed.org2')::uuid);

-- Two customers and two suppliers with complete e-invoicing details.
insert into public.customers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city, post_code, country_code,
  vat_number, peppol_scheme, peppol_id, default_buyer_reference, payment_terms_days, email
)
select c.tenant_id, c.organisation_id, v.code, v.name, c.id, v.line1, v.city, v.post_code, 'IE',
  v.vat, '9935', v.vat, v.buyer_reference, 30, v.email
from public.currencies as c
cross join (values
  ('ACME', 'Acme Limited', '4 Quay', 'Cork', 'T12 CD34', 'IE7654321A', 'ACME-REF', 'accounts@acme.example'),
  ('BETA', 'Beta Stores', '9 Main Street', 'Galway', 'H91 EF56', 'IE7654321B', 'BETA-REF', 'accounts@beta.example')
) as v(code, name, line1, city, post_code, vat, buyer_reference, email)
where c.organisation_id = current_setting('seed.org')::uuid and c.code = 'EUR';

insert into public.suppliers (
  tenant_id, organisation_id, code, name, currency_id, address_line1, city, post_code, country_code,
  vat_number, peppol_scheme, peppol_id, email
)
select c.tenant_id, c.organisation_id, v.code, v.name, c.id, v.line1, v.city, v.post_code, 'IE', v.vat, '9935', v.vat, v.email
from public.currencies as c
cross join (values
  ('VOD', 'Vodafone Ireland', 'Mountainview', 'Dublin', 'D18 XN97', 'IE8765432C', 'billing@vodafone.example'),
  ('HARB', 'Harbour Supplies', 'Quay 4', 'Dublin', 'D02 GH78', 'IE8765432D', 'sales@harbour.example')
) as v(code, name, line1, city, post_code, vat, email)
where c.organisation_id = current_setting('seed.org')::uuid and c.code = 'EUR';

-- Ask Qula on the mock provider, with actions switched on, in the first organisation only.
select public.set_organisation_secret(current_setting('seed.org')::uuid, 'ai_api_key', :'ai_secret', 'mock');
insert into public.ai_settings (organisation_id, tenant_id, enabled, provider_code, model, data_notice_accepted_at, actions_enabled)
values (current_setting('seed.org')::uuid, current_setting('seed.tenant')::uuid, true, 'mock', 'mock', now(), true);

reset role;
select 'e2e seed ok' as result, current_setting('seed.org') as organisation_one, current_setting('seed.org2') as organisation_two;
