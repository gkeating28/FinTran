alter table public.organisation_defaults
  add column logo_path text;

alter table public.organisation_defaults
  add constraint organisation_defaults_logo_path_check check (
    logo_path is null or logo_path = organisation_id::text || '/logo'
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
  new.logo_path := nullif(btrim(new.logo_path), '');
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.enforce_home_currency() from public, anon, authenticated;

create or replace function private.organisation_logo_allowed(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organisation uuid;
begin
  if object_name is null
     or object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo$' then
    return false;
  end if;

  organisation := split_part(object_name, '/', 1)::uuid;
  return private.is_org_member(organisation);
end;
$$;

revoke all on function private.organisation_logo_allowed(text) from public, anon;
grant execute on function private.organisation_logo_allowed(text) to authenticated, supabase_storage_admin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organisation-logos',
  'organisation-logos',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
);

create policy organisation_logos_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_allowed(name)
  );

create policy organisation_logos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_allowed(name)
  );

create policy organisation_logos_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_allowed(name)
  )
  with check (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_allowed(name)
  );

create policy organisation_logos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'organisation-logos'
    and private.organisation_logo_allowed(name)
  );
