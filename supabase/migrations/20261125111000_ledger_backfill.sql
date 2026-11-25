-- General ledger, release B, phase 5: the backfill, the reconciliation and the review list (QULAPLUS_LEDGER_SPEC.md).
-- The backfill posts every document, payment and allocation that was posted before the ledger existed. It is a function, so it
-- can be rehearsed and run again, and it posts nothing twice. This migration runs it for every organisation.

-- Which stored entry a journal export row matches, so nothing that was exported is sent again.
alter table public.journal_exports
  add column entry_id uuid,
  add constraint journal_exports_entry_fkey foreign key (organisation_id, entry_id) references public.journal_entries (organisation_id, id) on delete restrict;
create index journal_exports_entry_idx on public.journal_exports (organisation_id, entry_id);
comment on column public.journal_exports.entry_id is 'The ledger entry this row exported. Set by the backfill for batches made before the ledger, and by the export from then on.';

-- Documents whose home figures do not add up, so a journal cannot be built from them. Posted documents are never changed to fit.
create function private.ledger_backfill_problems(p_organisation_id uuid) returns text
  language plpgsql stable security definer set search_path to ''
as $$
declare
  v_problems text := '';
  r record;
begin
  for r in
    select h.document_number, h.home_total_amount, h.home_nett_amount, h.home_vat_amount
    from public.transaction_headers as h
    join public.transaction_types as tt on tt.id = h.transaction_type_id
    where h.organisation_id = p_organisation_id
      and h.status in ('posted', 'void')
      and tt.document_kind in ('invoice', 'credit_note')
      and abs(h.home_total_amount - h.home_nett_amount - h.home_vat_amount) > 0.05
    order by h.document_number
  loop
    v_problems := v_problems || format(E'\n  %s: home total %s, nett %s and VAT %s', r.document_number, r.home_total_amount, r.home_nett_amount, r.home_vat_amount);
  end loop;
  return v_problems;
end;
$$;
revoke all on function private.ledger_backfill_problems(uuid) from public, anon, authenticated, service_role;

create function private.ledger_backfill(p_organisation_id uuid) returns text
  language plpgsql security definer set search_path to ''
as $$
declare
  v_problems text := private.ledger_backfill_problems(p_organisation_id);
  r record;
  v_original uuid;
  v_posted integer := 0;
  v_reversed integer := 0;
begin
  if v_problems <> '' then
    raise exception E'The ledger cannot be backfilled until these documents are looked at:%', v_problems;
  end if;
  perform set_config('fintran.ledger_backfill', 'on', true);

  for r in
    select * from (
      select h.transaction_date as d, 1 as ord, 'doc_post' as kind, h.id, h.created_at as c
      from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id
      where h.organisation_id = p_organisation_id and h.status in ('posted', 'void') and tt.document_kind in ('invoice', 'credit_note')
      union all
      select h.voided_at::date, 2, 'doc_rev', h.id, h.voided_at
      from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id
      where h.organisation_id = p_organisation_id and h.status = 'void' and tt.document_kind in ('invoice', 'credit_note')
      union all
      select p.payment_date, 3, 'pay_post', p.id, coalesce(p.posted_at, p.created_at)
      from public.payments as p where p.organisation_id = p_organisation_id and p.status in ('posted', 'void')
      union all
      select p.voided_at::date, 4, 'pay_rev', p.id, p.voided_at
      from public.payments as p where p.organisation_id = p_organisation_id and p.status = 'void'
      union all
      select a.allocation_date, 5, 'alloc_post', a.id, a.created_at
      from public.allocations as a where a.organisation_id = p_organisation_id and not a.pending and a.exchange_difference <> 0
      union all
      select a.removed_at::date, 6, 'alloc_rev', a.id, a.removed_at
      from public.allocations as a where a.organisation_id = p_organisation_id and not a.pending and a.exchange_difference <> 0 and a.removed_at is not null
    ) as e
    order by e.d, e.ord, e.c, e.id
  loop
    if r.kind = 'doc_post' then
      if not exists (select 1 from public.journal_entries where organisation_id = p_organisation_id and source_type = 'document' and source_header_id = r.id) then
        if private.ledger_document_entry(r.id, true) is not null then v_posted := v_posted + 1; end if;
      end if;
    elsif r.kind = 'pay_post' then
      if not exists (select 1 from public.journal_entries where organisation_id = p_organisation_id and source_type = 'payment' and source_payment_id = r.id) then
        if private.ledger_payment_entry(r.id, true) is not null then v_posted := v_posted + 1; end if;
      end if;
    elsif r.kind = 'alloc_post' then
      if not exists (select 1 from public.journal_entries where organisation_id = p_organisation_id and source_type = 'allocation' and source_allocation_id = r.id) then
        if private.ledger_allocation_entry(r.id, true) is not null then v_posted := v_posted + 1; end if;
      end if;
    else
      select id into v_original from public.journal_entries
      where organisation_id = p_organisation_id and source_type = case r.kind when 'doc_rev' then 'document' when 'pay_rev' then 'payment' else 'allocation' end
        and case r.kind when 'doc_rev' then source_header_id when 'pay_rev' then source_payment_id else source_allocation_id end = r.id;
      if v_original is not null
         and not exists (select 1 from public.journal_entries where organisation_id = p_organisation_id and reverses_entry_id = v_original) then
        perform private.ledger_reverse_entry(v_original, r.d, true);
        v_reversed := v_reversed + 1;
      end if;
    end if;
  end loop;

  -- What an earlier journal batch already sent is marked as exported, so the next batch does not send it again.
  update public.journal_exports as e set entry_id = x.id
  from public.journal_entries as x
  where e.organisation_id = p_organisation_id and e.entry_id is null and x.organisation_id = p_organisation_id
    and (
      (e.stage = 'post' and (
        (e.source_ref = 'document' and x.source_type = 'document' and x.source_header_id = e.source_id) or
        (e.source_ref = 'payment' and x.source_type = 'payment' and x.source_payment_id = e.source_id) or
        (e.source_ref = 'allocation' and x.source_type = 'allocation' and x.source_allocation_id = e.source_id)))
      or
      (e.stage = 'reversal' and x.source_type = 'reversal' and (
        (e.source_ref = 'document' and x.source_header_id = e.source_id) or
        (e.source_ref = 'payment' and x.source_payment_id = e.source_id) or
        (e.source_ref = 'allocation' and x.source_allocation_id = e.source_id)))
    );
  perform set_config('fintran.ledger_admin', 'on', true);
  update public.organisation_defaults as d
  set exported_through = b.up_to
  from (select max(up_to) as up_to from public.journal_batches where organisation_id = p_organisation_id) as b
  where d.organisation_id = p_organisation_id and b.up_to is not null and (d.exported_through is null or d.exported_through < b.up_to);
  perform set_config('fintran.ledger_admin', 'off', true);
  perform set_config('fintran.ledger_backfill', 'off', true);
  return format('%s entries posted and %s reversals', v_posted, v_reversed);
end;
$$;
revoke all on function private.ledger_backfill(uuid) from public, anon, authenticated, service_role;

create function public.ledger_backfill(p_organisation_id uuid) returns text
  language plpgsql security definer set search_path to ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before backfilling the ledger';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to backfill the ledger';
  end if;
  return private.ledger_backfill(p_organisation_id);
end;
$$;
revoke all on function public.ledger_backfill(uuid) from public, anon;
grant execute on function public.ledger_backfill(uuid) to authenticated;

-- Lines that went to the suspense account, for review -------------------------------------------------------------------
create function public.ledger_suspense_lines(p_organisation_id uuid)
returns table (entry_id uuid, entry_number bigint, entry_date date, source_type text, source_ref text, description text, debit numeric, credit numeric)
  language plpgsql stable security definer set search_path to ''
as $$
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  return query
    select e.id, e.entry_number, e.entry_date, e.source_type, e.source_ref, l.description, l.debit, l.credit
    from public.journal_lines as l
    join public.journal_entries as e on e.id = l.entry_id
    join public.gl_codes as g on g.id = l.gl_code_id
    where l.organisation_id = p_organisation_id and g.system_role = 'suspense'
    order by e.entry_date, e.entry_number, l.line_number;
end;
$$;
revoke all on function public.ledger_suspense_lines(uuid) from public, anon;
grant execute on function public.ledger_suspense_lines(uuid) to authenticated;

-- The reconciliation -----------------------------------------------------------------------------------------------------
create function public.ledger_reconciliation(p_organisation_id uuid)
returns table (check_name text, ledger_amount numeric, subledger_amount numeric, difference numeric)
  language plpgsql stable security definer set search_path to ''
as $$
declare
  v_debtors uuid;
  v_creditors uuid;
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  select id into v_debtors from public.gl_codes where organisation_id = p_organisation_id and system_role = 'debtors_control';
  select id into v_creditors from public.gl_codes where organisation_id = p_organisation_id and system_role = 'creditors_control';

  return query
  with rows as (
    select 'Debtors'::text as check_name,
      (select coalesce(sum(l.debit - l.credit), 0) from public.journal_lines as l where l.organisation_id = p_organisation_id and l.gl_code_id = v_debtors) as ledger_amount,
      (select coalesce(sum(case tt.document_kind when 'invoice' then h.home_amount_due + round(h.rounding_amount / h.exchange_rate, 2) else -(h.home_amount_due + round(h.rounding_amount / h.exchange_rate, 2)) end), 0)
         from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id
         where h.organisation_id = p_organisation_id and h.status = 'posted' and tt.type = 'Sales' and tt.document_kind in ('invoice', 'credit_note'))
      - (select coalesce(sum(case tt.document_kind when 'receipt' then p.home_unallocated_amount else -p.home_unallocated_amount end), 0)
         from public.payments as p join public.transaction_types as tt on tt.id = p.transaction_type_id
         where p.organisation_id = p_organisation_id and p.status = 'posted' and tt.type = 'Sales') as subledger_amount
    union all
    select 'Creditors',
      (select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines as l where l.organisation_id = p_organisation_id and l.gl_code_id = v_creditors),
      (select coalesce(sum(case tt.document_kind when 'invoice' then h.home_amount_due + round(h.rounding_amount / h.exchange_rate, 2) else -(h.home_amount_due + round(h.rounding_amount / h.exchange_rate, 2)) end), 0)
         from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id
         where h.organisation_id = p_organisation_id and h.status = 'posted' and tt.type = 'Purchases' and tt.document_kind in ('invoice', 'credit_note'))
      - (select coalesce(sum(case tt.document_kind when 'payment' then p.home_unallocated_amount else -p.home_unallocated_amount end), 0)
         from public.payments as p join public.transaction_types as tt on tt.id = p.transaction_type_id
         where p.organisation_id = p_organisation_id and p.status = 'posted' and tt.type = 'Purchases')
    union all
    select 'Bank ' || b.code,
      (select coalesce(sum(l.debit - l.credit), 0)
         from public.journal_lines as l join public.journal_entries as e on e.id = l.entry_id
         where l.organisation_id = p_organisation_id and l.gl_code_id = b.gl_code_id and e.source_type <> 'manual'
           and not (e.source_type = 'reversal' and e.source_header_id is null and e.source_payment_id is null and e.source_allocation_id is null)),
      (select coalesce(sum(case tt.document_kind when 'receipt' then p.home_amount else -p.home_amount end), 0)
         from public.payments as p join public.transaction_types as tt on tt.id = p.transaction_type_id
         where p.organisation_id = p_organisation_id and p.status = 'posted' and p.bank_account_id = b.id)
    from public.bank_accounts as b
    where b.organisation_id = p_organisation_id
    union all
    select 'Balance',
      (select coalesce(sum(l.debit), 0) from public.journal_lines as l where l.organisation_id = p_organisation_id),
      (select coalesce(sum(l.credit), 0) from public.journal_lines as l where l.organisation_id = p_organisation_id)
  )
  select r.check_name, r.ledger_amount, r.subledger_amount, r.ledger_amount - r.subledger_amount from rows as r order by r.check_name;
end;
$$;
revoke all on function public.ledger_reconciliation(uuid) from public, anon;
grant execute on function public.ledger_reconciliation(uuid) to authenticated;

-- Run it for every organisation, and list what needs review. A problem stops the migration and changes nothing.
do $$
declare
  r record;
  v_summary text;
  v_review integer;
begin
  for r in select id, name from public.organisations order by created_at, id loop
    v_summary := private.ledger_backfill(r.id);
    select count(*) into v_review from public.journal_lines as l join public.gl_codes as g on g.id = l.gl_code_id
      where l.organisation_id = r.id and g.system_role = 'suspense';
    raise notice 'Organisation %: % (% lines on suspense to review)', r.name, v_summary, v_review;
  end loop;
end $$;
