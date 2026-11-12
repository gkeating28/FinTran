-- Phase 1: role helper, audit columns, audit log, and housekeeping.
-- Existing created_at values are left as they are. New updated_at columns
-- are backfilled with now(). created_by stays null on rows that already exist.

create or replace function private.has_org_role(p_organisation_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.org_role(p_organisation_id) = any (p_roles), false);
$$;

revoke all on function private.has_org_role(uuid, text[]) from public, anon;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.org_role(uuid) from public, anon;
revoke all on function private.is_tenant_manager(uuid) from public, anon;
revoke all on function private.shares_organisation(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.org_role(uuid) to authenticated;
grant execute on function private.is_tenant_manager(uuid) to authenticated;
grant execute on function private.shares_organisation(uuid) to authenticated;

create or replace function private.set_audit_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op is null then
    raise exception 'Audit columns are set by a trigger';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.updated_at := now();
    new.updated_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

revoke all on function private.set_audit_columns() from public, anon, authenticated;

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
  return new;
end;
$$;

revoke all on function private.enforce_home_currency() from public, anon, authenticated;

create or replace function private.enforce_transaction_form()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_org uuid;
  type_tenant uuid;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A form cannot be moved to another transaction type';
  end if;

  select organisation_id, tenant_id into type_org, type_tenant
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_org is null
     or type_org is distinct from new.organisation_id
     or type_tenant is distinct from new.tenant_id then
    raise exception 'Transaction type must belong to this organisation';
  end if;

  if jsonb_typeof(new.layout) is distinct from 'object' or char_length(new.layout::text) > 8000 then
    raise exception 'Form layout must be an object';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_form() from public, anon, authenticated;

do $$
declare
  business_table text;
  business_tables text[] := array[
    'tenants',
    'organisations',
    'organisation_access',
    'organisation_defaults',
    'gl_codes',
    'departments',
    'cost_centres',
    'vat_rates',
    'currencies',
    'customers',
    'suppliers',
    'transaction_types',
    'products',
    'transaction_headers',
    'transaction_lines',
    'transaction_forms'
  ];
begin
  foreach business_table in array business_tables loop
    if not exists (
      select 1
      from pg_attribute
      where attrelid = format('public.%I', business_table)::regclass
        and attname = 'updated_at'
        and not attisdropped
    ) then
      execute format(
        'alter table public.%I add column updated_at timestamptz not null default now()',
        business_table
      );
    end if;

    execute format(
      'alter table public.%I add column created_by uuid default auth.uid() references public.profiles (id) on delete set null',
      business_table
    );
    execute format(
      'alter table public.%I add column updated_by uuid references public.profiles (id) on delete set null',
      business_table
    );
    execute format(
      'create index %I on public.%I (created_by)',
      business_table || '_created_by_idx',
      business_table
    );
    execute format(
      'create index %I on public.%I (updated_by)',
      business_table || '_updated_by_idx',
      business_table
    );
    execute format(
      'create trigger zz_set_audit_columns before insert or update on public.%I for each row execute function private.set_audit_columns()',
      business_table
    );
  end loop;
end;
$$;

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  organisation_id uuid,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_values jsonb,
  new_values jsonb
);

create index audit_log_organisation_changed_at_idx
  on public.audit_log (organisation_id, changed_at desc);

create index audit_log_table_row_idx
  on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select private.has_org_role(organisation_id, array['owner', 'admin'])));

revoke all on table public.audit_log from public, anon, authenticated;
grant select on table public.audit_log to authenticated;

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_diff_old jsonb := '{}'::jsonb;
  v_diff_new jsonb := '{}'::jsonb;
  v_key text;
  v_ignore text[] := array['created_at', 'created_by', 'updated_at', 'updated_by'];
  v_row_id text;
  v_tenant uuid;
  v_organisation uuid;
begin
  if tg_op is null then
    raise exception 'The audit log is written by a trigger';
  end if;

  if tg_table_name = 'transaction_headers' then
    v_ignore := v_ignore || array[
      'foreign_nett_amount',
      'foreign_vat_amount',
      'foreign_total_amount',
      'home_nett_amount',
      'home_vat_amount',
      'home_total_amount'
    ];
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  v_row_id := coalesce(v_row ->> 'id', v_row ->> 'organisation_id');
  v_tenant := (v_row ->> 'tenant_id')::uuid;
  v_organisation := nullif(v_row ->> 'organisation_id', '')::uuid;

  if tg_op = 'INSERT' then
    insert into public.audit_log (
      tenant_id, organisation_id, table_name, row_id, action, changed_by, new_values
    )
    values (
      v_tenant, v_organisation, tg_table_name, v_row_id, 'INSERT', auth.uid(), to_jsonb(new) - v_ignore
    );
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (
      tenant_id, organisation_id, table_name, row_id, action, changed_by, old_values
    )
    values (
      v_tenant, v_organisation, tg_table_name, v_row_id, 'DELETE', auth.uid(), to_jsonb(old) - v_ignore
    );
  else
    v_old := to_jsonb(old) - v_ignore;
    v_new := to_jsonb(new) - v_ignore;
    for v_key in
      select key
      from (
        select jsonb_object_keys(v_old) as key
        union
        select jsonb_object_keys(v_new)
      ) keys
    loop
      if v_old -> v_key is distinct from v_new -> v_key then
        v_diff_old := v_diff_old || jsonb_build_object(v_key, v_old -> v_key);
        v_diff_new := v_diff_new || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;

    if v_diff_old = '{}'::jsonb then
      return null;
    end if;

    insert into public.audit_log (
      tenant_id, organisation_id, table_name, row_id, action, changed_by, old_values, new_values
    )
    values (
      v_tenant, v_organisation, tg_table_name, v_row_id, 'UPDATE', auth.uid(), v_diff_old, v_diff_new
    );
  end if;

  return null;
end;
$$;

revoke all on function private.write_audit_log() from public, anon, authenticated;

do $$
declare
  audited_table text;
  audited_tables text[] := array[
    'organisation_defaults',
    'organisation_access',
    'suppliers',
    'customers',
    'vat_rates',
    'gl_codes',
    'currencies',
    'transaction_types',
    'transaction_headers'
  ];
begin
  foreach audited_table in array audited_tables loop
    execute format(
      'create trigger zz_write_audit_log after insert or update or delete on public.%I for each row execute function private.write_audit_log()',
      audited_table
    );
  end loop;
end;
$$;

drop index if exists public.organisation_access_user_id_idx;

create index organisation_access_user_id_organisation_id_idx
  on public.organisation_access (user_id, organisation_id);

create index transaction_lines_organisation_id_idx
  on public.transaction_lines (organisation_id);

create index transaction_lines_transaction_type_id_idx
  on public.transaction_lines (transaction_type_id);
