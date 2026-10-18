-- Phase 1 acceptance tests. Raises on failure. Rolls back all rows it creates.
begin;

create temp table phase1_users (
  who text primary key,
  id uuid not null
);

insert into phase1_users (who, id)
values
  ('owner', '11111111-1111-4111-8111-111111111111'),
  ('member', '22222222-2222-4222-8222-222222222222'),
  ('admin', '33333333-3333-4333-8333-333333333333'),
  ('outsider', '44444444-4444-4444-8444-444444444444'),
  ('otheradmin', '55555555-5555-4555-8555-555555555555');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select
  id,
  who || '-phase1@fintran.test',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', who)
from phase1_users;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from phase1_users where who = 'owner'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select set_config(
  'test.org1',
  (public.create_tenant('Phase One Books', 'Phase One Office'))->>'organisation_id',
  true
);

select public.grant_organisation_access(
  current_setting('test.org1')::uuid,
  'member-phase1@fintran.test',
  'member'
);
select public.grant_organisation_access(
  current_setting('test.org1')::uuid,
  'admin-phase1@fintran.test',
  'admin'
);

reset role;

select set_config(
  'test.created_at',
  (select created_at::text from public.organisation_defaults where organisation_id = current_setting('test.org1')::uuid),
  true
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from phase1_users where who = 'member'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

update public.organisation_defaults
set banking_details = 'Sort code 11-22-33'
where organisation_id = current_setting('test.org1')::uuid;

do $$
declare
  seen integer;
begin
  select count(*) into seen
  from public.audit_log
  where organisation_id = current_setting('test.org1')::uuid;

  if seen <> 0 then
    raise exception 'phase 1: a member can select audit_log (% rows)', seen;
  end if;
end;
$$;

do $$
begin
  insert into public.audit_log (tenant_id, table_name, row_id, action)
  values ('11111111-1111-4111-8111-111111111111', 'organisation_defaults', 'x', 'INSERT');
  raise exception 'phase 1: a direct insert into audit_log was allowed';
exception
  when insufficient_privilege then
    null;
end;
$$;

do $$
begin
  update public.audit_log set action = 'DELETE' where false;
  raise exception 'phase 1: a direct update of audit_log was allowed';
exception
  when insufficient_privilege then
    null;
end;
$$;

do $$
begin
  delete from public.audit_log where false;
  raise exception 'phase 1: a direct delete of audit_log was allowed';
exception
  when insufficient_privilege then
    null;
end;
$$;

reset role;

do $$
declare
  v_created_by uuid;
  v_updated_by uuid;
  v_created_at timestamptz;
  v_count integer;
  v_old jsonb;
  v_new jsonb;
  missing text;
begin
  select created_by, updated_by, created_at
    into v_created_by, v_updated_by, v_created_at
  from public.organisation_defaults
  where organisation_id = current_setting('test.org1')::uuid;

  if v_created_by is distinct from (select id from phase1_users where who = 'owner') then
    raise exception 'phase 1: created_by is %, expected the owner', v_created_by;
  end if;
  if v_updated_by is distinct from (select id from phase1_users where who = 'member') then
    raise exception 'phase 1: updated_by is %, expected the member', v_updated_by;
  end if;
  if v_created_at is distinct from current_setting('test.created_at')::timestamptz then
    raise exception 'phase 1: created_at changed from % to %', current_setting('test.created_at'), v_created_at;
  end if;

  select count(*) into v_count
  from public.audit_log
  where organisation_id = current_setting('test.org1')::uuid
    and table_name = 'organisation_defaults'
    and action = 'UPDATE';

  select old_values, new_values into v_old, v_new
  from public.audit_log
  where organisation_id = current_setting('test.org1')::uuid
    and table_name = 'organisation_defaults'
    and action = 'UPDATE'
  limit 1;

  if v_count <> 1 then
    raise exception 'phase 1: expected one defaults update in audit_log, got %', v_count;
  end if;
  if v_new ->> 'banking_details' is distinct from 'Sort code 11-22-33' then
    raise exception 'phase 1: new banking value missing from %', v_new;
  end if;
  if v_old -> 'banking_details' is distinct from 'null'::jsonb then
    raise exception 'phase 1: old banking value was not null in %', v_old;
  end if;

  select string_agg(relname, ', ') into missing
  from (
    select relname
    from unnest(array[
      'tenants', 'organisations', 'organisation_access', 'organisation_defaults',
      'gl_codes', 'departments', 'cost_centres', 'vat_rates', 'currencies',
      'customers', 'suppliers', 'transaction_types', 'products',
      'transaction_headers', 'transaction_lines', 'transaction_forms'
    ]) as relname
    where (
      select count(*)
      from information_schema.columns
      where table_schema = 'public'
        and table_name = relname
        and column_name in ('created_at', 'created_by', 'updated_at', 'updated_by')
    ) < 4
  ) gaps;

  if missing is not null then
    raise exception 'phase 1: audit columns missing on %', missing;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where split_part(cfg, '=', 1) = 'search_path'
          and btrim(substr(cfg, length('search_path=') + 1), '"') = ''
      )
  ) then
    raise exception 'phase 1: a security definer function has no empty search_path';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'phase 1: anon can execute a project function';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from phase1_users where who = 'admin'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  seen integer;
begin
  select count(*) into seen
  from public.audit_log
  where organisation_id = current_setting('test.org1')::uuid
    and table_name = 'organisation_defaults'
    and action = 'UPDATE';

  if seen <> 1 then
    raise exception 'phase 1: an admin cannot see the audit row (% rows)', seen;
  end if;
end;
$$;

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from phase1_users where who = 'outsider'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select set_config(
  'test.org2',
  (public.create_tenant('Phase One Other', 'Phase One Elsewhere'))->>'organisation_id',
  true
);

select public.grant_organisation_access(
  current_setting('test.org2')::uuid,
  'otheradmin-phase1@fintran.test',
  'admin'
);

reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from phase1_users where who = 'otheradmin'), 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  seen integer;
begin
  select count(*) into seen
  from public.audit_log
  where organisation_id = current_setting('test.org1')::uuid;

  if seen <> 0 then
    raise exception 'phase 1: an admin of another organisation can see audit_log (% rows)', seen;
  end if;
end;
$$;

reset role;

select 'phase 1 ok' as result;

rollback;
