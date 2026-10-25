-- Schema fixes phase 5. Every organisation is created with a home currency.

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

  if exists (
    select 1
    from public.organisation_defaults
    where home_currency_id = new.id
  ) and new.rate is distinct from 1 then
    raise exception 'The home currency rate must stay at 1';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_currency_scope() from public, anon, authenticated;

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

  if new.home_currency_id is null then
    raise exception 'Choose a home currency';
  end if;

  if tg_op = 'UPDATE' and new.home_currency_id is distinct from old.home_currency_id then
    if exists (
      select 1
      from public.transaction_headers
      where organisation_id = new.organisation_id
    ) then
      raise exception 'The home currency cannot be changed once documents exist.';
    end if;
  end if;

  update public.currencies
  set rate = 1
  where id = new.home_currency_id
    and organisation_id = new.organisation_id
    and rate is distinct from 1;

  if not found and not exists (
    select 1
    from public.currencies
    where id = new.home_currency_id
      and organisation_id = new.organisation_id
  ) then
    raise exception 'Home currency must belong to this organisation';
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

create or replace function private.create_organisation_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(nullif(current_setting('fintran.home_currency', true), ''), 'EUR')));
  v_name text;
  v_currency uuid;
begin
  select name into v_name
  from public.ref_currencies
  where code = v_code
    and active;
  if v_name is null then
    raise exception 'Choose an active ISO currency';
  end if;

  insert into public.currencies (tenant_id, organisation_id, code, name, rate, iso_code)
  values (new.tenant_id, new.id, v_code, v_name, 1, v_code)
  returning id into v_currency;

  insert into public.organisation_defaults (organisation_id, tenant_id, home_currency_id)
  values (new.id, new.tenant_id, v_currency);
  return new;
end;
$$;

revoke all on function private.create_organisation_defaults() from public, anon, authenticated;

do $$
declare
  v_rows text;
begin
  select string_agg(id::text, ', ')
    into v_rows
  from public.organisations as organisation
  where not exists (
    select 1
    from public.organisation_defaults as defaults
    where defaults.organisation_id = organisation.id
      and defaults.home_currency_id is not null
  );
  if v_rows is not null then
    raise exception 'These organisations have no home currency: %', v_rows;
  end if;
end;
$$;

alter table public.organisation_defaults
  alter column home_currency_id set not null;

drop function public.create_tenant(text, text);
drop function public.create_organisation(uuid, text);

create function public.create_tenant(
  tenant_name text,
  organisation_name text,
  p_home_currency text default 'EUR'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  tenant_id uuid;
  organisation_id uuid;
  tenant_slug text;
  organisation_slug text;
  attempt integer := 0;
  v_code text := upper(btrim(coalesce(p_home_currency, '')));
begin
  if uid is null then
    raise exception 'Sign in before creating a tenant';
  end if;
  if char_length(btrim(tenant_name)) < 2 or char_length(btrim(organisation_name)) < 2 then
    raise exception 'Names need at least 2 characters';
  end if;
  if not exists (
    select 1 from public.ref_currencies where code = v_code and active
  ) then
    raise exception 'Choose an active ISO currency';
  end if;

  tenant_slug := private.slugify(tenant_name);
  organisation_slug := private.slugify(organisation_name);
  if tenant_slug = '' or organisation_slug = '' then
    raise exception 'Names need at least one letter or number';
  end if;

  while exists (select 1 from public.tenants where slug = tenant_slug) loop
    attempt := attempt + 1;
    if attempt > 5 then
      raise exception 'Could not reserve a unique tenant name';
    end if;
    tenant_slug := private.slugify(tenant_name) || '-' || substr(extensions.gen_random_uuid()::text, 1, 4);
  end loop;

  perform set_config('fintran.home_currency', v_code, true);

  insert into public.tenants (name, slug)
  values (btrim(tenant_name), tenant_slug)
  returning id into tenant_id;

  insert into public.organisations (tenant_id, name, slug)
  values (tenant_id, btrim(organisation_name), organisation_slug)
  returning id into organisation_id;

  insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
  values (tenant_id, organisation_id, uid, 'owner');

  return jsonb_build_object('tenant_id', tenant_id, 'organisation_id', organisation_id);
end;
$$;

revoke all on function public.create_tenant(text, text, text) from public, anon;
grant execute on function public.create_tenant(text, text, text) to authenticated;

create function public.create_organisation(
  p_tenant_id uuid,
  organisation_name text,
  p_home_currency text default 'EUR'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  organisation_id uuid;
  organisation_slug text;
  attempt integer := 0;
  v_code text := upper(btrim(coalesce(p_home_currency, '')));
begin
  if uid is null then
    raise exception 'Sign in before creating an organisation';
  end if;
  if not (select private.can_manage_tenant(p_tenant_id)) then
    raise exception 'You need an owner role in this tenant';
  end if;
  if char_length(btrim(organisation_name)) < 2 then
    raise exception 'Name needs at least 2 characters';
  end if;
  if not exists (
    select 1 from public.ref_currencies where code = v_code and active
  ) then
    raise exception 'Choose an active ISO currency';
  end if;

  organisation_slug := private.slugify(organisation_name);
  if organisation_slug = '' then
    raise exception 'Name needs at least one letter or number';
  end if;

  while exists (
    select 1 from public.organisations
    where tenant_id = p_tenant_id and slug = organisation_slug
  ) loop
    attempt := attempt + 1;
    if attempt > 5 then
      raise exception 'Could not reserve a unique organisation name';
    end if;
    organisation_slug := private.slugify(organisation_name) || '-' || substr(extensions.gen_random_uuid()::text, 1, 4);
  end loop;

  perform set_config('fintran.home_currency', v_code, true);

  insert into public.organisations (tenant_id, name, slug)
  values (p_tenant_id, btrim(organisation_name), organisation_slug)
  returning id into organisation_id;

  insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
  values (p_tenant_id, organisation_id, uid, 'owner');

  return organisation_id;
end;
$$;

revoke all on function public.create_organisation(uuid, text, text) from public, anon;
grant execute on function public.create_organisation(uuid, text, text) to authenticated;
