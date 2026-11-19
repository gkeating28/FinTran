-- Supplier bank details and their history (specs/QULAPLUS_PAYMENT_APPROVALS_SPEC.md, phase 1).
--
-- A supplier can hold an IBAN, a BIC and an account name. Every change to one of them is recorded, and an organisation
-- can set a window in days: while a supplier's bank details are newer than the window, a payment to that supplier needs
-- approval (phase 2). With no details and no window, nothing changes for anyone.

alter table public.suppliers
  add column iban text,
  add column bic text,
  add column bank_account_name text,
  add constraint suppliers_bank_account_name_check check (bank_account_name is null or char_length(bank_account_name) <= 140);

comment on column public.suppliers.iban is 'The supplier''s IBAN, in capitals without spaces. Null when not set. A change to it is recorded in supplier_bank_changes.';

alter table public.organisation_defaults
  add column bank_change_days integer,
  add constraint organisation_defaults_bank_change_days_check check (bank_change_days is null or (bank_change_days >= 1 and bank_change_days <= 90));

comment on column public.organisation_defaults.bank_change_days is 'While a supplier''s bank details changed within this many days, a payment to it needs approval. Null means no check.';

-- Tidies the three fields before they are saved: the IBAN and BIC are checked the way bank accounts check theirs.
create function private.prepare_supplier_bank() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  new.iban := private.prepare_iban(new.iban);
  new.bic := private.prepare_bic(new.bic);
  new.bank_account_name := nullif(btrim(coalesce(new.bank_account_name, '')), '');
  return new;
end;
$$;

revoke all on function private.prepare_supplier_bank() from public, anon, authenticated, service_role;

create trigger suppliers_bank_prepare before insert or update on public.suppliers
  for each row execute function private.prepare_supplier_bank();

-- History -----------------------------------------------------------------------------------------------------------

create table public.supplier_bank_changes (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  supplier_id uuid not null,
  old_iban text,
  new_iban text,
  old_bic text,
  new_bic text,
  old_account_name text,
  new_account_name text,
  changed_at timestamp with time zone not null default now(),
  changed_by uuid default auth.uid(),
  constraint supplier_bank_changes_pkey primary key (id),
  constraint supplier_bank_changes_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint supplier_bank_changes_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete cascade,
  constraint supplier_bank_changes_supplier_id_fkey foreign key (supplier_id) references public.suppliers (id) on delete cascade,
  constraint supplier_bank_changes_changed_by_fkey foreign key (changed_by) references public.profiles (id) on delete set null
);

comment on table public.supplier_bank_changes is 'Every change to a supplier''s IBAN, BIC or account name, from a value that was already set. Written by a trigger. Owners and admins can read it. Nobody writes it directly.';

create index supplier_bank_changes_organisation_id_idx on public.supplier_bank_changes (organisation_id);
create index supplier_bank_changes_tenant_id_idx on public.supplier_bank_changes (tenant_id);
create index supplier_bank_changes_supplier_idx on public.supplier_bank_changes (supplier_id, changed_at desc);
create index supplier_bank_changes_changed_by_idx on public.supplier_bank_changes (changed_by);

alter table public.supplier_bank_changes enable row level security;

create policy supplier_bank_changes_select on public.supplier_bank_changes for select to authenticated
  using ((select private.has_org_role(supplier_bank_changes.organisation_id, array['owner', 'admin'])));

revoke all on table public.supplier_bank_changes from anon;
revoke insert, update, delete, truncate, references, trigger on table public.supplier_bank_changes from authenticated, service_role;

create trigger zz_write_audit_log after insert on public.supplier_bank_changes
  for each row execute function private.write_audit_log();

-- A change is a different value where one was already set. Setting details for the first time is not a change.
create function private.record_supplier_bank_change() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if (new.iban is distinct from old.iban and old.iban is not null)
     or (new.bic is distinct from old.bic and old.bic is not null)
     or (new.bank_account_name is distinct from old.bank_account_name and old.bank_account_name is not null) then
    insert into public.supplier_bank_changes (
      tenant_id, organisation_id, supplier_id, old_iban, new_iban, old_bic, new_bic, old_account_name, new_account_name
    ) values (
      new.tenant_id, new.organisation_id, new.id, old.iban, new.iban, old.bic, new.bic, old.bank_account_name, new.bank_account_name
    );
  end if;
  return new;
end;
$$;

revoke all on function private.record_supplier_bank_change() from public, anon, authenticated, service_role;

create trigger suppliers_bank_change after update on public.suppliers
  for each row execute function private.record_supplier_bank_change();

-- Whether the supplier's bank details changed inside the organisation's window. No window means no.
create function private.bank_changed_recently(p_supplier_id uuid) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select coalesce((
    select exists (
      select 1
      from public.supplier_bank_changes as change
      where change.supplier_id = p_supplier_id
        and change.changed_at >= now() - make_interval(days => defaults.bank_change_days)
    )
    from public.suppliers as supplier
    join public.organisation_defaults as defaults on defaults.organisation_id = supplier.organisation_id
    where supplier.id = p_supplier_id and defaults.bank_change_days is not null
  ), false)
$$;

revoke all on function private.bank_changed_recently(uuid) from public, anon, authenticated, service_role;
