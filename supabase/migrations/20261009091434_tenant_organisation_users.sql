-- Tenant, organisation, and per-organisation user access.
-- Organisations belong to one tenant. A user can access specific organisations inside that tenant.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create index organisations_tenant_id_idx on public.organisations (tenant_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create unique index profiles_email_lower_idx on public.profiles (lower(email));

create table public.organisation_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create index organisation_access_user_id_idx on public.organisation_access (user_id);
create index organisation_access_tenant_id_idx on public.organisation_access (tenant_id);

create or replace function private.slugify(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(btrim(input)), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function private.enforce_organisation_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.organisations
    where id = new.organisation_id
      and tenant_id = new.tenant_id
  ) then
    raise exception 'Organisation does not belong to this tenant';
  end if;
  return new;
end;
$$;

create trigger organisation_access_tenant_match
  before insert or update on public.organisation_access
  for each row execute function private.enforce_organisation_tenant();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(coalesce(new.email, 'user'), '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_access
    where organisation_id = org
      and user_id = (select auth.uid())
  );
$$;

create or replace function private.org_role(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.organisation_access
  where organisation_id = org
    and user_id = (select auth.uid())
  limit 1;
$$;

create or replace function private.is_tenant_manager(tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_access
    where tenant_id = tenant
      and user_id = (select auth.uid())
      and role in ('owner', 'admin')
  );
$$;

create or replace function private.shares_organisation(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_access mine
    join public.organisation_access theirs
      on theirs.organisation_id = mine.organisation_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other
  );
$$;

revoke all on function private.slugify(text) from public, anon, authenticated;
revoke all on function private.enforce_organisation_tenant() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.org_role(uuid) to authenticated;
grant execute on function private.is_tenant_manager(uuid) to authenticated;
grant execute on function private.shares_organisation(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.organisations enable row level security;
alter table public.profiles enable row level security;
alter table public.organisation_access enable row level security;

create policy tenants_select_member on public.tenants
  for select to authenticated
  using (
    exists (
      select 1
      from public.organisation_access access
      where access.tenant_id = tenants.id
        and access.user_id = (select auth.uid())
    )
  );

create policy organisations_select_member on public.organisations
  for select to authenticated
  using ((select private.is_org_member(id)));

create policy profiles_select_self_or_colleague on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.shares_organisation(id))
  );

create policy organisation_access_select_member on public.organisation_access
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_org_member(organisation_id))
  );

create or replace function public.create_tenant(tenant_name text, organisation_name text)
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
begin
  if uid is null then
    raise exception 'Sign in before creating a tenant';
  end if;
  if char_length(btrim(tenant_name)) < 2 or char_length(btrim(organisation_name)) < 2 then
    raise exception 'Names need at least 2 characters';
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

create or replace function public.create_organisation(p_tenant_id uuid, organisation_name text)
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
begin
  if uid is null then
    raise exception 'Sign in before creating an organisation';
  end if;
  if not (select private.is_tenant_manager(p_tenant_id)) then
    raise exception 'You need an owner or admin role in this tenant';
  end if;
  if char_length(btrim(organisation_name)) < 2 then
    raise exception 'Name needs at least 2 characters';
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

  insert into public.organisations (tenant_id, name, slug)
  values (p_tenant_id, btrim(organisation_name), organisation_slug)
  returning id into organisation_id;

  insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
  values (p_tenant_id, organisation_id, uid, 'owner');

  return organisation_id;
end;
$$;

create or replace function public.grant_organisation_access(
  p_organisation_id uuid,
  p_email text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  caller_role text;
  target_id uuid;
  target_tenant uuid;
begin
  if uid is null then
    raise exception 'Sign in before granting access';
  end if;
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Role must be owner, admin, or member';
  end if;

  caller_role := private.org_role(p_organisation_id);
  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'You need an owner or admin role in this organisation';
  end if;
  if p_role = 'owner' and caller_role <> 'owner' then
    raise exception 'Only an owner can grant the owner role';
  end if;

  select id into target_id
  from public.profiles
  where lower(email) = lower(btrim(p_email));

  if target_id is null then
    raise exception 'No signed-up user has that email yet';
  end if;

  select tenant_id into target_tenant
  from public.organisations
  where id = p_organisation_id;

  insert into public.organisation_access (tenant_id, organisation_id, user_id, role)
  values (target_tenant, p_organisation_id, target_id, p_role)
  on conflict (organisation_id, user_id) do update
    set role = excluded.role;
end;
$$;

create or replace function public.revoke_organisation_access(
  p_organisation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  target_role text;
  owner_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before changing access';
  end if;

  caller_role := private.org_role(p_organisation_id);
  if caller_role is null or caller_role not in ('owner', 'admin') then
    raise exception 'You need an owner or admin role in this organisation';
  end if;

  select role into target_role
  from public.organisation_access
  where organisation_id = p_organisation_id
    and user_id = p_user_id;

  if target_role is null then
    raise exception 'That user does not have access to this organisation';
  end if;
  if target_role = 'owner' and caller_role <> 'owner' then
    raise exception 'Only an owner can remove an owner';
  end if;

  if target_role = 'owner' then
    select count(*) into owner_count
    from public.organisation_access
    where organisation_id = p_organisation_id
      and role = 'owner';
    if owner_count <= 1 then
      raise exception 'An organisation needs at least one owner';
    end if;
  end if;

  delete from public.organisation_access
  where organisation_id = p_organisation_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.create_tenant(text, text) from public, anon;
revoke all on function public.create_organisation(uuid, text) from public, anon;
revoke all on function public.grant_organisation_access(uuid, text, text) from public, anon;
revoke all on function public.revoke_organisation_access(uuid, uuid) from public, anon;
grant execute on function public.create_tenant(text, text) to authenticated;
grant execute on function public.create_organisation(uuid, text) to authenticated;
grant execute on function public.grant_organisation_access(uuid, text, text) to authenticated;
grant execute on function public.revoke_organisation_access(uuid, uuid) to authenticated;
