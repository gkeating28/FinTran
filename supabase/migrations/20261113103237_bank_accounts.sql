-- Payments release A: bank accounts (QULAPLUS_PAYMENTS_SPEC.md, phase 1).
--
-- A setup list of the organisation's own bank accounts. Payments (release B) will point at it. Nothing reads it yet.
-- The organisation IBAN on organisation_defaults stays where it is: it is still what invoices show (BT-84).

create table public.bank_accounts (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  code text not null,
  name text not null,
  iban text not null,
  bic text,
  currency_id uuid not null,
  gl_code_id uuid,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint bank_accounts_pkey primary key (id),
  constraint bank_accounts_code_check check (code ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$'),
  constraint bank_accounts_name_check check (char_length(name) >= 1 and char_length(name) <= 100),
  constraint bank_accounts_default_active_check check (not is_default or active),
  constraint bank_accounts_organisation_id_code_key unique (organisation_id, code),
  constraint bank_accounts_organisation_id_iban_key unique (organisation_id, iban),
  constraint bank_accounts_organisation_id_id_key unique (organisation_id, id),
  constraint bank_accounts_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint bank_accounts_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete cascade,
  constraint bank_accounts_currency_fkey foreign key (organisation_id, currency_id) references public.currencies (organisation_id, id) on delete restrict,
  constraint bank_accounts_gl_code_fkey foreign key (organisation_id, gl_code_id) references public.gl_codes (organisation_id, id) on delete restrict,
  constraint bank_accounts_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint bank_accounts_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null
);

comment on table public.bank_accounts is 'The organisation''s own bank accounts. Payments and receipts are recorded against them.';

-- At most one default account per currency.
create unique index bank_accounts_default_currency_key on public.bank_accounts (organisation_id, currency_id) where is_default;

create index bank_accounts_organisation_id_idx on public.bank_accounts (organisation_id);
create index bank_accounts_tenant_id_idx on public.bank_accounts (tenant_id);
create index bank_accounts_currency_idx on public.bank_accounts (organisation_id, currency_id);
create index bank_accounts_gl_code_idx on public.bank_accounts (organisation_id, gl_code_id);
create index bank_accounts_created_by_idx on public.bank_accounts (created_by);
create index bank_accounts_updated_by_idx on public.bank_accounts (updated_by);

-- Scope, normalisation and the default rule. One function, so the order of the checks is plain.
create function private.enforce_bank_account() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_tenant uuid;
  v_gl_type text;
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

  if new.gl_code_id is not null then
    select account_type into v_gl_type
    from public.gl_codes
    where id = new.gl_code_id
      and organisation_id = new.organisation_id;
    if v_gl_type is distinct from 'Current Asset' then
      raise exception 'Choose a Current Asset GL code';
    end if;
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

revoke all on function private.enforce_bank_account() from public, anon, authenticated, service_role;

create trigger aa_code_unchanged before update on public.bank_accounts
  for each row execute function private.guard_code_unchanged();
create trigger bank_accounts_scope before insert or update on public.bank_accounts
  for each row execute function private.enforce_bank_account();
create trigger zz_set_audit_columns before insert or update on public.bank_accounts
  for each row execute function private.set_audit_columns();
create trigger zz_write_audit_log after insert or update or delete on public.bank_accounts
  for each row execute function private.write_audit_log();

alter table public.bank_accounts enable row level security;

create policy bank_accounts_select on public.bank_accounts for select to authenticated
  using ((select private.is_org_member(bank_accounts.organisation_id)));
create policy bank_accounts_insert on public.bank_accounts for insert to authenticated
  with check ((select private.has_org_role(bank_accounts.organisation_id, array['owner', 'admin'])));
create policy bank_accounts_update on public.bank_accounts for update to authenticated
  using ((select private.has_org_role(bank_accounts.organisation_id, array['owner', 'admin'])))
  with check ((select private.has_org_role(bank_accounts.organisation_id, array['owner', 'admin'])));
create policy bank_accounts_delete on public.bank_accounts for delete to authenticated
  using ((select private.has_org_role(bank_accounts.organisation_id, array['owner', 'admin'])));

revoke all on table public.bank_accounts from anon;
revoke truncate, references, trigger on table public.bank_accounts from authenticated, service_role;

-- Phase 1.2: an organisation that already has an IBAN gets it as its main account, in its home currency.
-- The organisation's own IBAN is left in place.
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, bic, currency_id, is_default)
select defaults.tenant_id, defaults.organisation_id, 'MAIN', coalesce(defaults.bank_account_name, 'Main account'),
  defaults.iban, defaults.bic,
  defaults.home_currency_id, true
from public.organisation_defaults defaults
where nullif(btrim(defaults.iban), '') is not null;
