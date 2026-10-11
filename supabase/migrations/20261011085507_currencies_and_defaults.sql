create or replace function private.enforce_currency_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
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
  return new;
end;
$$;

revoke all on function private.enforce_currency_scope() from public, anon, authenticated;

create table public.currencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  name text not null,
  rate numeric(16, 8) not null,
  created_at timestamptz not null default now(),
  constraint currencies_code_check check (code ~ '^[A-Z0-9]{1,20}$'),
  constraint currencies_name_check check (char_length(name) between 1 and 80),
  constraint currencies_rate_check check (rate > 0 and rate < 100000000),
  unique (organisation_id, code)
);

create index currencies_tenant_id_idx on public.currencies (tenant_id);

create trigger currencies_scope
  before insert or update on public.currencies
  for each row execute function private.enforce_currency_scope();

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

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.enforce_home_currency() from public, anon, authenticated;

create table public.organisation_defaults (
  organisation_id uuid primary key references public.organisations (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  home_currency_id uuid references public.currencies (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organisation_defaults_tenant_id_idx on public.organisation_defaults (tenant_id);
create index organisation_defaults_home_currency_id_idx on public.organisation_defaults (home_currency_id);

create trigger organisation_defaults_tenant
  before insert or update on public.organisation_defaults
  for each row execute function private.enforce_organisation_tenant();

create trigger organisation_defaults_home_currency
  before insert or update on public.organisation_defaults
  for each row execute function private.enforce_home_currency();

create or replace function private.create_organisation_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organisation_defaults (organisation_id, tenant_id)
  values (new.id, new.tenant_id);
  return new;
end;
$$;

revoke all on function private.create_organisation_defaults() from public, anon, authenticated;

create trigger organisations_create_defaults
  after insert on public.organisations
  for each row execute function private.create_organisation_defaults();

insert into public.organisation_defaults (organisation_id, tenant_id)
select id, tenant_id
from public.organisations
on conflict (organisation_id) do nothing;

alter table public.currencies enable row level security;
alter table public.organisation_defaults enable row level security;

create policy currencies_select on public.currencies
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy currencies_insert on public.currencies
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy currencies_update on public.currencies
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy currencies_delete on public.currencies
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy organisation_defaults_select on public.organisation_defaults
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy organisation_defaults_insert on public.organisation_defaults
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy organisation_defaults_update on public.organisation_defaults
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

revoke all on table public.currencies from public, anon;
revoke all on table public.organisation_defaults from public, anon;
grant select, insert, update, delete on table public.currencies to authenticated;
grant select, insert, update on table public.organisation_defaults to authenticated;
revoke truncate, references, trigger on table public.currencies from authenticated;
revoke delete, truncate, references, trigger on table public.organisation_defaults from authenticated;
