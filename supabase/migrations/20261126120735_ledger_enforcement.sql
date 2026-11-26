-- General ledger, release C, phases 6 and 7a: the requirements switch on, the period rules and the mode switch (QULAPLUS_LEDGER_SPEC.md).
-- Until now the ledger was in shadow mode: a line with no usable GL code posted to suspense and nothing was refused that was
-- allowed before. From here an invoice or credit note with a line that has no usable GL code cannot be posted, a posting dated in
-- an exported period is refused while lock_exported is on, and the mode of an organisation changes only through set_ledger_mode.

-- 1. The requirements are on. The backfill passes its own flag and stays lenient: history is what it was.
create or replace function private.ledger_strict() returns boolean
  language sql immutable set search_path to ''
as $$ select true $$;

-- New organisations are books of record. Existing organisations keep the mode they have.
alter table public.organisation_defaults
  alter column ledger_mode set default 'book',
  alter column lock_exported set default false;

-- 2. The lines of a document that have no GL code that can be used, as text for a message: "2, 5". Null when there are none.
create function private.ledger_unusable_lines(p_header_id uuid) returns text
  language sql stable security definer set search_path to ''
as $$
  select string_agg(l.line_number::text, ', ' order by l.line_number)
  from public.transaction_headers as h
  join public.transaction_lines as l on l.header_id = h.id
  left join public.gl_codes as g on g.id = l.gl_code_id and g.organisation_id = h.organisation_id
  where h.id = p_header_id and (g.id is null or not g.active)
$$;
revoke all on function private.ledger_unusable_lines(uuid) from public, anon, authenticated, service_role;

-- The same finding for the readiness panel, beside the e-invoice rules. An error in both directions.
create function public.ledger_readiness(p_header_id uuid) returns table (rule_id text, severity text, business_term text, message text)
  language plpgsql stable security definer set search_path to ''
as $$
declare
  v_org uuid;
  v_kind text;
  v_lines text;
begin
  select h.organisation_id, tt.document_kind::text into v_org, v_kind
  from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id
  where h.id = p_header_id;
  if v_org is null or not (select private.is_org_member(v_org)) or v_kind not in ('invoice', 'credit_note') then
    return;
  end if;
  v_lines := private.ledger_unusable_lines(p_header_id);
  if v_lines is not null then
    rule_id := 'LEDGER-GL'; severity := 'error'; business_term := 'BG-25';
    message := 'Every line needs a GL code that is in use. Choose one on line ' || v_lines || '.';
    return next;
  end if;
end;
$$;
revoke all on function public.ledger_readiness(uuid) from public, anon;
grant execute on function public.ledger_readiness(uuid) to authenticated;

-- 3. A posting dated in a period that has been exported is refused while lock_exported is on. Voids and removals never come here.
create function private.check_not_exported(p_organisation_id uuid, p_date date) returns void
  language plpgsql stable security definer set search_path to ''
as $$
declare
  v_lock boolean;
  v_through date;
begin
  select lock_exported, exported_through into v_lock, v_through from public.organisation_defaults where organisation_id = p_organisation_id;
  if v_lock and v_through is not null and p_date <= v_through then
    raise exception 'This date is in a period that has been exported. Use a later date.';
  end if;
end;
$$;
revoke all on function private.check_not_exported(uuid, date) from public, anon, authenticated, service_role;

-- 4. The lock date does not stop the opening figures. Until the opening balance journal is posted, a date before go-live is open,
-- so opening debtors and creditors can be entered as ordinary documents and payments. After it, the lock date applies as before.
create or replace function private.document_period_locked(p_organisation_id uuid, p_transaction_date date) returns boolean
  language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
    from public.organisation_defaults as d
    where d.organisation_id = p_organisation_id
      and d.lock_date is not null
      and p_transaction_date <= d.lock_date
      and not (
        d.ledger_start_date is not null
        and p_transaction_date < d.ledger_start_date
        and not exists (select 1 from public.journal_entries as e where e.organisation_id = p_organisation_id and e.is_opening)
      )
  );
$$;

create or replace function private.enforce_journal_entry() returns trigger
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
     and not new.is_opening
     and current_setting('fintran.ledger_backfill', true) is distinct from 'on'
     and private.document_period_locked(new.organisation_id, new.entry_date) then
    raise exception 'This date is in a locked period';
  end if;
  return new;
end;
$$;

-- 5. The go-live date does not move once the opening balance journal is posted.
create or replace function private.guard_ledger_columns() returns trigger
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
  if tg_op = 'UPDATE' and new.ledger_start_date is distinct from old.ledger_start_date
     and exists (select 1 from public.journal_entries where organisation_id = old.organisation_id and is_opening) then
    raise exception 'The go-live date cannot change once the opening balance journal is posted';
  end if;
  return new;
end;
$$;

-- 6. A reversal can carry its own description. A manual journal is reversed with the text the person gives.
drop function private.ledger_reverse_entry(uuid, date, boolean);
create function private.ledger_reverse_entry(p_entry_id uuid, p_date date, p_backfilled boolean default false, p_description text default null) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  e public.journal_entries%rowtype;
  v_id uuid;
begin
  select * into e from public.journal_entries where id = p_entry_id;
  if e.id is null then
    raise exception 'That journal entry could not be found';
  end if;
  perform set_config('fintran.ledger_post', 'on', true);
  insert into public.journal_entries (
    tenant_id, organisation_id, entry_number, entry_date, status, source_type, source_header_id, source_payment_id,
    source_allocation_id, reverses_entry_id, source_ref, description, backfilled, posted_at, posted_by
  ) values (
    e.tenant_id, e.organisation_id, private.next_entry_number(e.tenant_id, e.organisation_id), p_date, 'posted', 'reversal',
    e.source_header_id, e.source_payment_id, e.source_allocation_id, e.id, e.source_ref,
    left(coalesce(nullif(btrim(p_description), ''), 'Reversal: ' || e.description), 200),
    p_backfilled, now(), (select auth.uid())
  ) returning id into v_id;
  insert into public.journal_lines (
    tenant_id, organisation_id, entry_id, line_number, gl_code_id, department_id, cost_centre_id, debit, credit,
    currency_id, exchange_rate, foreign_amount, customer_id, supplier_id, vat_category, vat_percentage, vat_taxable_home, description
  )
  select l.tenant_id, l.organisation_id, v_id, l.line_number, l.gl_code_id, l.department_id, l.cost_centre_id, l.credit, l.debit,
         l.currency_id, l.exchange_rate, -l.foreign_amount, l.customer_id, l.supplier_id, l.vat_category, l.vat_percentage,
         l.vat_taxable_home, l.description
  from public.journal_lines as l
  where l.entry_id = e.id;
  perform set_config('fintran.ledger_post', 'off', true);
  return v_id;
end;
$$;
revoke all on function private.ledger_reverse_entry(uuid, date, boolean, text) from public, anon, authenticated, service_role;

-- 7. The triggers, with the two new refusals. The period check comes first so a refused date builds nothing.
create or replace function private.ledger_after_header() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_kind text;
  v_lines text;
  v_original public.journal_entries%rowtype;
begin
  select tt.document_kind::text into v_kind from public.transaction_types as tt where tt.id = new.transaction_type_id;
  if v_kind not in ('invoice', 'credit_note') then
    return null;
  end if;
  if new.status = 'posted' then
    perform private.check_not_exported(new.organisation_id, new.transaction_date);
    v_lines := private.ledger_unusable_lines(new.id);
    if v_lines is not null then
      raise exception 'Every line needs a GL code that is in use. Choose one on line %.', v_lines;
    end if;
    perform private.ledger_document_entry(new.id);
  elsif new.status = 'void' then
    select * into v_original from public.journal_entries where organisation_id = new.organisation_id and source_header_id = new.id and source_type = 'document';
    if v_original.id is not null then
      perform private.ledger_reverse_entry(v_original.id, private.reversal_date(new.organisation_id, v_original.entry_date, coalesce(new.voided_at::date, current_date)));
    elsif private.ledger_strict() then
      raise exception 'The ledger has no entry to reverse for this document';
    end if;
  end if;
  return null;
end;
$$;

create or replace function private.ledger_after_payment() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_original public.journal_entries%rowtype;
begin
  if new.status = 'posted' then
    perform private.check_not_exported(new.organisation_id, new.payment_date);
    perform private.ledger_payment_entry(new.id);
  elsif new.status = 'void' then
    select * into v_original from public.journal_entries where organisation_id = new.organisation_id and source_payment_id = new.id and source_type = 'payment';
    if v_original.id is not null then
      perform private.ledger_reverse_entry(v_original.id, private.reversal_date(new.organisation_id, v_original.entry_date, coalesce(new.voided_at::date, current_date)));
    elsif private.ledger_strict() then
      raise exception 'The ledger has no entry to reverse for this payment';
    end if;
  end if;
  return null;
end;
$$;

-- Only an allocation that makes an entry (an exchange difference) is dated into the ledger, so only that one meets the period rule.
create or replace function private.ledger_after_allocation() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_original public.journal_entries%rowtype;
begin
  if new.pending or new.exchange_difference is null or new.exchange_difference = 0 then
    return null;
  end if;
  if new.removed_at is null and (tg_op = 'INSERT' or old.pending) then
    perform private.check_not_exported(new.organisation_id, new.allocation_date);
    perform private.ledger_allocation_entry(new.id);
  elsif tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then
    select * into v_original from public.journal_entries where organisation_id = new.organisation_id and source_allocation_id = new.id and source_type = 'allocation';
    if v_original.id is not null then
      perform private.ledger_reverse_entry(v_original.id, private.reversal_date(new.organisation_id, v_original.entry_date, new.removed_at::date));
    elsif private.ledger_strict() then
      raise exception 'The ledger has no entry to reverse for this allocation';
    end if;
  end if;
  return null;
end;
$$;

-- 8. Postings dated in an exported period since the last export, for the owner to see when lock_exported is off.
create function public.ledger_exported_postings(p_organisation_id uuid)
returns table (entry_id uuid, entry_number bigint, entry_date date, source_ref text, description text)
  language plpgsql stable security definer set search_path to ''
as $$
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  return query
  select e.id, e.entry_number, e.entry_date, e.source_ref, e.description
  from public.journal_entries as e
  join public.organisation_defaults as d on d.organisation_id = e.organisation_id
  where e.organisation_id = p_organisation_id
    and e.status = 'posted'
    and e.source_type in ('document', 'payment', 'allocation')
    and not e.backfilled
    and d.exported_through is not null
    and e.entry_date <= d.exported_through
    and e.posted_at > coalesce((select max(b.created_at) from public.journal_batches as b where b.organisation_id = p_organisation_id), '-infinity'::timestamptz)
  order by e.entry_number;
end;
$$;
revoke all on function public.ledger_exported_postings(uuid) from public, anon;
grant execute on function public.ledger_exported_postings(uuid) to authenticated;

-- 9. The mode switch. Owners only. The reason is kept in the audit log. Going to book needs a go-live date, a lock date no later
-- than the day before it, and the opening balance journal. Without the journal, the reason is the recorded waiver. Going back to
-- feed needs a lock date and no draft manual journals.
create function public.set_ledger_mode(p_organisation_id uuid, p_mode text, p_reason text) returns void
  language plpgsql security definer set search_path to ''
as $$
declare
  d public.organisation_defaults%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_opening boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before changing the ledger mode';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner'])) then
    raise exception 'Only an owner can change the ledger mode';
  end if;
  if p_mode not in ('feed', 'book') then
    raise exception 'The mode is feed or book';
  end if;
  if v_reason = '' then
    raise exception 'Give a reason for the change';
  end if;
  select * into d from public.organisation_defaults where organisation_id = p_organisation_id for update;
  if d.organisation_id is null then
    raise exception 'That organisation could not be found';
  end if;
  if d.ledger_mode = p_mode then
    raise exception 'The organisation is already in % mode', p_mode;
  end if;
  v_opening := exists (select 1 from public.journal_entries where organisation_id = p_organisation_id and is_opening);

  if p_mode = 'book' then
    if d.ledger_start_date is null then
      raise exception 'Set the go-live date before switching to book mode';
    end if;
    if d.lock_date is not null and d.lock_date > d.ledger_start_date - 1 then
      raise exception 'The lock date is after the day before go-live. Move the lock date back first.';
    end if;
  else
    if d.lock_date is null then
      raise exception 'Set a lock date before switching back to feed mode';
    end if;
    if exists (select 1 from public.journal_entries where organisation_id = p_organisation_id and status = 'draft') then
      raise exception 'Post or delete the draft manual journals before switching back to feed mode';
    end if;
  end if;

  perform set_config('fintran.ledger_admin', 'on', true);
  update public.organisation_defaults set ledger_mode = p_mode where organisation_id = p_organisation_id;
  perform set_config('fintran.ledger_admin', 'off', true);

  insert into public.audit_log (table_name, row_id, action, new_values, changed_by, tenant_id, organisation_id)
  values ('organisation_defaults', p_organisation_id::text, 'UPDATE',
    jsonb_build_object('event', 'ledger_mode_changed', 'from', d.ledger_mode, 'to', p_mode, 'reason', v_reason,
      'opening_journal_waived', p_mode = 'book' and not v_opening),
    (select auth.uid()), d.tenant_id, p_organisation_id);
end;
$$;
revoke all on function public.set_ledger_mode(uuid, text, text) from public, anon;
grant execute on function public.set_ledger_mode(uuid, text, text) to authenticated;
