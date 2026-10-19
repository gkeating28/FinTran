-- EN 16931 phase 2: structured addresses, identifiers, bank details, and ISO currency codes.

create or replace function private.split_legacy_address(p_address text)
returns table (line1 text, line2 text, line3 text, needs_review boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
  extra text;
begin
  if p_address is null or btrim(p_address) = '' then
    line1 := null;
    line2 := null;
    line3 := null;
    needs_review := false;
    return next;
    return;
  end if;

  parts := array(
    select btrim(line)
    from unnest(regexp_split_to_array(replace(p_address, E'\r\n', E'\n'), E'[\n\r]')) as line
    where btrim(line) <> ''
  );
  needs_review := true;
  line1 := left(parts[1], 100);
  if cardinality(parts) >= 2 then
    line2 := left(parts[2], 100);
  end if;
  if cardinality(parts) >= 3 then
    extra := array_to_string(parts[3:cardinality(parts)], ' ');
    line3 := left(extra, 100);
  end if;
  return next;
end;
$$;

revoke all on function private.split_legacy_address(text) from public, anon, authenticated;

create or replace function private.postal_address_text(
  p_line1 text,
  p_line2 text,
  p_line3 text,
  p_city text,
  p_post_code text,
  p_county text,
  p_country text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(concat_ws(
    E'\n',
    nullif(btrim(p_line1), ''),
    nullif(btrim(p_line2), ''),
    nullif(btrim(p_line3), ''),
    nullif(btrim(p_city), ''),
    nullif(btrim(p_county), ''),
    nullif(btrim(p_post_code), ''),
    nullif(btrim(p_country), '')
  ), '');
$$;

revoke all on function private.postal_address_text(text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function private.prepare_postal(
  p_line1 text,
  p_line2 text,
  p_line3 text,
  p_city text,
  p_post_code text,
  p_county text,
  p_country text
)
returns table (
  line1 text,
  line2 text,
  line3 text,
  city text,
  post_code text,
  county text,
  country_code text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_country text;
begin
  line1 := nullif(btrim(p_line1), '');
  line2 := nullif(btrim(p_line2), '');
  line3 := nullif(btrim(p_line3), '');
  city := nullif(btrim(p_city), '');
  county := nullif(btrim(p_county), '');
  post_code := nullif(regexp_replace(upper(btrim(coalesce(p_post_code, ''))), '\s+', ' ', 'g'), '');
  if line1 is not null and char_length(line1) > 100 then
    raise exception 'Address line 1 can be up to 100 characters';
  end if;
  if line2 is not null and char_length(line2) > 100 then
    raise exception 'Address line 2 can be up to 100 characters';
  end if;
  if line3 is not null and char_length(line3) > 100 then
    raise exception 'Address line 3 can be up to 100 characters';
  end if;
  if city is not null and char_length(city) > 60 then
    raise exception 'City can be up to 60 characters';
  end if;
  if county is not null and char_length(county) > 60 then
    raise exception 'County can be up to 60 characters';
  end if;
  if post_code is not null and char_length(post_code) > 20 then
    raise exception 'Post code can be up to 20 characters';
  end if;

  v_country := upper(btrim(coalesce(p_country, '')));
  if v_country = '' then
    v_country := 'IE';
  end if;
  if exists (
    select 1 from public.ref_countries
    where code = v_country and vat_prefix_only
  ) or not exists (
    select 1 from public.ref_countries where code = v_country
  ) then
    raise exception 'Choose a postal country';
  end if;
  country_code := v_country;
  return next;
end;
$$;

revoke all on function private.prepare_postal(text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function private.prepare_vat_number(p_value text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_number text;
begin
  v_number := nullif(upper(regexp_replace(coalesce(p_value, ''), '[[:space:]]', '', 'g')), '');
  if v_number is null then
    return null;
  end if;
  if v_number !~ '^[A-Z]{2}[A-Z0-9]{2,13}$'
     or not exists (select 1 from public.ref_countries where code = left(v_number, 2)) then
    raise exception 'Enter a VAT number with a country prefix, for example IE1234567T';
  end if;
  return v_number;
end;
$$;

revoke all on function private.prepare_vat_number(text) from public, anon, authenticated;

create or replace function private.prepare_company_number(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_number text;
begin
  v_number := nullif(btrim(coalesce(p_value, '')), '');
  if v_number is null then
    return null;
  end if;
  if char_length(v_number) > 40 or v_number !~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$' then
    raise exception 'Company number can be up to 40 letters or numbers';
  end if;
  return v_number;
end;
$$;

revoke all on function private.prepare_company_number(text) from public, anon, authenticated;

create or replace function private.prepare_peppol(p_scheme text, p_id text)
returns table (scheme text, identifier text)
language plpgsql
stable
set search_path = ''
as $$
begin
  scheme := nullif(btrim(coalesce(p_scheme, '')), '');
  identifier := nullif(btrim(coalesce(p_id, '')), '');
  if (scheme is null) <> (identifier is null) then
    raise exception 'Enter both the Peppol scheme and the Peppol ID, or leave both blank';
  end if;
  if identifier is not null and char_length(identifier) > 100 then
    raise exception 'Peppol ID can be up to 100 characters';
  end if;
  if scheme is not null and not exists (select 1 from public.ref_eas where code = scheme) then
    raise exception 'Choose a Peppol scheme';
  end if;
  return next;
end;
$$;

revoke all on function private.prepare_peppol(text, text) from public, anon, authenticated;

create or replace function private.iban_is_valid(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_iban text;
  v_rearranged text;
  v_expanded text := '';
  v_index integer;
  v_character text;
begin
  v_iban := upper(regexp_replace(coalesce(p_iban, ''), '\s+', '', 'g'));
  if v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    return false;
  end if;
  v_rearranged := substring(v_iban from 5) || substring(v_iban from 1 for 4);
  for v_index in 1..char_length(v_rearranged) loop
    v_character := substring(v_rearranged from v_index for 1);
    if v_character ~ '[A-Z]' then
      v_expanded := v_expanded || (ascii(v_character) - 55)::text;
    else
      v_expanded := v_expanded || v_character;
    end if;
  end loop;
  return (v_expanded::numeric % 97) = 1;
end;
$$;

revoke all on function private.iban_is_valid(text) from public, anon, authenticated;

create or replace function private.prepare_iban(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_iban text;
begin
  v_iban := nullif(upper(regexp_replace(coalesce(p_value, ''), '\s+', '', 'g')), '');
  if v_iban is null then
    return null;
  end if;
  if not private.iban_is_valid(v_iban) then
    raise exception 'Enter a valid IBAN';
  end if;
  return v_iban;
end;
$$;

revoke all on function private.prepare_iban(text) from public, anon, authenticated;

create or replace function private.prepare_bic(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bic text;
begin
  v_bic := nullif(upper(regexp_replace(coalesce(p_value, ''), '\s+', '', 'g')), '');
  if v_bic is null then
    return null;
  end if;
  if v_bic !~ '^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$' then
    raise exception 'Enter a BIC of 8 or 11 characters';
  end if;
  return v_bic;
end;
$$;

revoke all on function private.prepare_bic(text) from public, anon, authenticated;

alter table public.organisation_defaults
  add column address_line1 text,
  add column address_line2 text,
  add column address_line3 text,
  add column city text,
  add column post_code text,
  add column county text,
  add column country_code text not null default 'IE',
  add column address_needs_review boolean not null default false,
  add column peppol_scheme text,
  add column peppol_id text,
  add column iban text,
  add column bic text,
  add column bank_account_name text;

alter table public.customers
  add column address_line1 text,
  add column address_line2 text,
  add column address_line3 text,
  add column city text,
  add column post_code text,
  add column county text,
  add column country_code text not null default 'IE',
  add column address_needs_review boolean not null default false,
  add column company_number text,
  add column peppol_scheme text,
  add column peppol_id text;

alter table public.suppliers
  add column address_line1 text,
  add column address_line2 text,
  add column address_line3 text,
  add column city text,
  add column post_code text,
  add column county text,
  add column country_code text not null default 'IE',
  add column address_needs_review boolean not null default false,
  add column company_number text,
  add column peppol_scheme text,
  add column peppol_id text;

update public.organisation_defaults as target
set
  address_line1 = split.line1,
  address_line2 = split.line2,
  address_line3 = split.line3,
  address_needs_review = split.needs_review
from (
  select defaults.organisation_id, parsed.line1, parsed.line2, parsed.line3, parsed.needs_review
  from public.organisation_defaults as defaults
  cross join lateral private.split_legacy_address(defaults.address) as parsed
) as split
where target.organisation_id = split.organisation_id;

update public.customers as target
set
  address_line1 = split.line1,
  address_line2 = split.line2,
  address_line3 = split.line3,
  address_needs_review = split.needs_review
from (
  select party.id, parsed.line1, parsed.line2, parsed.line3, parsed.needs_review
  from public.customers as party
  cross join lateral private.split_legacy_address(party.address) as parsed
) as split
where target.id = split.id;

update public.suppliers as target
set
  address_line1 = split.line1,
  address_line2 = split.line2,
  address_line3 = split.line3,
  address_needs_review = split.needs_review
from (
  select party.id, parsed.line1, parsed.line2, parsed.line3, parsed.needs_review
  from public.suppliers as party
  cross join lateral private.split_legacy_address(party.address) as parsed
) as split
where target.id = split.id;

do $$
declare
  v_row record;
  v_raw text;
  v_new text;
begin
  for v_row in
    select organisation_id, vat_number
    from public.organisation_defaults
    where vat_number is not null
  loop
    v_raw := upper(regexp_replace(v_row.vat_number, '[[:space:]]', '', 'g'));
    v_new := null;
    if v_raw ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'
       and exists (select 1 from public.ref_countries where code = left(v_raw, 2)) then
      v_new := v_raw;
    elsif v_raw ~ '^[0-9]{7}[A-Z]{1,2}$' or v_raw ~ '^[0-9][A-Z][0-9]{5}[A-Z]$' then
      v_new := 'IE' || v_raw;
    end if;

    if v_new is null then
      update public.organisation_defaults
      set vat_number = null, address_needs_review = true
      where organisation_id = v_row.organisation_id;
    elsif v_new is distinct from v_row.vat_number then
      update public.organisation_defaults
      set vat_number = v_new
      where organisation_id = v_row.organisation_id;
    end if;
  end loop;

  for v_row in
    select id, vat_number, 'customers'::text as source
    from public.customers
    where vat_number is not null
    union all
    select id, vat_number, 'suppliers'::text
    from public.suppliers
    where vat_number is not null
  loop
    v_raw := upper(regexp_replace(v_row.vat_number, '[[:space:]]', '', 'g'));
    v_new := null;
    if v_raw ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'
       and exists (select 1 from public.ref_countries where code = left(v_raw, 2)) then
      v_new := v_raw;
    elsif v_raw ~ '^[0-9]{7}[A-Z]{1,2}$' or v_raw ~ '^[0-9][A-Z][0-9]{5}[A-Z]$' then
      v_new := 'IE' || v_raw;
    end if;

    if v_row.source = 'customers' then
      if v_new is null then
        update public.customers
        set vat_number = null, address_needs_review = true
        where id = v_row.id;
      elsif v_new is distinct from v_row.vat_number then
        update public.customers set vat_number = v_new where id = v_row.id;
      end if;
    else
      if v_new is null then
        update public.suppliers
        set vat_number = null, address_needs_review = true
        where id = v_row.id;
      elsif v_new is distinct from v_row.vat_number then
        update public.suppliers set vat_number = v_new where id = v_row.id;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function private.enforce_home_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postal record;
  v_peppol record;
begin
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    raise exception 'Defaults cannot be moved to another organisation';
  end if;

  select * into v_postal
  from private.prepare_postal(
    new.address_line1, new.address_line2, new.address_line3,
    new.city, new.post_code, new.county, new.country_code
  );
  new.address_line1 := v_postal.line1;
  new.address_line2 := v_postal.line2;
  new.address_line3 := v_postal.line3;
  new.city := v_postal.city;
  new.post_code := v_postal.post_code;
  new.county := v_postal.county;
  new.country_code := v_postal.country_code;

  new.contact_name := nullif(btrim(new.contact_name), '');
  new.contact_email := nullif(btrim(new.contact_email), '');
  new.website := nullif(btrim(new.website), '');
  new.phone := nullif(btrim(new.phone), '');
  new.vat_number := private.prepare_vat_number(new.vat_number);
  new.company_number := private.prepare_company_number(new.company_number);
  select * into v_peppol from private.prepare_peppol(new.peppol_scheme, new.peppol_id);
  new.peppol_scheme := v_peppol.scheme;
  new.peppol_id := v_peppol.identifier;
  new.iban := private.prepare_iban(new.iban);
  new.bic := private.prepare_bic(new.bic);
  new.bank_account_name := nullif(btrim(new.bank_account_name), '');
  if new.bank_account_name is not null and char_length(new.bank_account_name) > 100 then
    raise exception 'Account name can be up to 100 characters';
  end if;
  new.banking_details := nullif(btrim(new.banking_details), '');
  new.logo_path := nullif(btrim(new.logo_path), '');
  return new;
end;
$$;

revoke all on function private.enforce_home_currency() from public, anon, authenticated;

create or replace function private.enforce_party_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  v_postal record;
  v_peppol record;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A record cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.name := btrim(new.name);
  new.phone := nullif(btrim(new.phone), '');
  new.email := nullif(btrim(new.email), '');
  new.website := nullif(btrim(new.website), '');
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');

  select * into v_postal
  from private.prepare_postal(
    new.address_line1, new.address_line2, new.address_line3,
    new.city, new.post_code, new.county, new.country_code
  );
  new.address_line1 := v_postal.line1;
  new.address_line2 := v_postal.line2;
  new.address_line3 := v_postal.line3;
  new.city := v_postal.city;
  new.post_code := v_postal.post_code;
  new.county := v_postal.county;
  new.country_code := v_postal.country_code;
  new.vat_number := private.prepare_vat_number(new.vat_number);
  new.company_number := private.prepare_company_number(new.company_number);
  select * into v_peppol from private.prepare_peppol(new.peppol_scheme, new.peppol_id);
  new.peppol_scheme := v_peppol.scheme;
  new.peppol_id := v_peppol.identifier;
  return new;
end;
$$;

revoke all on function private.enforce_party_scope() from public, anon, authenticated;

alter table public.organisation_defaults drop constraint organisation_defaults_address_check;
alter table public.organisation_defaults drop constraint organisation_defaults_vat_number_check;
alter table public.customers drop constraint customers_address_check;
alter table public.customers drop constraint customers_vat_number_check;
alter table public.suppliers drop constraint suppliers_address_check;
alter table public.suppliers drop constraint suppliers_vat_number_check;

alter table public.organisation_defaults drop column address;
alter table public.customers drop column address;
alter table public.suppliers drop column address;

alter table public.organisation_defaults
  add constraint organisation_defaults_address_line1_check check (address_line1 is null or char_length(address_line1) between 1 and 100),
  add constraint organisation_defaults_address_line2_check check (address_line2 is null or char_length(address_line2) between 1 and 100),
  add constraint organisation_defaults_address_line3_check check (address_line3 is null or char_length(address_line3) between 1 and 100),
  add constraint organisation_defaults_city_check check (city is null or char_length(city) between 1 and 60),
  add constraint organisation_defaults_post_code_check check (post_code is null or char_length(post_code) between 1 and 20),
  add constraint organisation_defaults_county_check check (county is null or char_length(county) between 1 and 60),
  add constraint organisation_defaults_vat_number_check check (vat_number is null or vat_number ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'),
  add constraint organisation_defaults_peppol_check check ((peppol_scheme is null and peppol_id is null) or (peppol_scheme is not null and peppol_id is not null)),
  add constraint organisation_defaults_peppol_id_check check (peppol_id is null or char_length(peppol_id) between 1 and 100),
  add constraint organisation_defaults_bank_account_name_check check (bank_account_name is null or char_length(bank_account_name) between 1 and 100),
  add constraint organisation_defaults_country_code_fkey foreign key (country_code) references public.ref_countries (code),
  add constraint organisation_defaults_peppol_scheme_fkey foreign key (peppol_scheme) references public.ref_eas (code);

alter table public.customers
  add constraint customers_address_line1_check check (address_line1 is null or char_length(address_line1) between 1 and 100),
  add constraint customers_address_line2_check check (address_line2 is null or char_length(address_line2) between 1 and 100),
  add constraint customers_address_line3_check check (address_line3 is null or char_length(address_line3) between 1 and 100),
  add constraint customers_city_check check (city is null or char_length(city) between 1 and 60),
  add constraint customers_post_code_check check (post_code is null or char_length(post_code) between 1 and 20),
  add constraint customers_county_check check (county is null or char_length(county) between 1 and 60),
  add constraint customers_vat_number_check check (vat_number is null or vat_number ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'),
  add constraint customers_company_number_check check (
    company_number is null or (
      char_length(company_number) between 1 and 40
      and company_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'
    )
  ),
  add constraint customers_peppol_check check ((peppol_scheme is null and peppol_id is null) or (peppol_scheme is not null and peppol_id is not null)),
  add constraint customers_peppol_id_check check (peppol_id is null or char_length(peppol_id) between 1 and 100),
  add constraint customers_country_code_fkey foreign key (country_code) references public.ref_countries (code),
  add constraint customers_peppol_scheme_fkey foreign key (peppol_scheme) references public.ref_eas (code);

alter table public.suppliers
  add constraint suppliers_address_line1_check check (address_line1 is null or char_length(address_line1) between 1 and 100),
  add constraint suppliers_address_line2_check check (address_line2 is null or char_length(address_line2) between 1 and 100),
  add constraint suppliers_address_line3_check check (address_line3 is null or char_length(address_line3) between 1 and 100),
  add constraint suppliers_city_check check (city is null or char_length(city) between 1 and 60),
  add constraint suppliers_post_code_check check (post_code is null or char_length(post_code) between 1 and 20),
  add constraint suppliers_county_check check (county is null or char_length(county) between 1 and 60),
  add constraint suppliers_vat_number_check check (vat_number is null or vat_number ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'),
  add constraint suppliers_company_number_check check (
    company_number is null or (
      char_length(company_number) between 1 and 40
      and company_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'
    )
  ),
  add constraint suppliers_peppol_check check ((peppol_scheme is null and peppol_id is null) or (peppol_scheme is not null and peppol_id is not null)),
  add constraint suppliers_peppol_id_check check (peppol_id is null or char_length(peppol_id) between 1 and 100),
  add constraint suppliers_country_code_fkey foreign key (country_code) references public.ref_countries (code),
  add constraint suppliers_peppol_scheme_fkey foreign key (peppol_scheme) references public.ref_eas (code);

create unique index customers_peppol_idx
  on public.customers (organisation_id, peppol_scheme, lower(peppol_id));

create unique index suppliers_peppol_idx
  on public.suppliers (organisation_id, peppol_scheme, lower(peppol_id));

comment on column public.organisation_defaults.address_line1 is 'EN 16931 BT-35 Seller address line 1';
comment on column public.organisation_defaults.address_line2 is 'EN 16931 BT-36 Seller address line 2';
comment on column public.organisation_defaults.address_line3 is 'EN 16931 BT-162 Seller address line 3';
comment on column public.organisation_defaults.city is 'EN 16931 BT-37 Seller city';
comment on column public.organisation_defaults.post_code is 'EN 16931 BT-38 Seller post code';
comment on column public.organisation_defaults.county is 'EN 16931 BT-39 Seller country subdivision';
comment on column public.organisation_defaults.country_code is 'EN 16931 BT-40 Seller country code';
comment on column public.organisation_defaults.vat_number is 'EN 16931 BT-31 Seller VAT identifier';
comment on column public.organisation_defaults.company_number is 'EN 16931 BT-30 Seller legal registration identifier';
comment on column public.organisation_defaults.peppol_scheme is 'EN 16931 BT-34 Seller electronic address scheme';
comment on column public.organisation_defaults.peppol_id is 'EN 16931 BT-34 Seller electronic address';
comment on column public.organisation_defaults.iban is 'EN 16931 BT-84 Payment account identifier';
comment on column public.organisation_defaults.bic is 'EN 16931 BT-86 Payment service provider identifier';
comment on column public.organisation_defaults.bank_account_name is 'EN 16931 BT-85 Payment account name';

comment on column public.customers.address_line1 is 'EN 16931 BT-50 Buyer address line 1';
comment on column public.customers.address_line2 is 'EN 16931 BT-51 Buyer address line 2';
comment on column public.customers.address_line3 is 'EN 16931 BT-163 Buyer address line 3';
comment on column public.customers.city is 'EN 16931 BT-52 Buyer city';
comment on column public.customers.post_code is 'EN 16931 BT-53 Buyer post code';
comment on column public.customers.county is 'EN 16931 BT-54 Buyer country subdivision';
comment on column public.customers.country_code is 'EN 16931 BT-55 Buyer country code';
comment on column public.customers.vat_number is 'EN 16931 BT-48 Buyer VAT identifier';
comment on column public.customers.company_number is 'EN 16931 BT-47 Buyer legal registration identifier';
comment on column public.customers.peppol_scheme is 'EN 16931 BT-49 Buyer electronic address scheme';
comment on column public.customers.peppol_id is 'EN 16931 BT-49 Buyer electronic address';

comment on column public.suppliers.address_line1 is 'EN 16931 BT-35 Seller address line 1';
comment on column public.suppliers.address_line2 is 'EN 16931 BT-36 Seller address line 2';
comment on column public.suppliers.address_line3 is 'EN 16931 BT-162 Seller address line 3';
comment on column public.suppliers.city is 'EN 16931 BT-37 Seller city';
comment on column public.suppliers.post_code is 'EN 16931 BT-38 Seller post code';
comment on column public.suppliers.county is 'EN 16931 BT-39 Seller country subdivision';
comment on column public.suppliers.country_code is 'EN 16931 BT-40 Seller country code';
comment on column public.suppliers.vat_number is 'EN 16931 BT-31 Seller VAT identifier';
comment on column public.suppliers.company_number is 'EN 16931 BT-30 Seller legal registration identifier';
comment on column public.suppliers.peppol_scheme is 'EN 16931 BT-34 Seller electronic address scheme';
comment on column public.suppliers.peppol_id is 'EN 16931 BT-34 Seller electronic address';

alter table public.currencies add column iso_code text;

update public.currencies as currency
set iso_code = ref.code
from public.ref_currencies as ref
where currency.code = ref.code;

do $$
declare
  v_bad text;
begin
  select string_agg(distinct code, ', ' order by code)
    into v_bad
  from public.currencies
  where iso_code is null;

  if v_bad is not null then
    raise exception 'These currency codes are not ISO 4217 codes: %', v_bad;
  end if;
end;
$$;

alter table public.currencies alter column iso_code set not null;
alter table public.currencies
  add constraint currencies_iso_code_check check (iso_code ~ '^[A-Z]{3}$'),
  add constraint currencies_iso_code_fkey foreign key (iso_code) references public.ref_currencies (code),
  add constraint currencies_organisation_iso_code_key unique (organisation_id, iso_code);

comment on column public.currencies.iso_code is 'ISO 4217 currency code, EN 16931 BT-5 invoice currency and BT-6 VAT accounting currency';

create or replace function private.enforce_currency_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  v_iso text;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A currency cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.name := btrim(new.name);
  v_iso := upper(btrim(coalesce(new.iso_code, '')));
  if v_iso = '' then
    v_iso := new.code;
  end if;
  if not exists (select 1 from public.ref_currencies where code = v_iso) then
    raise exception 'Choose an ISO currency code';
  end if;
  new.iso_code := v_iso;
  return new;
end;
$$;

revoke all on function private.enforce_currency_scope() from public, anon, authenticated;

create or replace function public.post_document(p_header_id uuid, p_logo_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_supplier uuid;
  v_type uuid;
  v_reference integer;
  v_numbering public.numbering_rule;
  v_lines integer;
  v_issuer jsonb;
  v_party jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date, supplier_id, transaction_type_id, reference
    into v_org, v_status, v_date, v_supplier, v_type, v_reference
  from public.transaction_headers
  where id = p_header_id
  for update;

  if v_org is null then
    raise exception 'That document could not be posted';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft document can be posted';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;
  if p_logo_path is not null
     and p_logo_path is distinct from v_org::text || '/snapshots/' || p_header_id::text then
    raise exception 'The posted logo path is not valid';
  end if;

  select count(*) into v_lines
  from public.transaction_lines
  where header_id = p_header_id;

  if v_lines < 1 then
    raise exception 'Add a line before posting';
  end if;

  select numbering into v_numbering
  from public.transaction_types
  where id = v_type;

  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  select jsonb_build_object(
    'name', organisation.name,
    'address', private.postal_address_text(
      defaults.address_line1, defaults.address_line2, defaults.address_line3,
      defaults.city, defaults.post_code, defaults.county, seller_country.name
    ),
    'contactName', defaults.contact_name,
    'contactEmail', defaults.contact_email,
    'website', defaults.website,
    'phone', defaults.phone,
    'vatNumber', defaults.vat_number,
    'companyNumber', defaults.company_number,
    'bankingDetails', defaults.banking_details,
    'logoPath', p_logo_path
  )
  into v_issuer
  from public.organisations as organisation
  left join public.organisation_defaults as defaults
    on defaults.organisation_id = organisation.id
  left join public.ref_countries as seller_country
    on seller_country.code = defaults.country_code
  where organisation.id = v_org;

  select jsonb_build_object(
    'code', supplier.code,
    'name', supplier.name,
    'address', private.postal_address_text(
      supplier.address_line1, supplier.address_line2, supplier.address_line3,
      supplier.city, supplier.post_code, supplier.county, party_country.name
    ),
    'phone', supplier.phone,
    'email', supplier.email,
    'website', supplier.website,
    'contactDetails', supplier.contact_details,
    'vatNumber', supplier.vat_number
  )
  into v_party
  from public.suppliers as supplier
  left join public.ref_countries as party_country
    on party_country.code = supplier.country_code
  where supplier.id = v_supplier;

  perform set_config('fintran.status_change', 'on', true);
  if v_numbering = 'on_post' then
    update public.transaction_headers
    set reference = v_reference
    where id = p_header_id;
    update public.transaction_lines
    set reference = v_reference
    where header_id = p_header_id;
  end if;
  update public.transaction_headers
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      issuer_snapshot = v_issuer,
      party_snapshot = v_party,
      reference = v_reference
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

revoke all on function public.post_document(uuid, text) from public, anon;
grant execute on function public.post_document(uuid, text) to authenticated;
