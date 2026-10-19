-- EN 16931 phase 1. Reference lists are readable, and not writable, by a signed-in user.
begin;

do $$
declare
  v_comment text;
  v_count integer;
begin
  select obj_description('public.ref_countries'::regclass) into v_comment;
  if v_comment is null
     or v_comment not like '%Peppol BIS Billing 3.0.21%'
     or v_comment not like '%2026-03-06%' then
    raise exception 'phase 1: country list version was not recorded';
  end if;

  select count(*) into v_count from public.ref_countries;
  if v_count <> 252 then
    raise exception 'phase 1: expected 252 countries, found %', v_count;
  end if;
  if not exists (
    select 1 from public.ref_countries
    where code = 'IE' and vat_prefix_only = false and active
  ) then
    raise exception 'phase 1: Ireland is missing';
  end if;
  if not exists (
    select 1 from public.ref_countries
    where code = 'GR' and name = 'Greece' and vat_prefix_only = false
  ) then
    raise exception 'phase 1: postal Greece is missing';
  end if;
  if not exists (
    select 1 from public.ref_countries
    where code = 'EL' and name = 'Greece' and vat_prefix_only and active
  ) then
    raise exception 'phase 1: EL VAT prefix is missing';
  end if;
  if (select count(*) from public.ref_countries where vat_prefix_only) <> 1 then
    raise exception 'phase 1: only EL should be a VAT prefix';
  end if;

  select count(*) into v_count from public.ref_currencies;
  if v_count <> 178 then
    raise exception 'phase 1: expected 178 currencies, found %', v_count;
  end if;
  if not exists (select 1 from public.ref_currencies where code = 'EUR' and minor_units = 2) then
    raise exception 'phase 1: EUR minor units';
  end if;
  if not exists (select 1 from public.ref_currencies where code = 'JPY' and minor_units = 0) then
    raise exception 'phase 1: JPY minor units';
  end if;
  if not exists (select 1 from public.ref_currencies where code = 'XAU' and minor_units is null) then
    raise exception 'phase 1: XAU minor units';
  end if;
  if not exists (select 1 from public.ref_currencies where code = 'XCG' and minor_units = 2) then
    raise exception 'phase 1: XCG is missing';
  end if;
  if not exists (select 1 from public.ref_currencies where code = 'CNH' and minor_units = 2) then
    raise exception 'phase 1: CNH minor units';
  end if;
  if exists (select 1 from public.ref_currencies where code in ('ANG', 'BGN')) then
    raise exception 'phase 1: ANG or BGN is still in the May 2026 list';
  end if;

  select count(*) into v_count from public.ref_units;
  if v_count <> 2162 then
    raise exception 'phase 1: expected 2162 units, found %', v_count;
  end if;
  if (
    select count(*) from public.ref_units
    where common and code in ('C62', 'H87', 'HUR', 'DAY', 'MON', 'KGM', 'LTR', 'MTR', 'MTK', 'KMT', 'SET', 'XBX')
  ) <> 12 or (select count(*) from public.ref_units where common) <> 12 then
    raise exception 'phase 1: common units';
  end if;

  if not exists (
    select 1 from public.ref_vat_categories
    where code = 'S' and requires_exemption_reason = false and rate_must_be_zero = false
  ) or not exists (
    select 1 from public.ref_vat_categories
    where code = 'O' and requires_exemption_reason and rate_must_be_zero
  ) or not exists (
    select 1 from public.ref_vat_categories
    where code = 'Z' and requires_exemption_reason = false and rate_must_be_zero
  ) or not exists (
    select 1 from public.ref_vat_categories
    where code = 'E' and requires_exemption_reason and rate_must_be_zero
  ) or not exists (
    select 1 from public.ref_vat_categories where code = 'B' and active
  ) or (select count(*) from public.ref_vat_categories) <> 10 then
    raise exception 'phase 1: VAT categories';
  end if;

  select count(*) into v_count from public.ref_vatex;
  if v_count <> 88 then
    raise exception 'phase 1: expected 88 VATEX codes, found %', v_count;
  end if;

  if (select count(*) from public.ref_payment_means) <> 84
     or (select count(*) from public.ref_payment_means where common) <> 7
     or not exists (
       select 1 from public.ref_payment_means
       where code = '58' and name = 'SEPA credit transfer' and common
     ) then
    raise exception 'phase 1: payment means';
  end if;

  if (select count(*) from public.ref_eas) <> 83
     or not exists (
       select 1 from public.ref_eas
       where code = '9935' and name = 'Ireland VAT number'
     )
     or exists (select 1 from public.ref_eas where code = '0037') then
    raise exception 'phase 1: EAS schemes';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
set local role authenticated;

do $$
declare
  v_table text;
  v_count integer;
begin
  foreach v_table in array array[
    'ref_countries', 'ref_currencies', 'ref_units', 'ref_vat_categories',
    'ref_vatex', 'ref_payment_means', 'ref_eas'
  ]
  loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    if v_count < 1 then
      raise exception 'phase 1: % was empty for a signed-in user', v_table;
    end if;

    begin
      execute format('insert into public.%I (code, name) values (%L, %L)', v_table, 'ZZ', 'Test');
      raise exception 'phase 1: insert was allowed on %', v_table;
    exception
      when insufficient_privilege then null;
    end;

    begin
      execute format('update public.%I set name = name', v_table);
      raise exception 'phase 1: update was allowed on %', v_table;
    exception
      when insufficient_privilege then null;
    end;

    begin
      execute format('delete from public.%I', v_table);
      raise exception 'phase 1: delete was allowed on %', v_table;
    exception
      when insufficient_privilege then null;
    end;
  end loop;
end;
$$;

set local role anon;

do $$
begin
  perform 1 from public.ref_countries limit 1;
  raise exception 'phase 1: an anonymous user could read countries';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
rollback;
select 'en16931 phase 1 ok' as result;
