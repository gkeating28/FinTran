alter table public.customers
  add column currency_id uuid references public.currencies (id) on delete restrict;

alter table public.suppliers
  add column currency_id uuid references public.currencies (id) on delete restrict;

create index customers_currency_id_idx on public.customers (currency_id);
create index suppliers_currency_id_idx on public.suppliers (currency_id);

update public.customers as party
set currency_id = defaults.home_currency_id
from public.organisation_defaults as defaults
where defaults.organisation_id = party.organisation_id
  and party.currency_id is null
  and defaults.home_currency_id is not null;

update public.suppliers as party
set currency_id = defaults.home_currency_id
from public.organisation_defaults as defaults
where defaults.organisation_id = party.organisation_id
  and party.currency_id is null
  and defaults.home_currency_id is not null;

update public.customers as party
set currency_id = only_currency.id
from (
  select organisation_id, (array_agg(id))[1] as id
  from public.currencies
  group by organisation_id
  having count(*) = 1
) as only_currency
where only_currency.organisation_id = party.organisation_id
  and party.currency_id is null;

update public.suppliers as party
set currency_id = only_currency.id
from (
  select organisation_id, (array_agg(id))[1] as id
  from public.currencies
  group by organisation_id
  having count(*) = 1
) as only_currency
where only_currency.organisation_id = party.organisation_id
  and party.currency_id is null;

alter table public.customers alter column currency_id set not null;
alter table public.suppliers alter column currency_id set not null;

create or replace function private.enforce_party_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  currency_org uuid;
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

  select organisation_id into currency_org
  from public.currencies
  where id = new.currency_id;

  if currency_org is null or currency_org is distinct from new.organisation_id then
    raise exception 'Currency must belong to this organisation';
  end if;

  new.code := upper(btrim(new.code));
  new.name := btrim(new.name);
  new.phone := nullif(btrim(new.phone), '');
  new.email := nullif(btrim(new.email), '');
  new.website := nullif(btrim(new.website), '');
  new.address := nullif(btrim(new.address), '');
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$$;

revoke all on function private.enforce_party_scope() from public, anon, authenticated;
