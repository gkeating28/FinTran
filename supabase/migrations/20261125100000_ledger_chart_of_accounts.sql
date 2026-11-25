-- General ledger, release A, phase 1: the chart of accounts (QULAPLUS_LEDGER_SPEC.md).
-- Eight account types, system roles on GL codes (the one place a role is stored), an active switch, the codes of the other
-- accounting system, and a GL code of its own for every bank account. Nothing posts yet.
--
-- The Accounting tab used to store the control, VAT, exchange, rounding and suspense accounts in accounting_settings. Those
-- columns stay for now, because the journal export still reads them, but they are a mirror of gl_codes.system_role that only
-- this migration's trigger writes. The journal export refit (phase 9) drops them.

-- Account types -----------------------------------------------------------------------------------------------------------
alter table public.gl_codes drop constraint gl_codes_account_type_check;
alter table public.gl_codes add constraint gl_codes_account_type_check check (account_type in (
  'Fixed Asset', 'Current Asset', 'Current Liability', 'Non-current Liability', 'Equity', 'Income', 'Cost of Sales', 'Expense'
));

alter table public.gl_codes
  add column system_role text,
  add column active boolean not null default true,
  add column external_code text,
  add column external_name text,
  add column report_group text,
  add constraint gl_codes_system_role_check check (system_role is null or system_role in (
    'debtors_control', 'creditors_control', 'vat_output', 'vat_input', 'retained_earnings', 'fx_difference', 'rounding', 'suspense'
  )),
  add constraint gl_codes_external_code_check check (external_code is null or char_length(external_code) between 1 and 60),
  add constraint gl_codes_external_name_check check (external_name is null or char_length(external_name) between 1 and 120),
  add constraint gl_codes_report_group_check check (report_group is null or char_length(report_group) between 1 and 60);

create unique index gl_codes_system_role_key on public.gl_codes (organisation_id, system_role) where system_role is not null;

comment on column public.gl_codes.system_role is 'The job this code does for the ledger posting rules. At most one code in an organisation has each role. Set with set_system_role.';
comment on column public.gl_codes.active is 'An inactive code cannot be used on new lines or journals. A code that holds a system role cannot be made inactive.';
comment on column public.gl_codes.external_code is 'The code of this account in the other accounting system. Used by the feed.';
comment on column public.gl_codes.external_name is 'The name of this account in the other accounting system. Used by the feed.';
comment on column public.gl_codes.report_group is 'Reserved for the reports spec, so that no later migration is needed.';

create function private.role_account_type(p_role text) returns text
  language sql immutable set search_path to ''
as $$
  select case p_role
    when 'debtors_control' then 'Current Asset'
    when 'creditors_control' then 'Current Liability'
    when 'vat_output' then 'Current Liability'
    when 'vat_input' then 'Current Asset'
    when 'retained_earnings' then 'Equity'
    when 'fx_difference' then 'Expense'
    when 'rounding' then 'Expense'
    when 'suspense' then 'Current Asset'
  end
$$;

create function private.account_normal_balance(p_type text) returns text
  language sql immutable set search_path to ''
as $$
  select case
    when p_type in ('Fixed Asset', 'Current Asset', 'Cost of Sales', 'Expense') then 'debit'
    when p_type in ('Current Liability', 'Non-current Liability', 'Equity', 'Income') then 'credit'
  end
$$;

revoke all on function private.role_account_type(text) from public, anon;
revoke all on function private.account_normal_balance(text) from public, anon;
grant execute on function private.role_account_type(text) to authenticated;
grant execute on function private.account_normal_balance(text) to authenticated;

-- Products ----------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_product() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  org_tenant uuid;
  gl_type text;
  vat_kind text;
  gl_role text;
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

  select account_type, system_role into gl_type, gl_role from public.gl_codes where id = new.purchase_gl_code_id;
  if gl_type is distinct from 'Expense' and gl_type is distinct from 'Cost of Sales' then
    raise exception 'Purchase GL code must be an Expense or Cost of Sales account';
  end if;
  if gl_role in ('debtors_control', 'creditors_control') then
    raise exception 'A control account cannot be a product GL code';
  end if;

  select account_type, system_role into gl_type, gl_role from public.gl_codes where id = new.sales_gl_code_id;
  if gl_type is distinct from 'Income' then
    raise exception 'Sales GL code must be an Income account';
  end if;
  if gl_role in ('debtors_control', 'creditors_control') then
    raise exception 'A control account cannot be a product GL code';
  end if;

  select vat_type into vat_kind from public.vat_rates where id = new.purchase_vat_code_id;
  if vat_kind is distinct from 'Expense' then
    raise exception 'Purchase VAT code must be an Expense rate';
  end if;

  select vat_type into vat_kind from public.vat_rates where id = new.sales_vat_code_id;
  if vat_kind is distinct from 'Sales' then
    raise exception 'Sales VAT code must be a Sales rate';
  end if;

  return new;
end;
$$;

create or replace function private.guard_gl_code_product_use() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if new.account_type is distinct from old.account_type then
    if new.account_type not in ('Expense', 'Cost of Sales')
       and exists (select 1 from public.products where purchase_gl_code_id = new.id) then
      raise exception 'That GL code is a purchase GL code on a product and must stay Expense or Cost of Sales';
    end if;
    if new.account_type is distinct from 'Income'
       and exists (select 1 from public.products where sales_gl_code_id = new.id) then
      raise exception 'That GL code is a sales GL code on a product and must stay Income';
    end if;
  end if;
  return new;
end;
$$;

-- Rules for a GL code ---------------------------------------------------------------------------------------------------
create function private.enforce_gl_system_role() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  new.external_code := nullif(btrim(new.external_code), '');
  new.external_name := nullif(btrim(new.external_name), '');
  new.report_group := nullif(btrim(new.report_group), '');

  if new.system_role is not null then
    if private.role_account_type(new.system_role) is distinct from new.account_type then
      raise exception 'The role % needs a % account', new.system_role, private.role_account_type(new.system_role);
    end if;
    if not new.active then
      raise exception 'A GL code that holds a system role cannot be made inactive';
    end if;
    if exists (select 1 from public.bank_accounts where gl_code_id = new.id) then
      raise exception 'That GL code is a bank account code, so it cannot have a system role';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_gl_system_role() from public, anon, authenticated, service_role;
create trigger gl_codes_system_role before insert or update on public.gl_codes
  for each row execute function private.enforce_gl_system_role();

-- A code with a system role is not deleted by hand. Deleting an organisation or a tenant removes its codes with it.
create function private.guard_gl_role_delete() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if old.system_role is not null
     and pg_trigger_depth() <= 1
     and current_setting('fintran.deleting_organisation', true) is distinct from 'on' then
    raise exception 'A GL code that holds a system role cannot be deleted';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_gl_role_delete() from public, anon, authenticated, service_role;
create trigger gl_codes_role_delete before delete on public.gl_codes
  for each row execute function private.guard_gl_role_delete();

-- Control accounts and inactive codes are not used on document lines.
create function private.enforce_line_gl_use() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_role text;
  v_active boolean;
begin
  if new.gl_code_id is not null and (tg_op = 'INSERT' or new.gl_code_id is distinct from old.gl_code_id) then
    select system_role, active into v_role, v_active from public.gl_codes where id = new.gl_code_id;
    if v_role in ('debtors_control', 'creditors_control') then
      raise exception 'That GL code is a control account. Only the system posts to it.';
    end if;
    if v_active is distinct from true then
      raise exception 'That GL code is inactive';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_line_gl_use() from public, anon, authenticated, service_role;
create trigger transaction_lines_gl_use before insert or update of gl_code_id on public.transaction_lines
  for each row execute function private.enforce_line_gl_use();

-- Setting a role ----------------------------------------------------------------------------------------------------------
create function public.set_system_role(p_organisation_id uuid, p_role text, p_gl_code_id uuid) returns void
  language plpgsql security definer set search_path to ''
as $$
declare
  v_type text;
  v_current text;
  v_active boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before changing the accounts';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to change the accounts';
  end if;
  if private.role_account_type(p_role) is null then
    raise exception 'That is not a system role';
  end if;

  select account_type, system_role, active into v_type, v_current, v_active
  from public.gl_codes
  where id = p_gl_code_id and organisation_id = p_organisation_id;
  if v_type is null then
    raise exception 'Choose a GL code of this organisation';
  end if;
  if v_type is distinct from private.role_account_type(p_role) then
    raise exception 'The role % needs a % account', p_role, private.role_account_type(p_role);
  end if;
  if v_current is not null and v_current is distinct from p_role then
    raise exception 'That GL code already has the role %', v_current;
  end if;
  if not v_active then
    raise exception 'That GL code is inactive';
  end if;
  if p_role in ('debtors_control', 'creditors_control') and (
       exists (select 1 from public.transaction_lines where organisation_id = p_organisation_id and gl_code_id = p_gl_code_id)
    or exists (select 1 from public.products where organisation_id = p_organisation_id and (purchase_gl_code_id = p_gl_code_id or sales_gl_code_id = p_gl_code_id))
  ) then
    raise exception 'That GL code is used on document lines or products, so it cannot be a control account. Move them to another code first.';
  end if;

  update public.gl_codes set system_role = null
  where organisation_id = p_organisation_id and system_role = p_role and id <> p_gl_code_id;
  update public.gl_codes set system_role = p_role where id = p_gl_code_id;
end;
$$;
revoke all on function public.set_system_role(uuid, text, uuid) from public, anon;
grant execute on function public.set_system_role(uuid, text, uuid) to authenticated;

-- The mirror in accounting_settings -----------------------------------------------------------------------------------------
create function private.role_settings_column(p_role text) returns text
  language sql immutable set search_path to ''
as $$
  select case p_role
    when 'debtors_control' then 'receivables_gl_code_id'
    when 'creditors_control' then 'payables_gl_code_id'
    when 'vat_output' then 'vat_sales_gl_code_id'
    when 'vat_input' then 'vat_purchases_gl_code_id'
    when 'fx_difference' then 'exchange_gl_code_id'
    when 'rounding' then 'rounding_gl_code_id'
    when 'suspense' then 'suspense_gl_code_id'
  end
$$;
revoke all on function private.role_settings_column(text) from public, anon, authenticated, service_role;

create function private.mirror_system_role() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_column text;
begin
  perform set_config('fintran.role_mirror', 'on', true);
  if tg_op = 'UPDATE' and old.system_role is distinct from new.system_role and old.system_role is not null then
    v_column := private.role_settings_column(old.system_role);
    if v_column is not null then
      execute format('update public.accounting_settings set %I = null where organisation_id = $1 and %I = $2', v_column, v_column)
        using old.organisation_id, old.id;
    end if;
  end if;
  if new.system_role is not null then
    v_column := private.role_settings_column(new.system_role);
    if v_column is not null then
      insert into public.accounting_settings (tenant_id, organisation_id) values (new.tenant_id, new.organisation_id)
      on conflict (organisation_id) do nothing;
      execute format('update public.accounting_settings set %I = $2 where organisation_id = $1', v_column)
        using new.organisation_id, new.id;
    end if;
  end if;
  perform set_config('fintran.role_mirror', 'off', true);
  return null;
end;
$$;
revoke all on function private.mirror_system_role() from public, anon, authenticated, service_role;
create trigger gl_codes_mirror_role after insert or update of system_role on public.gl_codes
  for each row execute function private.mirror_system_role();

create function private.guard_accounting_roles() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if current_setting('fintran.role_mirror', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.receivables_gl_code_id is not null or new.payables_gl_code_id is not null or new.vat_sales_gl_code_id is not null
       or new.vat_purchases_gl_code_id is not null or new.exchange_gl_code_id is not null or new.rounding_gl_code_id is not null
       or new.suspense_gl_code_id is not null then
      raise exception 'The accounts are set on the GL codes. Use set_system_role.';
    end if;
  elsif (new.receivables_gl_code_id, new.payables_gl_code_id, new.vat_sales_gl_code_id, new.vat_purchases_gl_code_id,
         new.exchange_gl_code_id, new.rounding_gl_code_id, new.suspense_gl_code_id)
        is distinct from
        (old.receivables_gl_code_id, old.payables_gl_code_id, old.vat_sales_gl_code_id, old.vat_purchases_gl_code_id,
         old.exchange_gl_code_id, old.rounding_gl_code_id, old.suspense_gl_code_id) then
    raise exception 'The accounts are set on the GL codes. Use set_system_role.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_accounting_roles() from public, anon, authenticated, service_role;
create trigger accounting_settings_roles before insert or update on public.accounting_settings
  for each row execute function private.guard_accounting_roles();

-- The default accounts -----------------------------------------------------------------------------------------------------
create function private.ensure_system_roles(p_tenant_id uuid, p_organisation_id uuid) returns void
  language plpgsql security definer set search_path to ''
as $$
declare
  r record;
  v_code text;
  v_n integer;
begin
  for r in
    select * from (values
      ('debtors_control', '1100', 'Debtors control'),
      ('creditors_control', '2100', 'Creditors control'),
      ('vat_output', '2200', 'VAT on sales'),
      ('vat_input', '1200', 'VAT on purchases'),
      ('retained_earnings', '3200', 'Retained earnings'),
      ('fx_difference', '7900', 'Exchange differences'),
      ('rounding', '7910', 'Rounding'),
      ('suspense', '9990', 'Suspense')
    ) as t(role, code, description)
  loop
    if not exists (select 1 from public.gl_codes where organisation_id = p_organisation_id and system_role = r.role) then
      v_code := r.code;
      v_n := 0;
      while exists (select 1 from public.gl_codes where organisation_id = p_organisation_id and code = v_code) loop
        v_n := v_n + 1;
        v_code := r.code || '-' || v_n;
      end loop;
      insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type, system_role)
      values (p_tenant_id, p_organisation_id, v_code, r.description, private.role_account_type(r.role), r.role);
      raise notice 'Organisation %: created % % for %', p_organisation_id, v_code, r.description, r.role;
    end if;
  end loop;
end;
$$;
revoke all on function private.ensure_system_roles(uuid, uuid) from public, anon, authenticated, service_role;

create function private.organisation_system_roles() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  perform private.ensure_system_roles(new.tenant_id, new.id);
  return new;
end;
$$;
revoke all on function private.organisation_system_roles() from public, anon, authenticated, service_role;
create trigger organisations_system_roles after insert on public.organisations
  for each row execute function private.organisation_system_roles();

-- Bank accounts ---------------------------------------------------------------------------------------------------------
create function private.new_bank_gl_code(p_tenant_id uuid, p_organisation_id uuid, p_name text) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  v_number integer := 1210;
  v_id uuid;
begin
  while exists (select 1 from public.gl_codes where organisation_id = p_organisation_id and code = v_number::text) loop
    v_number := v_number + 1;
  end loop;
  insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
  values (p_tenant_id, p_organisation_id, v_number::text, left('Bank: ' || btrim(coalesce(p_name, '')), 200), 'Current Asset')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.new_bank_gl_code(uuid, uuid, text) from public, anon, authenticated, service_role;

create or replace function private.enforce_bank_account() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_tenant uuid;
  v_gl_type text;
  v_gl_role text;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A bank account cannot be moved to another organisation';
  end if;

  select tenant_id into v_tenant
  from public.organisations
  where id = new.organisation_id;
  if v_tenant is null or v_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.name := btrim(new.name);
  new.iban := private.prepare_iban(new.iban);
  if new.iban is null then
    raise exception 'Enter an IBAN';
  end if;
  new.bic := private.prepare_bic(new.bic);

  if new.gl_code_id is null then
    if tg_op = 'UPDATE' then
      raise exception 'A bank account needs a GL code';
    end if;
    -- A new bank account that names no GL code gets one of its own.
    new.gl_code_id := private.new_bank_gl_code(new.tenant_id, new.organisation_id, new.name);
  end if;

  select account_type, system_role into v_gl_type, v_gl_role
  from public.gl_codes
  where id = new.gl_code_id
    and organisation_id = new.organisation_id;
  if v_gl_type is distinct from 'Current Asset' or v_gl_role is not null then
    raise exception 'Choose a Current Asset GL code that has no system role';
  end if;

  if new.is_default and not new.active then
    -- Making a default account inactive just takes the default off it. Making an inactive one the default is refused.
    if tg_op = 'UPDATE' and old.active and old.is_default then
      new.is_default := false;
    else
      raise exception 'An inactive account cannot be the default';
    end if;
  end if;

  if new.is_default then
    update public.bank_accounts
    set is_default = false
    where organisation_id = new.organisation_id
      and currency_id = new.currency_id
      and is_default
      and id is distinct from new.id;
  end if;

  return new;
end;
$$;

-- Existing data ---------------------------------------------------------------------------------------------------------
-- The pre-checks and the adoption are functions, so the tests can run them on made-up data.
create function private.ledger_role_problems() returns text
  language plpgsql security definer set search_path to ''
as $$
declare
  v_problems text := '';
  r record;
begin
  -- A choice whose account type does not match its role.
  for r in
    select o.name as organisation, c.role, g.code, g.account_type
    from public.accounting_settings s
    join public.organisations o on o.id = s.organisation_id
    cross join lateral (values
      ('debtors_control', s.receivables_gl_code_id), ('creditors_control', s.payables_gl_code_id),
      ('vat_output', s.vat_sales_gl_code_id), ('vat_input', s.vat_purchases_gl_code_id),
      ('fx_difference', s.exchange_gl_code_id), ('rounding', s.rounding_gl_code_id), ('suspense', s.suspense_gl_code_id)
    ) as c(role, gl_id)
    join public.gl_codes g on g.id = c.gl_id
    where private.role_account_type(c.role) is distinct from g.account_type
  loop
    v_problems := v_problems || format(E'\n  %s: %s is %s, and the role %s needs %s', r.organisation, r.code, r.account_type, r.role, private.role_account_type(r.role));
  end loop;

  -- One code chosen for two roles.
  for r in
    select o.name as organisation, g.code, string_agg(c.role, ', ') as roles
    from public.accounting_settings s
    join public.organisations o on o.id = s.organisation_id
    cross join lateral (values
      ('debtors_control', s.receivables_gl_code_id), ('creditors_control', s.payables_gl_code_id),
      ('vat_output', s.vat_sales_gl_code_id), ('vat_input', s.vat_purchases_gl_code_id),
      ('fx_difference', s.exchange_gl_code_id), ('rounding', s.rounding_gl_code_id), ('suspense', s.suspense_gl_code_id)
    ) as c(role, gl_id)
    join public.gl_codes g on g.id = c.gl_id
    group by o.name, g.id, g.code
    having count(*) > 1
  loop
    v_problems := v_problems || format(E'\n  %s: %s is chosen for %s', r.organisation, r.code, r.roles);
  end loop;

  -- A control account that is already used on a document line or a product.
  for r in
    select o.name as organisation, g.code,
      (select count(*) from public.transaction_lines l where l.gl_code_id = g.id) as lines,
      (select count(*) from public.products p where p.purchase_gl_code_id = g.id or p.sales_gl_code_id = g.id) as products
    from public.accounting_settings s
    join public.organisations o on o.id = s.organisation_id
    join public.gl_codes g on g.id in (s.receivables_gl_code_id, s.payables_gl_code_id)
    where exists (select 1 from public.transaction_lines l where l.gl_code_id = g.id)
       or exists (select 1 from public.products p where p.purchase_gl_code_id = g.id or p.sales_gl_code_id = g.id)
  loop
    v_problems := v_problems || format(E'\n  %s: control account %s is used on %s document lines and %s products', r.organisation, r.code, r.lines, r.products);
  end loop;

  -- Bank accounts that share a GL code.
  for r in
    select o.name as organisation, g.code, count(*) as accounts
    from public.bank_accounts b
    join public.organisations o on o.id = b.organisation_id
    join public.gl_codes g on g.id = b.gl_code_id
    group by o.name, g.id, g.code
    having count(*) > 1
  loop
    v_problems := v_problems || format(E'\n  %s: %s bank accounts share the GL code %s', r.organisation, r.accounts, r.code);
  end loop;

  return v_problems;
end;
$$;
revoke all on function private.ledger_role_problems() from public, anon, authenticated, service_role;

create function private.ledger_adopt_roles() returns void
  language plpgsql security definer set search_path to ''
as $$
declare
  r record;
begin
  -- 1. An existing choice takes the role.
  for r in
    select s.organisation_id, c.role, c.gl_id, g.code
    from public.accounting_settings s
    cross join lateral (values
      ('debtors_control', s.receivables_gl_code_id), ('creditors_control', s.payables_gl_code_id),
      ('vat_output', s.vat_sales_gl_code_id), ('vat_input', s.vat_purchases_gl_code_id),
      ('fx_difference', s.exchange_gl_code_id), ('rounding', s.rounding_gl_code_id), ('suspense', s.suspense_gl_code_id)
    ) as c(role, gl_id)
    join public.gl_codes g on g.id = c.gl_id
  loop
    update public.gl_codes set system_role = r.role where id = r.gl_id;
    raise notice 'Organisation %: adopted % for %', r.organisation_id, r.code, r.role;
  end loop;

  -- 2. No choice: create the default account.
  for r in select id, tenant_id from public.organisations loop
    perform private.ensure_system_roles(r.tenant_id, r.id);
  end loop;

  -- Bank accounts without a GL code get one of their own.
  for r in select id, tenant_id, organisation_id, name from public.bank_accounts where gl_code_id is null order by created_at, id loop
    update public.bank_accounts set gl_code_id = private.new_bank_gl_code(r.tenant_id, r.organisation_id, r.name) where id = r.id;
    raise notice 'Organisation %: bank account % has a new GL code', r.organisation_id, r.name;
  end loop;
end;
$$;
revoke all on function private.ledger_adopt_roles() from public, anon, authenticated, service_role;

do $$
declare
  v_problems text := private.ledger_role_problems();
begin
  if v_problems <> '' then
    raise exception E'The chart of accounts cannot be migrated until these are fixed:%', v_problems;
  end if;
end $$;

select private.ledger_adopt_roles();

alter table public.bank_accounts alter column gl_code_id set not null;
create unique index bank_accounts_gl_code_key on public.bank_accounts (organisation_id, gl_code_id);
