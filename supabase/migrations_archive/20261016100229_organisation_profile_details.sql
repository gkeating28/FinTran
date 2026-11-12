alter table public.organisation_defaults
  add column address text,
  add column contact_name text,
  add column contact_email text,
  add column website text,
  add column phone text,
  add column vat_number text,
  add column company_number text,
  add column banking_details text;

alter table public.organisation_defaults
  add constraint organisation_defaults_address_check check (
    address is null or char_length(address) between 1 and 500
  ),
  add constraint organisation_defaults_contact_name_check check (
    contact_name is null or char_length(contact_name) between 1 and 200
  ),
  add constraint organisation_defaults_contact_email_check check (
    contact_email is null or (
      char_length(contact_email) <= 200
      and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  add constraint organisation_defaults_website_check check (
    website is null or (char_length(website) between 1 and 200 and website !~ '[[:space:]]')
  ),
  add constraint organisation_defaults_phone_check check (
    phone is null or (char_length(phone) between 1 and 40 and phone ~ '^[0-9+(). -]+$')
  ),
  add constraint organisation_defaults_vat_number_check check (
    vat_number is null or (
      char_length(vat_number) between 1 and 40
      and vat_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'
    )
  ),
  add constraint organisation_defaults_company_number_check check (
    company_number is null or (
      char_length(company_number) between 1 and 40
      and company_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*$'
    )
  ),
  add constraint organisation_defaults_banking_details_check check (
    banking_details is null or char_length(banking_details) between 1 and 1000
  );

create or replace function private.enforce_home_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  currency_org uuid;
begin
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    raise exception 'Defaults cannot be moved to another organisation';
  end if;

  if new.home_currency_id is not null then
    select organisation_id into currency_org
    from public.currencies
    where id = new.home_currency_id;

    if currency_org is null or currency_org is distinct from new.organisation_id then
      raise exception 'Home currency must belong to this organisation';
    end if;
  end if;

  new.address := nullif(btrim(new.address), '');
  new.contact_name := nullif(btrim(new.contact_name), '');
  new.contact_email := nullif(btrim(new.contact_email), '');
  new.website := nullif(btrim(new.website), '');
  new.phone := nullif(btrim(new.phone), '');
  new.vat_number := nullif(btrim(new.vat_number), '');
  new.company_number := nullif(btrim(new.company_number), '');
  new.banking_details := nullif(btrim(new.banking_details), '');
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.enforce_home_currency() from public, anon, authenticated;
