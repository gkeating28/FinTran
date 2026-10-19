-- EN 16931 phase 2. Structured addresses, VAT, Peppol, bank details, and ISO currency codes.
begin;

do $$
declare
  v_line1 text;
  v_line2 text;
  v_line3 text;
  v_review boolean;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers' and column_name = 'address'
  ) then
    raise exception 'phase 2: the free-text address column is still present';
  end if;

  select line1, line2, line3, needs_review
    into v_line1, v_line2, v_line3, v_review
  from private.split_legacy_address(E'First\nSecond\nThird\nFourth');
  if v_line1 <> 'First' or v_line2 <> 'Second' or v_line3 <> 'Third Fourth' or v_review is not true then
    raise exception 'phase 2: multi-line split was % / % / % / %', v_line1, v_line2, v_line3, v_review;
  end if;

  select line1, needs_review into v_line1, v_review from private.split_legacy_address('   ');
  if v_line1 is not null or v_review then
    raise exception 'phase 2: a blank address was marked for review';
  end if;

  select line1, line2, needs_review into v_line1, v_line2, v_review from private.split_legacy_address('Only one');
  if v_line1 <> 'Only one' or v_line2 is not null or v_review is not true then
    raise exception 'phase 2: a single address line was not marked for review';
  end if;

  if exists (select 1 from public.currencies where iso_code is null or iso_code !~ '^[A-Z]{3}$') then
    raise exception 'phase 2: a currency has no ISO code';
  end if;
end;
$$;

create temp table phase2_users (id uuid primary key);
insert into phase2_users values ('a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase2@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb
from phase2_users;
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase2_users), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Two Books', 'Phase Two Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1);

do $$
declare
  v_iso text;
  v_supplier uuid;
begin
  select iso_code into v_iso from public.currencies where organisation_id = current_setting('test.org')::uuid;
  if v_iso <> 'EUR' then
    raise exception 'phase 2: EUR was stored as %', v_iso;
  end if;

  begin
    insert into public.currencies (tenant_id, organisation_id, code, name, rate, iso_code)
    values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EURO', 'Euro again', 1, 'EUR');
    raise exception 'phase 2: a second EUR ISO code was saved';
  exception
    when unique_violation then null;
  end;

  begin
    insert into public.currencies (tenant_id, organisation_id, code, name, rate)
    values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'HOME', 'Home', 1);
    raise exception 'phase 2: a currency without an ISO code was saved';
  exception
    when others then
      if sqlerrm not like '%ISO currency%' then
        raise exception 'phase 2: ISO error was %', sqlerrm;
      end if;
  end;

  insert into public.suppliers (
    tenant_id, organisation_id, code, name, currency_id, vat_number,
    address_line1, post_code, country_code
  )
  select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'IECO', 'Irish Co', id,
    'IE1234567T', 'Dock Street', 'd1  2ab', 'IE'
  from public.currencies where organisation_id = current_setting('test.org')::uuid;

  if not exists (
    select 1 from public.suppliers
    where organisation_id = current_setting('test.org')::uuid and vat_number = 'IE1234567T' and post_code = 'D1 2AB'
  ) then
    raise exception 'phase 2: Irish VAT or post code was not stored';
  end if;

  insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, vat_number)
  select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'DECO', 'German Co', id, 'DE123456789'
  from public.currencies where organisation_id = current_setting('test.org')::uuid;

  begin
    insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, vat_number)
    select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'BAD1', 'Bad', id, '1234567T'
    from public.currencies where organisation_id = current_setting('test.org')::uuid;
    raise exception 'phase 2: a VAT number without a prefix was saved';
  exception
    when others then
      if sqlerrm not like '%IE1234567T%' then
        raise exception 'phase 2: VAT prefix error was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, vat_number)
    select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'BAD2', 'Bad', id, 'XX123'
    from public.currencies where organisation_id = current_setting('test.org')::uuid;
    raise exception 'phase 2: XX123 was saved';
  exception
    when others then
      if sqlerrm not like '%IE1234567T%' then
        raise exception 'phase 2: XX123 error was %', sqlerrm;
      end if;
  end;

  begin
    update public.suppliers set country_code = 'EL' where code = 'IECO';
    raise exception 'phase 2: EL was stored as a postal country';
  exception
    when others then
      if sqlerrm not like '%postal country%' then
        raise exception 'phase 2: EL error was %', sqlerrm;
      end if;
  end;

  update public.suppliers
  set peppol_scheme = '9935', peppol_id = 'IE1234567T'
  where code = 'IECO';

  begin
    update public.suppliers
    set peppol_scheme = '9935', peppol_id = 'ie1234567t'
    where code = 'DECO';
    raise exception 'phase 2: two suppliers shared a Peppol ID';
  exception
    when unique_violation then null;
  end;

  update public.suppliers set peppol_scheme = null, peppol_id = null where code = 'DECO';
  if not exists (
    select 1 from public.suppliers
    where organisation_id = current_setting('test.org')::uuid and peppol_id is null
  ) then
    raise exception 'phase 2: a supplier could not be left without a Peppol ID';
  end if;

  update public.organisation_defaults
  set iban = 'IE29 AIBK 9311 5212 3456 78', bic = 'aibkie2d', bank_account_name = 'Phase Two Office'
  where organisation_id = current_setting('test.org')::uuid;
  if not exists (
    select 1 from public.organisation_defaults
    where organisation_id = current_setting('test.org')::uuid
      and iban = 'IE29AIBK93115212345678'
      and bic = 'AIBKIE2D'
  ) then
    raise exception 'phase 2: the IBAN was not stored without spaces';
  end if;

  begin
    update public.organisation_defaults
    set iban = 'IE00AIBK93115212345678'
    where organisation_id = current_setting('test.org')::uuid;
    raise exception 'phase 2: an invalid IBAN was saved';
  exception
    when others then
      if sqlerrm not like '%IBAN%' then
        raise exception 'phase 2: IBAN error was %', sqlerrm;
      end if;
  end;

  update public.suppliers
  set address_line1 = 'Quay', address_needs_review = true
  where code = 'IECO';
  update public.suppliers
  set address_line1 = 'Quay', address_needs_review = false
  where code = 'IECO';
  if exists (
    select 1 from public.suppliers where code = 'IECO' and address_needs_review
  ) then
    raise exception 'phase 2: saving the address left the review flag set';
  end if;

  select id into v_supplier from public.suppliers where code = 'IECO';
  insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
  values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');
  perform public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid),
    'supplierId', v_supplier,
    'transactionDate', '2026-10-19',
    'currencyId', (select id from public.currencies where organisation_id = current_setting('test.org')::uuid),
    'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'One', 'quantity', 1, 'price', 1))
  ));
  perform public.post_document((
    select id from public.transaction_headers where organisation_id = current_setting('test.org')::uuid limit 1
  ), null);
  if not exists (
    select 1 from public.transaction_headers
    where organisation_id = current_setting('test.org')::uuid
      and issuer_snapshot->>'address' like '%Ireland%'
      and party_snapshot->>'address' like '%Quay%'
      and party_snapshot->>'address' like '%D1 2AB%'
  ) then
    raise exception 'phase 2: the posted snapshot did not keep the structured address';
  end if;
end;
$$;

reset role;
rollback;
select 'en16931 phase 2 ok' as result;
