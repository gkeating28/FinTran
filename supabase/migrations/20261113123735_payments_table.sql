-- Payments release B, phase 2: the payments table (QULAPLUS_PAYMENTS_SPEC.md, 2.2).
--
-- A payment is money out and a receipt is money in. Both live here. Allocations (phase 3) apply them to documents.
-- A payment is never a transaction header: it takes its number from a transaction type of kind payment or receipt.

-- System types are made by migrations (the migrated types of phase 5). People cannot edit or delete them.
alter table public.transaction_types add column is_system boolean not null default false;

create function private.guard_transaction_type_system() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_migrating boolean := coalesce(current_setting('fintran.migration', true) = 'on', false);
begin
  if tg_op = 'INSERT' then
    if new.is_system and not v_migrating then
      raise exception 'System transaction types are made by the system';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.is_system and not v_migrating then
      raise exception 'This transaction type is kept by the system and cannot be removed';
    end if;
    return old;
  end if;

  if new.is_system is distinct from old.is_system and not v_migrating then
    raise exception 'This transaction type is kept by the system';
  end if;
  -- Numbering a payment moves last_reference, and nothing else may change.
  if old.is_system and not v_migrating
     and (to_jsonb(new) - 'last_reference' - 'updated_at' - 'updated_by')
       is distinct from (to_jsonb(old) - 'last_reference' - 'updated_at' - 'updated_by') then
    raise exception 'This transaction type is kept by the system and cannot be changed';
  end if;

  if (new.document_kind is distinct from old.document_kind or new.type is distinct from old.type)
     and to_regclass('public.payments') is not null
     and exists (select 1 from public.payments where transaction_type_id = old.id) then
    raise exception 'The transaction type cannot change after a payment has been entered';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_transaction_type_system() from public, anon, authenticated, service_role;

create trigger aa_guard_system before insert or update or delete on public.transaction_types
  for each row execute function private.guard_transaction_type_system();

-- Payments never become headers, so a header cannot have a payment or receipt type.
create function private.refuse_payment_kind() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if exists (
    select 1 from public.transaction_types
    where id = new.transaction_type_id and document_kind::text in ('payment', 'receipt')
  ) then
    raise exception 'A payment or receipt type is for payments, not documents';
  end if;
  return new;
end;
$$;

revoke all on function private.refuse_payment_kind() from public, anon, authenticated, service_role;

create trigger aa_refuse_payment_kind before insert or update of transaction_type_id on public.transaction_headers
  for each row execute function private.refuse_payment_kind();

create table public.payments (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  transaction_type_id uuid not null,
  reference integer,
  document_number text,
  status public.document_status not null default 'draft',
  source text not null default 'manual',
  payment_date date not null,
  customer_id uuid,
  supplier_id uuid,
  party_name text not null,
  bank_account_id uuid,
  currency_id uuid not null,
  exchange_rate numeric(16, 8) not null,
  amount numeric(18, 2) not null,
  home_amount numeric(18, 2) not null default 0,
  allocated_amount numeric(18, 2) not null default 0,
  unallocated_amount numeric(18, 2) not null default 0,
  home_unallocated_amount numeric(18, 2) not null default 0,
  payment_means_code text not null default '58',
  bank_reference text,
  notes text,
  posted_at timestamp with time zone,
  posted_by uuid,
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint payments_pkey primary key (id),
  constraint payments_organisation_id_id_key unique (organisation_id, id),
  constraint payments_organisation_id_transaction_type_id_ref_key unique (organisation_id, transaction_type_id, reference),
  constraint payments_status_check check (status in ('draft', 'posted', 'void')),
  constraint payments_source_check check (source in ('manual', 'migrated')),
  constraint payments_one_party_check check ((customer_id is null) <> (supplier_id is null)),
  constraint payments_bank_account_check check (bank_account_id is not null or source = 'migrated'),
  constraint payments_amount_check check (amount > 0),
  constraint payments_exchange_rate_check check (exchange_rate > 0),
  constraint payments_allocated_check check (allocated_amount >= 0 and unallocated_amount >= 0 and allocated_amount + unallocated_amount <= amount),
  constraint payments_party_name_check check (char_length(party_name) >= 1 and char_length(party_name) <= 200),
  constraint payments_document_number_check check (document_number is null or (char_length(document_number) >= 1 and char_length(document_number) <= 30)),
  constraint payments_reference_check check (reference is null or reference > 0),
  constraint payments_reference_when_posted_check check (status = 'draft' or reference is not null),
  constraint payments_bank_reference_check check (bank_reference is null or (char_length(bank_reference) >= 1 and char_length(bank_reference) <= 140)),
  constraint payments_notes_check check (notes is null or (char_length(notes) >= 1 and char_length(notes) <= 4000)),
  constraint payments_void_reason_check check (void_reason is null or (char_length(void_reason) >= 1 and char_length(void_reason) <= 500)),
  constraint payments_draft_clean check (status <> 'draft' or (posted_at is null and posted_by is null)),
  constraint payments_posted_complete check (status not in ('posted', 'void') or (document_number is not null and posted_at is not null)),
  constraint payments_void_complete check (status <> 'void' or (voided_at is not null and void_reason is not null)),
  constraint payments_void_only check (status = 'void' or (voided_at is null and voided_by is null and void_reason is null)),
  constraint payments_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete restrict,
  constraint payments_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete restrict,
  constraint payments_transaction_type_fkey foreign key (organisation_id, transaction_type_id) references public.transaction_types (organisation_id, id) on delete restrict,
  constraint payments_customer_fkey foreign key (organisation_id, customer_id) references public.customers (organisation_id, id) on delete restrict,
  constraint payments_supplier_fkey foreign key (organisation_id, supplier_id) references public.suppliers (organisation_id, id) on delete restrict,
  constraint payments_bank_account_fkey foreign key (organisation_id, bank_account_id) references public.bank_accounts (organisation_id, id) on delete restrict,
  constraint payments_currency_fkey foreign key (organisation_id, currency_id) references public.currencies (organisation_id, id) on delete restrict,
  constraint payments_payment_means_fkey foreign key (payment_means_code) references public.ref_payment_means (code),
  constraint payments_posted_by_fkey foreign key (posted_by) references public.profiles (id) on delete set null,
  constraint payments_voided_by_fkey foreign key (voided_by) references public.profiles (id) on delete set null,
  constraint payments_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint payments_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null
);

comment on table public.payments is 'Money paid (kind payment) and received (kind receipt). Applied to documents by allocations.';
comment on column public.payments.allocated_amount is 'Effective allocations only. Written by the settlement function and nothing else.';

create unique index payments_document_number_idx on public.payments (organisation_id, transaction_type_id, document_number) where document_number is not null;
create index payments_organisation_id_idx on public.payments (organisation_id);
create index payments_tenant_id_idx on public.payments (tenant_id);
create index payments_transaction_type_idx on public.payments (organisation_id, transaction_type_id);
create index payments_customer_idx on public.payments (organisation_id, customer_id);
create index payments_supplier_idx on public.payments (organisation_id, supplier_id);
create index payments_bank_account_idx on public.payments (organisation_id, bank_account_id);
create index payments_currency_idx on public.payments (organisation_id, currency_id);
create index payments_payment_means_idx on public.payments (payment_means_code);
create index payments_posted_by_idx on public.payments (posted_by);
create index payments_voided_by_idx on public.payments (voided_by);
create index payments_created_by_idx on public.payments (created_by);
create index payments_updated_by_idx on public.payments (updated_by);
create index payments_money_on_account_idx on public.payments (organisation_id, payment_date) where status = 'posted' and unallocated_amount > 0;

create function private.enforce_payment() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_tenant uuid;
  v_kind text;
  v_direction text;
  v_numbering public.numbering_rule;
  v_prefix text;
  v_padding integer;
  v_party_name text;
  v_party_currency uuid;
  v_home uuid;
  v_rate numeric;
  v_bank record;
  v_old jsonb;
  v_new jsonb;
  v_allowed text[] := array['notes', 'bank_reference', 'created_at', 'created_by', 'updated_at', 'updated_by'];
  v_settlement text[] := array['allocated_amount', 'unallocated_amount', 'home_unallocated_amount'];
  v_status_change boolean := coalesce(current_setting('fintran.status_change', true) = 'on', false);
  v_settling boolean := coalesce(current_setting('fintran.settlement', true) = 'on', false);
  v_migrating boolean := coalesce(current_setting('fintran.migration', true) = 'on', false);
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted and void payments cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A payment cannot be moved or change its type';
  end if;

  select tenant_id into v_tenant from public.organisations where id = new.organisation_id;
  if v_tenant is null or v_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  select document_kind::text, type, numbering, reference_prefix, reference_padding
    into v_kind, v_direction, v_numbering, v_prefix, v_padding
  from public.transaction_types
  where id = new.transaction_type_id and organisation_id = new.organisation_id;
  if v_kind is null or v_kind not in ('payment', 'receipt') then
    raise exception 'Choose a payment or receipt transaction type';
  end if;

  -- Status: only posting and voiding change it, and they say so.
  if tg_op = 'INSERT' then
    if (new.status is distinct from 'draft' or new.posted_at is not null or new.posted_by is not null
        or new.voided_at is not null or new.voided_by is not null or new.void_reason is not null)
       and not v_migrating then
      raise exception 'Payment status can only be changed by posting or voiding';
    end if;
  else
    if new.status is distinct from old.status
       or new.posted_at is distinct from old.posted_at
       or new.posted_by is distinct from old.posted_by
       or new.voided_at is distinct from old.voided_at
       or new.voided_by is distinct from old.voided_by
       or new.void_reason is distinct from old.void_reason then
      if not v_status_change then
        raise exception 'Payment status can only be changed by posting or voiding';
      end if;
      if not ((old.status = 'draft' and new.status = 'posted') or (old.status = 'posted' and new.status = 'void')) then
        raise exception 'That status change is not allowed';
      end if;
    elsif old.status = 'void' then
      raise exception 'A void payment cannot be changed';
    elsif old.status = 'posted' then
      v_old := to_jsonb(old) - v_allowed - v_settlement;
      v_new := to_jsonb(new) - v_allowed - v_settlement;
      if v_old is distinct from v_new then
        raise exception 'Only the notes and the bank reference can be changed on a posted payment';
      end if;
    end if;

    if not v_settling and not v_status_change
       and (new.allocated_amount is distinct from old.allocated_amount
         or new.unallocated_amount is distinct from old.unallocated_amount
         or new.home_unallocated_amount is distinct from old.home_unallocated_amount) then
      raise exception 'Allocated amounts are worked out from allocations';
    end if;
  end if;

  new.bank_reference := nullif(btrim(new.bank_reference), '');
  new.notes := nullif(btrim(new.notes), '');

  -- Everything below describes the payment itself, which a posted or void payment no longer changes.
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if new.status = 'void' then
      new.unallocated_amount := 0;
      new.home_unallocated_amount := 0;
    end if;
    if tg_op = 'UPDATE' and old.document_number is not null then
      new.document_number := old.document_number;
    elsif new.reference is not null then
      new.document_number := private.format_document_number(v_prefix, v_padding, new.reference);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.reference is distinct from old.reference then
    if old.reference is not null or not v_status_change then
      raise exception 'A payment cannot be moved or renumbered';
    end if;
  end if;

  -- The party decides the direction of the type, the name and the currency.
  if v_direction = 'Sales' then
    if new.customer_id is null then
      raise exception 'Choose a customer';
    end if;
    if new.supplier_id is not null then
      raise exception 'A payment on a Sales type is for a customer, not a supplier';
    end if;
    select name, currency_id into v_party_name, v_party_currency
    from public.customers where id = new.customer_id and organisation_id = new.organisation_id;
  else
    if new.supplier_id is null then
      raise exception 'Choose a supplier';
    end if;
    if new.customer_id is not null then
      raise exception 'A payment on a Purchases type is for a supplier, not a customer';
    end if;
    select name, currency_id into v_party_name, v_party_currency
    from public.suppliers where id = new.supplier_id and organisation_id = new.organisation_id;
  end if;
  if v_party_name is null then
    raise exception 'Choose a party from this organisation';
  end if;
  new.party_name := btrim(v_party_name);

  if new.source = 'manual' then
    new.currency_id := v_party_currency;
  elsif new.currency_id is null then
    raise exception 'A migrated payment needs a currency';
  end if;

  select home_currency_id into v_home from public.organisation_defaults where organisation_id = new.organisation_id;
  if new.currency_id = v_home then
    if new.exchange_rate is not null and new.exchange_rate <> 1 then
      raise exception 'The home currency exchange rate must be 1';
    end if;
    new.exchange_rate := 1;
  elsif new.exchange_rate is null then
    select rate into v_rate from public.currencies where id = new.currency_id and organisation_id = new.organisation_id;
    new.exchange_rate := v_rate;
  end if;
  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;
  new.home_amount := round(new.amount / new.exchange_rate, 2);

  if new.bank_account_id is not null then
    select active, currency_id into v_bank
    from public.bank_accounts where id = new.bank_account_id and organisation_id = new.organisation_id;
    if v_bank.currency_id is null then
      raise exception 'Choose a bank account from this organisation';
    end if;
    if not v_bank.active and (tg_op = 'INSERT' or new.bank_account_id is distinct from old.bank_account_id) then
      raise exception 'The bank account is not active';
    end if;
    if v_bank.currency_id is distinct from new.currency_id then
      raise exception 'The bank account must be in the payment currency';
    end if;
  elsif new.source <> 'migrated' then
    raise exception 'Choose a bank account';
  end if;

  if tg_op = 'INSERT' then
    new.allocated_amount := 0;
    new.unallocated_amount := new.amount;
    new.home_unallocated_amount := new.home_amount;
    if v_numbering is distinct from 'on_post' and new.status = 'draft' then
      new.reference := private.issue_reference(new.transaction_type_id);
    elsif new.status = 'draft' then
      new.reference := null;
    end if;
  elsif new.amount is distinct from old.amount then
    -- A draft's amount is free to change while it holds no effective allocation.
    new.unallocated_amount := new.amount - new.allocated_amount;
    new.home_unallocated_amount := new.home_amount;
  elsif new.exchange_rate is distinct from old.exchange_rate then
    new.home_unallocated_amount := new.home_amount;
  end if;

  if tg_op = 'UPDATE' and old.document_number is not null then
    new.document_number := old.document_number;
  elsif new.reference is not null then
    new.document_number := private.format_document_number(v_prefix, v_padding, new.reference);
    if char_length(new.document_number) > 30 or char_length(new.document_number) < 1 then
      raise exception 'The document number is too long';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_payment() from public, anon, authenticated, service_role;

create trigger aa_payment_rules before insert or update or delete on public.payments
  for each row execute function private.enforce_payment();
create trigger zz_set_audit_columns before insert or update on public.payments
  for each row execute function private.set_audit_columns();
create trigger zz_write_audit_log after insert or update or delete on public.payments
  for each row execute function private.write_audit_log();

alter table public.payments enable row level security;

create policy payments_select on public.payments for select to authenticated
  using ((select private.is_org_member(payments.organisation_id)));
create policy payments_insert on public.payments for insert to authenticated
  with check ((select private.is_org_member(payments.organisation_id)) and status = 'draft');
create policy payments_update on public.payments for update to authenticated
  using ((select private.is_org_member(payments.organisation_id)) and status in ('draft', 'posted'))
  with check ((select private.is_org_member(payments.organisation_id)));
create policy payments_delete on public.payments for delete to authenticated
  using ((select private.is_org_member(payments.organisation_id)) and status = 'draft');

revoke all on table public.payments from anon;
revoke truncate, references, trigger on table public.payments from authenticated, service_role;

-- An organisation with payments cannot be deleted.
create or replace function public.delete_organisation(p_organisation_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_tenant uuid;
  v_organisations integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before deleting an organisation';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner'])) then
    raise exception 'You need an owner role to delete an organisation';
  end if;

  select tenant_id into v_tenant
  from public.organisations
  where id = p_organisation_id;

  if v_tenant is null then
    raise exception 'That organisation could not be deleted';
  end if;
  if exists (
    select 1 from public.transaction_headers where organisation_id = p_organisation_id
  ) then
    raise exception 'This organisation has documents and cannot be deleted.';
  end if;
  if exists (
    select 1 from public.e_documents where organisation_id = p_organisation_id
  ) then
    raise exception 'This organisation has e-documents and cannot be deleted.';
  end if;
  if exists (
    select 1 from public.payments where organisation_id = p_organisation_id
  ) then
    raise exception 'This organisation has payments and cannot be deleted.';
  end if;

  select count(*) into v_organisations
  from public.organisations
  where tenant_id = v_tenant;

  if v_organisations <= 1 then
    raise exception 'A tenant must keep at least one organisation';
  end if;

  perform set_config('fintran.deleting_organisation', 'on', true);
  delete from public.organisations where id = p_organisation_id;
  perform set_config('fintran.deleting_organisation', 'off', true);
end;
$$;
