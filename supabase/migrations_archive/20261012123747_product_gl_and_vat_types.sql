create or replace function private.enforce_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  gl_org uuid;
  gl_type text;
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

  select organisation_id, account_type into gl_org, gl_type
  from public.gl_codes
  where id = new.purchase_gl_code_id;

  if gl_org is null or gl_org is distinct from new.organisation_id then
    raise exception 'Purchase GL code must belong to this organisation';
  end if;

  if gl_type is distinct from 'Expense' then
    raise exception 'Purchase GL code must be an Expense account';
  end if;

  select organisation_id, account_type into gl_org, gl_type
  from public.gl_codes
  where id = new.sales_gl_code_id;

  if gl_org is null or gl_org is distinct from new.organisation_id then
    raise exception 'Sales GL code must belong to this organisation';
  end if;

  if gl_type is distinct from 'Income' then
    raise exception 'Sales GL code must be an Income account';
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

create or replace function private.guard_gl_code_product_use()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_type is distinct from old.account_type then
    if new.account_type is distinct from 'Expense'
       and exists (
         select 1 from public.products where purchase_gl_code_id = new.id
       ) then
      raise exception 'That GL code is a purchase GL code on a product and must stay Expense';
    end if;

    if new.account_type is distinct from 'Income'
       and exists (
         select 1 from public.products where sales_gl_code_id = new.id
       ) then
      raise exception 'That GL code is a sales GL code on a product and must stay Income';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_gl_code_product_use() from public, anon, authenticated;

create trigger gl_codes_product_use
  before update on public.gl_codes
  for each row execute function private.guard_gl_code_product_use();
