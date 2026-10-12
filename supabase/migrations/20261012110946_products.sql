create or replace function private.enforce_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  gl_org uuid;
  vat_org uuid;
  vat_kind text;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A product cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.description := btrim(new.description);

  select organisation_id into gl_org
  from public.gl_codes
  where id = new.purchase_gl_code_id;

  if gl_org is null or gl_org is distinct from new.organisation_id then
    raise exception 'Purchase GL code must belong to this organisation';
  end if;

  select organisation_id into gl_org
  from public.gl_codes
  where id = new.sales_gl_code_id;

  if gl_org is null or gl_org is distinct from new.organisation_id then
    raise exception 'Sales GL code must belong to this organisation';
  end if;

  select organisation_id, vat_type into vat_org, vat_kind
  from public.vat_rates
  where id = new.purchase_vat_code_id;

  if vat_org is null or vat_org is distinct from new.organisation_id then
    raise exception 'Purchase VAT code must belong to this organisation';
  end if;

  if vat_kind is distinct from 'Expense' then
    raise exception 'Purchase VAT code must be an Expense rate';
  end if;

  select organisation_id, vat_type into vat_org, vat_kind
  from public.vat_rates
  where id = new.sales_vat_code_id;

  if vat_org is null or vat_org is distinct from new.organisation_id then
    raise exception 'Sales VAT code must belong to this organisation';
  end if;

  if vat_kind is distinct from 'Sales' then
    raise exception 'Sales VAT code must be a Sales rate';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_product() from public, anon, authenticated;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  code text not null,
  description text not null,
  purchase_price numeric(16, 4) not null,
  sales_price numeric(16, 4) not null,
  purchase_gl_code_id uuid not null,
  sales_gl_code_id uuid not null,
  purchase_vat_code_id uuid not null,
  sales_vat_code_id uuid not null,
  created_at timestamptz not null default now(),
  constraint products_code_check check (code ~ '^[A-Z0-9]{1,30}$'),
  constraint products_description_check check (char_length(description) between 1 and 200),
  constraint products_purchase_price_check check (purchase_price >= 0),
  constraint products_sales_price_check check (sales_price >= 0),
  constraint products_purchase_gl_code_id_fkey
    foreign key (purchase_gl_code_id) references public.gl_codes (id) on delete restrict,
  constraint products_sales_gl_code_id_fkey
    foreign key (sales_gl_code_id) references public.gl_codes (id) on delete restrict,
  constraint products_purchase_vat_code_id_fkey
    foreign key (purchase_vat_code_id) references public.vat_rates (id) on delete restrict,
  constraint products_sales_vat_code_id_fkey
    foreign key (sales_vat_code_id) references public.vat_rates (id) on delete restrict,
  unique (organisation_id, code)
);

create index products_tenant_id_idx on public.products (tenant_id);
create index products_purchase_gl_code_id_idx on public.products (purchase_gl_code_id);
create index products_sales_gl_code_id_idx on public.products (sales_gl_code_id);
create index products_purchase_vat_code_id_idx on public.products (purchase_vat_code_id);
create index products_sales_vat_code_id_idx on public.products (sales_vat_code_id);

create trigger products_scope
  before insert or update on public.products
  for each row execute function private.enforce_product();

alter table public.products enable row level security;

create policy products_select on public.products
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

create policy products_insert on public.products
  for insert to authenticated
  with check ((select private.is_org_member(organisation_id)));

create policy products_update on public.products
  for update to authenticated
  using ((select private.is_org_member(organisation_id)))
  with check ((select private.is_org_member(organisation_id)));

create policy products_delete on public.products
  for delete to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.products from public, anon;
grant select, insert, update, delete on table public.products to authenticated;
revoke truncate, references, trigger on table public.products from authenticated;

create or replace function private.guard_vat_rate_product_use()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vat_type is distinct from old.vat_type then
    if new.vat_type is distinct from 'Expense'
       and exists (
         select 1 from public.products where purchase_vat_code_id = new.id
       ) then
      raise exception 'That VAT rate is a purchase VAT code on a product and must stay Expense';
    end if;

    if new.vat_type is distinct from 'Sales'
       and exists (
         select 1 from public.products where sales_vat_code_id = new.id
       ) then
      raise exception 'That VAT rate is a sales VAT code on a product and must stay Sales';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_vat_rate_product_use() from public, anon, authenticated;

create trigger vat_rates_product_use
  before update on public.vat_rates
  for each row execute function private.guard_vat_rate_product_use();
