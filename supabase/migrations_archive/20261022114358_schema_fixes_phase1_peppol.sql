-- Schema fixes phase 1. Peppol identifier format and global organisation uniqueness.

do $$
declare
  v_rows text;
begin
  select string_agg(format('%s %s', peppol_scheme, lower(peppol_id)), ', ' order by peppol_scheme, lower(peppol_id))
    into v_rows
  from (
    select peppol_scheme, lower(peppol_id) as peppol_id
    from public.organisation_defaults
    where peppol_id is not null
    group by peppol_scheme, lower(peppol_id)
    having count(*) > 1
  ) as duplicates;
  if v_rows is not null then
    raise exception 'Organisation Peppol IDs are already duplicated: %', v_rows;
  end if;

  select string_agg(format('%s %s', peppol_scheme, peppol_id), ', ')
    into v_rows
  from (
    select peppol_scheme, peppol_id from public.organisation_defaults
    where peppol_id is not null and peppol_id !~ '^[A-Za-z0-9._:-]{1,100}$'
    union all
    select peppol_scheme, peppol_id from public.customers
    where peppol_id is not null and peppol_id !~ '^[A-Za-z0-9._:-]{1,100}$'
    union all
    select peppol_scheme, peppol_id from public.suppliers
    where peppol_id is not null and peppol_id !~ '^[A-Za-z0-9._:-]{1,100}$'
  ) as invalid;
  if v_rows is not null then
    raise exception 'Existing Peppol IDs do not match the allowed format: %', v_rows;
  end if;
end;
$$;

alter table public.ref_eas
  add column value_pattern text;

alter table public.ref_eas
  add constraint ref_eas_value_pattern_check
  check (value_pattern is null or char_length(value_pattern) between 1 and 200);

update public.ref_eas set value_pattern = '^[0-9]{13}$' where code = '0088';
update public.ref_eas set value_pattern = '^[0-9]{9}$' where code = '0060';

alter table public.organisation_defaults drop constraint organisation_defaults_peppol_id_check;
alter table public.customers drop constraint customers_peppol_id_check;
alter table public.suppliers drop constraint suppliers_peppol_id_check;

alter table public.organisation_defaults
  add constraint organisation_defaults_peppol_id_check
  check (peppol_id is null or peppol_id ~ '^[A-Za-z0-9._:-]{1,100}$');

alter table public.customers
  add constraint customers_peppol_id_check
  check (peppol_id is null or peppol_id ~ '^[A-Za-z0-9._:-]{1,100}$');

alter table public.suppliers
  add constraint suppliers_peppol_id_check
  check (peppol_id is null or peppol_id ~ '^[A-Za-z0-9._:-]{1,100}$');

create unique index organisation_defaults_peppol_unique
  on public.organisation_defaults (peppol_scheme, lower(peppol_id))
  where peppol_id is not null;

create or replace function private.prepare_peppol(p_scheme text, p_id text)
returns table (scheme text, identifier text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pattern text;
begin
  scheme := nullif(btrim(coalesce(p_scheme, '')), '');
  identifier := nullif(btrim(coalesce(p_id, '')), '');
  if (scheme is null) <> (identifier is null) then
    raise exception 'Enter both the Peppol scheme and the Peppol ID, or leave both blank';
  end if;
  if identifier is not null and identifier !~ '^[A-Za-z0-9._:-]{1,100}$' then
    raise exception 'Peppol ID can be up to 100 letters, digits, or . - _ : and cannot contain spaces';
  end if;
  if scheme is not null then
    select value_pattern into v_pattern
    from public.ref_eas
    where code = scheme;
    if not found then
      raise exception 'Choose a Peppol scheme';
    end if;
    if v_pattern is not null and identifier !~ v_pattern then
      raise exception 'This Peppol ID does not match the format for scheme %.', scheme;
    end if;
  end if;
  return next;
end;
$$;

revoke all on function private.prepare_peppol(text, text) from public, anon, authenticated;

create or replace function private.guard_organisation_peppol()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.peppol_id is not null and exists (
    select 1
    from public.organisation_defaults as other
    where other.organisation_id is distinct from new.organisation_id
      and other.peppol_scheme = new.peppol_scheme
      and lower(other.peppol_id) = lower(new.peppol_id)
  ) then
    raise exception 'This Peppol ID is already registered to another organisation.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_organisation_peppol() from public, anon, authenticated;

create trigger organisation_defaults_peppol_unique
  before insert or update on public.organisation_defaults
  for each row execute function private.guard_organisation_peppol();
