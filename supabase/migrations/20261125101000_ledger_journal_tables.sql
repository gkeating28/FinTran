-- General ledger, release A, phase 2: the mode, the period columns and the journal tables (QULAPLUS_LEDGER_SPEC.md).
-- Nothing posts to them yet. Entries are immutable once posted, balance is checked at the end of the transaction, and no
-- one writes them directly: later migrations add the functions and triggers that do.

-- Mode and period columns -------------------------------------------------------------------------------------------------
alter table public.organisation_defaults
  add column ledger_mode text not null default 'feed',
  add column ledger_start_date date,
  add column lock_exported boolean not null default true,
  add column exported_through date,
  add constraint organisation_defaults_ledger_mode_check check (ledger_mode in ('feed', 'book'));

comment on column public.organisation_defaults.ledger_mode is 'book: Qula Plus is the book of record. feed: it sends documents and payments to another accounting system. The same entries are posted in both. Changes only through set_ledger_mode.';
comment on column public.organisation_defaults.ledger_start_date is 'The go-live date of the ledger. The opening balance journal is dated the day before.';
comment on column public.organisation_defaults.lock_exported is 'When on, a new posting dated on or before exported_through is refused. Voids and removals are never refused by it.';
comment on column public.organisation_defaults.exported_through is 'The latest date any exported feed or journal batch covers. Written only by the export functions.';

create function private.guard_ledger_columns() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.ledger_mode is distinct from old.ledger_mode or new.exported_through is distinct from old.exported_through)
     and current_setting('fintran.ledger_admin', true) is distinct from 'on' then
    raise exception 'The ledger mode and the exported-through date are changed by the system, not by hand';
  end if;
  if tg_op = 'UPDATE' and new.exported_through is distinct from old.exported_through
     and old.exported_through is not null and (new.exported_through is null or new.exported_through < old.exported_through) then
    raise exception 'The exported-through date only moves forward';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_ledger_columns() from public, anon, authenticated, service_role;
create trigger organisation_defaults_ledger before update on public.organisation_defaults
  for each row execute function private.guard_ledger_columns();

-- The entry counter -------------------------------------------------------------------------------------------------------
create table public.ledger_counters (
  organisation_id uuid primary key references public.organisations (id) on delete restrict,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  last_number bigint not null default 0
);
comment on table public.ledger_counters is 'The last journal entry number issued in each organisation. Locked last in the posting lock order. Written only by private.next_entry_number.';
alter table public.ledger_counters enable row level security;
revoke all on table public.ledger_counters from anon, authenticated;

create function private.next_entry_number(p_tenant_id uuid, p_organisation_id uuid) returns bigint
  language sql security definer set search_path to ''
as $$
  insert into public.ledger_counters (organisation_id, tenant_id, last_number)
  values (p_organisation_id, p_tenant_id, 1)
  on conflict (organisation_id) do update set last_number = public.ledger_counters.last_number + 1
  returning last_number
$$;
revoke all on function private.next_entry_number(uuid, uuid) from public, anon, authenticated, service_role;

-- Journal entries ---------------------------------------------------------------------------------------------------------
create table public.journal_entries (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  entry_number bigint,
  entry_date date not null,
  status text not null default 'posted',
  source_type text not null,
  source_header_id uuid,
  source_payment_id uuid,
  source_allocation_id uuid,
  reverses_entry_id uuid,
  source_ref text,
  is_opening boolean not null default false,
  description text not null,
  backfilled boolean not null default false,
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint journal_entries_pkey primary key (id),
  constraint journal_entries_organisation_id_id_key unique (organisation_id, id),
  constraint journal_entries_number_key unique (organisation_id, entry_number),
  constraint journal_entries_tenant_fkey foreign key (tenant_id) references public.tenants (id) on delete restrict,
  constraint journal_entries_organisation_fkey foreign key (organisation_id) references public.organisations (id) on delete restrict,
  constraint journal_entries_header_fkey foreign key (organisation_id, source_header_id) references public.transaction_headers (organisation_id, id) on delete restrict,
  constraint journal_entries_payment_fkey foreign key (organisation_id, source_payment_id) references public.payments (organisation_id, id) on delete restrict,
  constraint journal_entries_allocation_fkey foreign key (organisation_id, source_allocation_id) references public.allocations (organisation_id, id) on delete restrict,
  constraint journal_entries_reverses_fkey foreign key (organisation_id, reverses_entry_id) references public.journal_entries (organisation_id, id) on delete restrict,
  constraint journal_entries_posted_by_fkey foreign key (posted_by) references public.profiles (id) on delete set null,
  constraint journal_entries_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint journal_entries_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null,
  constraint journal_entries_status_check check (status in ('draft', 'posted')),
  constraint journal_entries_source_type_check check (source_type in ('document', 'payment', 'allocation', 'manual', 'reversal')),
  constraint journal_entries_description_check check (char_length(description) between 1 and 200),
  constraint journal_entries_source_ref_check check (source_ref is null or char_length(source_ref) between 1 and 60),
  constraint journal_entries_source_check check (
    (source_type = 'document' and source_header_id is not null and source_payment_id is null and source_allocation_id is null and reverses_entry_id is null) or
    (source_type = 'payment' and source_payment_id is not null and source_header_id is null and source_allocation_id is null and reverses_entry_id is null) or
    (source_type = 'allocation' and source_allocation_id is not null and source_header_id is null and source_payment_id is null and reverses_entry_id is null) or
    (source_type = 'manual' and source_header_id is null and source_payment_id is null and source_allocation_id is null and reverses_entry_id is null) or
    (source_type = 'reversal' and reverses_entry_id is not null and
      ((source_header_id is not null)::int + (source_payment_id is not null)::int + (source_allocation_id is not null)::int) <= 1)
  ),
  constraint journal_entries_posted_check check (status = 'draft' or (entry_number is not null and posted_at is not null)),
  constraint journal_entries_draft_check check (status = 'posted' or (entry_number is null and posted_at is null)),
  constraint journal_entries_draft_manual_check check (status = 'posted' or source_type = 'manual'),
  constraint journal_entries_opening_check check (not is_opening or source_type = 'manual')
);
comment on table public.journal_entries is 'One balanced posting. Immutable once posted. Corrected only by a reversing entry. Written only by the ledger functions and triggers.';

create unique index journal_entries_reverses_key on public.journal_entries (organisation_id, reverses_entry_id) where reverses_entry_id is not null;
create unique index journal_entries_opening_key on public.journal_entries (organisation_id) where is_opening;
create index journal_entries_date_idx on public.journal_entries (organisation_id, entry_date);
create index journal_entries_tenant_idx on public.journal_entries (tenant_id);
create index journal_entries_header_idx on public.journal_entries (organisation_id, source_header_id);
create index journal_entries_payment_idx on public.journal_entries (organisation_id, source_payment_id);
create index journal_entries_allocation_idx on public.journal_entries (organisation_id, source_allocation_id);
create index journal_entries_posted_by_idx on public.journal_entries (posted_by);
create index journal_entries_created_by_idx on public.journal_entries (created_by);
create index journal_entries_updated_by_idx on public.journal_entries (updated_by);

-- Journal lines -----------------------------------------------------------------------------------------------------------
create table public.journal_lines (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  entry_id uuid not null,
  line_number integer not null,
  gl_code_id uuid not null,
  department_id uuid,
  cost_centre_id uuid,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  currency_id uuid not null,
  exchange_rate numeric(16,8) not null,
  foreign_amount numeric(18,2) not null,
  customer_id uuid,
  supplier_id uuid,
  vat_category text,
  vat_percentage numeric(5,2),
  vat_taxable_home numeric(18,2),
  description text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint journal_lines_pkey primary key (id),
  constraint journal_lines_organisation_id_id_key unique (organisation_id, id),
  constraint journal_lines_number_key unique (entry_id, line_number),
  constraint journal_lines_tenant_fkey foreign key (tenant_id) references public.tenants (id) on delete restrict,
  constraint journal_lines_organisation_fkey foreign key (organisation_id) references public.organisations (id) on delete restrict,
  constraint journal_lines_entry_fkey foreign key (organisation_id, entry_id) references public.journal_entries (organisation_id, id) on delete cascade,
  constraint journal_lines_gl_fkey foreign key (organisation_id, gl_code_id) references public.gl_codes (organisation_id, id) on delete restrict,
  constraint journal_lines_department_fkey foreign key (organisation_id, department_id) references public.departments (organisation_id, id) on delete restrict,
  constraint journal_lines_cost_centre_fkey foreign key (organisation_id, cost_centre_id) references public.cost_centres (organisation_id, id) on delete restrict,
  constraint journal_lines_currency_fkey foreign key (organisation_id, currency_id) references public.currencies (organisation_id, id) on delete restrict,
  constraint journal_lines_customer_fkey foreign key (organisation_id, customer_id) references public.customers (organisation_id, id) on delete restrict,
  constraint journal_lines_supplier_fkey foreign key (organisation_id, supplier_id) references public.suppliers (organisation_id, id) on delete restrict,
  constraint journal_lines_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint journal_lines_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null,
  constraint journal_lines_line_number_check check (line_number >= 1),
  constraint journal_lines_amount_check check (debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0))),
  constraint journal_lines_rate_check check (exchange_rate > 0),
  constraint journal_lines_party_check check (customer_id is null or supplier_id is null),
  constraint journal_lines_description_check check (description is null or char_length(description) <= 200)
);
comment on table public.journal_lines is 'A debit or a credit to one GL code, in the home currency, with the document currency amount and rate beside it.';

create index journal_lines_tenant_idx on public.journal_lines (tenant_id);
create index journal_lines_entry_idx on public.journal_lines (organisation_id, entry_id);
create index journal_lines_gl_idx on public.journal_lines (organisation_id, gl_code_id, entry_id);
create index journal_lines_department_idx on public.journal_lines (organisation_id, department_id);
create index journal_lines_cost_centre_idx on public.journal_lines (organisation_id, cost_centre_id);
create index journal_lines_currency_idx on public.journal_lines (organisation_id, currency_id);
create index journal_lines_customer_idx on public.journal_lines (organisation_id, customer_id);
create index journal_lines_supplier_idx on public.journal_lines (organisation_id, supplier_id);
create index journal_lines_created_by_idx on public.journal_lines (created_by);
create index journal_lines_updated_by_idx on public.journal_lines (updated_by);

-- Rules -------------------------------------------------------------------------------------------------------------------
create function private.enforce_ledger_scope() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_tenant uuid;
begin
  if tg_op = 'UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A ledger row cannot be moved to another organisation';
  end if;
  select tenant_id into v_tenant from public.organisations where id = new.organisation_id;
  if v_tenant is null or v_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_ledger_scope() from public, anon, authenticated, service_role;

create function private.enforce_journal_entry() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'posted' then
    raise exception 'A posted journal entry cannot be changed or deleted. Reverse it instead.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.status = 'posted'
     and current_setting('fintran.ledger_backfill', true) is distinct from 'on'
     and private.document_period_locked(new.organisation_id, new.entry_date) then
    raise exception 'This date is in a locked period';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_journal_entry() from public, anon, authenticated, service_role;

create function private.enforce_journal_line() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_status text;
  v_active boolean;
begin
  if tg_op = 'DELETE' then
    select status into v_status from public.journal_entries where organisation_id = old.organisation_id and id = old.entry_id;
    if v_status = 'posted' then
      raise exception 'A line of a posted journal entry cannot be changed or deleted';
    end if;
    return old;
  end if;

  select status into v_status from public.journal_entries where organisation_id = new.organisation_id and id = new.entry_id;
  if tg_op = 'UPDATE' and v_status = 'posted' then
    raise exception 'A line of a posted journal entry cannot be changed or deleted';
  end if;
  if tg_op = 'INSERT' and v_status = 'posted' and current_setting('fintran.ledger_post', true) is distinct from 'on' then
    raise exception 'A posted journal entry cannot be changed';
  end if;

  select active into v_active from public.gl_codes where organisation_id = new.organisation_id and id = new.gl_code_id;
  if v_active is distinct from true and current_setting('fintran.ledger_backfill', true) is distinct from 'on' then
    raise exception 'That GL code is inactive';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_journal_line() from public, anon, authenticated, service_role;

-- A posted entry has at least two lines and balances. Checked at the end of the transaction, so lines can be added one by one.
create function private.check_journal_balance() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_entry uuid;
  v_org uuid;
  v_status text;
  v_lines integer;
  v_debit numeric;
  v_credit numeric;
begin
  if tg_table_name = 'journal_entries' then
    v_entry := new.id; v_org := new.organisation_id;
  else
    v_entry := coalesce(new.entry_id, old.entry_id); v_org := coalesce(new.organisation_id, old.organisation_id);
  end if;
  select status into v_status from public.journal_entries where organisation_id = v_org and id = v_entry;
  if v_status is distinct from 'posted' then
    return null;
  end if;
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_lines, v_debit, v_credit
  from public.journal_lines where organisation_id = v_org and entry_id = v_entry;
  if v_lines < 2 then
    raise exception 'A posted journal entry needs at least two lines';
  end if;
  if v_debit is distinct from v_credit then
    raise exception 'The journal entry does not balance: debits %, credits %', v_debit, v_credit;
  end if;
  return null;
end;
$$;
revoke all on function private.check_journal_balance() from public, anon, authenticated, service_role;

create trigger journal_entries_scope before insert or update on public.journal_entries
  for each row execute function private.enforce_ledger_scope();
create trigger journal_entries_rules before insert or update or delete on public.journal_entries
  for each row execute function private.enforce_journal_entry();
create trigger zz_set_audit_columns before insert or update on public.journal_entries
  for each row execute function private.set_audit_columns();
create constraint trigger journal_entries_balance after insert or update on public.journal_entries
  deferrable initially deferred for each row execute function private.check_journal_balance();

create trigger journal_lines_scope before insert or update on public.journal_lines
  for each row execute function private.enforce_ledger_scope();
create trigger journal_lines_rules before insert or update or delete on public.journal_lines
  for each row execute function private.enforce_journal_line();
create trigger zz_set_audit_columns before insert or update on public.journal_lines
  for each row execute function private.set_audit_columns();
create constraint trigger journal_lines_balance after insert or update or delete on public.journal_lines
  deferrable initially deferred for each row execute function private.check_journal_balance();

-- Access: owners and admins read. Nobody writes directly. ----------------------------------------------------------------
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
create policy journal_entries_select on public.journal_entries for select to authenticated
  using ((select private.has_org_role(journal_entries.organisation_id, array['owner', 'admin'])));
create policy journal_lines_select on public.journal_lines for select to authenticated
  using ((select private.has_org_role(journal_lines.organisation_id, array['owner', 'admin'])));
revoke all on table public.journal_entries, public.journal_lines from anon;
revoke insert, update, delete on table public.journal_entries, public.journal_lines from authenticated;

-- A role account or a bank account that the ledger has used stays as it is. Any other account can still be made inactive. -------------------------------------------------
create function private.guard_used_gl_code() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if (new.system_role is distinct from old.system_role or (old.system_role is not null and old.active and not new.active))
     and exists (select 1 from public.journal_lines where organisation_id = old.organisation_id and gl_code_id = old.id) then
    raise exception 'That GL code has journal lines. Its role cannot change, and it cannot be made inactive.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_used_gl_code() from public, anon, authenticated, service_role;
create trigger gl_codes_used before update on public.gl_codes
  for each row execute function private.guard_used_gl_code();

create function private.guard_used_bank_gl_code() returns trigger
  language plpgsql security definer set search_path to ''
as $$
begin
  if new.gl_code_id is distinct from old.gl_code_id
     and exists (select 1 from public.journal_lines where organisation_id = old.organisation_id and gl_code_id = old.gl_code_id) then
    raise exception 'The GL code of this bank account has journal lines and cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_used_bank_gl_code() from public, anon, authenticated, service_role;
create trigger bank_accounts_gl_used before update of gl_code_id on public.bank_accounts
  for each row execute function private.guard_used_bank_gl_code();
