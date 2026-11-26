-- General ledger, release C, phase 8: what the Ledger screens read (QULAPLUS_LEDGER_SPEC.md).
-- These only read journal entries and lines, and only for owners and admins (L12). They calculate nothing the entries do not
-- already hold: a balance is a sum of debits less credits, in the home currency.

-- The journals grid: a page of entries with their total, whether they have been reversed, and where they came from.
create function public.ledger_journals(
  p_organisation_id uuid, p_from date default null, p_to date default null, p_source text default null,
  p_gl_code_id uuid default null, p_limit integer default 50, p_offset integer default 0
) returns table (
  entry_id uuid, entry_number bigint, entry_date date, status text, source_type text, source_ref text, description text,
  total numeric, is_opening boolean, reversed boolean, reverses_entry_id uuid, type_code text, open_id uuid, total_count bigint
)
  language plpgsql stable security definer set search_path to ''
as $$
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  return query
  with picked as (
    select e.*
    from public.journal_entries as e
    where e.organisation_id = p_organisation_id
      and (p_from is null or e.entry_date >= p_from)
      and (p_to is null or e.entry_date <= p_to)
      and (p_source is null or e.source_type = p_source)
      and (p_gl_code_id is null or exists (select 1 from public.journal_lines as l where l.organisation_id = e.organisation_id and l.entry_id = e.id and l.gl_code_id = p_gl_code_id))
  ), counted as (
    select count(*) as n from picked
  )
  select e.id, e.entry_number, e.entry_date, e.status, e.source_type, e.source_ref, e.description,
         coalesce((select sum(l.debit) from public.journal_lines as l where l.organisation_id = e.organisation_id and l.entry_id = e.id), 0),
         e.is_opening,
         exists (select 1 from public.journal_entries as r where r.organisation_id = e.organisation_id and r.reverses_entry_id = e.id),
         e.reverses_entry_id,
         coalesce(
           (select tt.code from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id where h.id = e.source_header_id),
           (select tt.code from public.payments as p join public.transaction_types as tt on tt.id = p.transaction_type_id where p.id = e.source_payment_id),
           (select tt.code from public.allocations as a join public.payments as p on p.id = a.source_payment_id join public.transaction_types as tt on tt.id = p.transaction_type_id where a.id = e.source_allocation_id)
         ),
         coalesce(e.source_header_id, e.source_payment_id,
           (select a.source_payment_id from public.allocations as a where a.id = e.source_allocation_id)),
         (select n from counted)
  from picked as e
  order by e.entry_date desc, e.entry_number desc nulls first
  limit greatest(least(p_limit, 500), 1) offset greatest(p_offset, 0);
end;
$$;
revoke all on function public.ledger_journals(uuid, date, date, text, uuid, integer, integer) from public, anon;
grant execute on function public.ledger_journals(uuid, date, date, text, uuid, integer, integer) to authenticated;

-- The trial balance for a range: each GL code with its opening balance (everything before the range), the debits and credits in
-- it and its closing balance. Balances are debits less credits. Department and cost centre narrow every figure, opening included.
create function public.trial_balance(
  p_organisation_id uuid, p_from date, p_to date, p_department_id uuid default null, p_cost_centre_id uuid default null
) returns table (gl_code_id uuid, code text, description text, account_type text, opening numeric, debit numeric, credit numeric, closing numeric)
  language plpgsql stable security definer set search_path to ''
as $$
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a range that starts on or before it ends';
  end if;
  return query
  select g.id, g.code, g.description, g.account_type,
         coalesce(sum(l.debit - l.credit) filter (where e.entry_date < p_from), 0),
         coalesce(sum(l.debit) filter (where e.entry_date >= p_from), 0),
         coalesce(sum(l.credit) filter (where e.entry_date >= p_from), 0),
         coalesce(sum(l.debit - l.credit), 0)
  from public.journal_lines as l
  join public.journal_entries as e on e.organisation_id = l.organisation_id and e.id = l.entry_id
  join public.gl_codes as g on g.organisation_id = l.organisation_id and g.id = l.gl_code_id
  where l.organisation_id = p_organisation_id
    and e.status = 'posted'
    and e.entry_date <= p_to
    and (p_department_id is null or l.department_id = p_department_id)
    and (p_cost_centre_id is null or l.cost_centre_id = p_cost_centre_id)
  group by g.id, g.code, g.description, g.account_type
  order by g.code;
end;
$$;
revoke all on function public.trial_balance(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.trial_balance(uuid, date, date, uuid, uuid) to authenticated;

-- One account's lines in a range, with the running balance starting from its opening balance. The last balance is the closing
-- figure of the trial balance for the same range and filters.
create function public.account_enquiry(
  p_organisation_id uuid, p_gl_code_id uuid, p_from date, p_to date, p_department_id uuid default null, p_cost_centre_id uuid default null
) returns table (
  entry_id uuid, entry_number bigint, entry_date date, source_ref text, description text, debit numeric, credit numeric, balance numeric
)
  language plpgsql stable security definer set search_path to ''
as $$
declare
  v_opening numeric;
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a range that starts on or before it ends';
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_opening
  from public.journal_lines as l
  join public.journal_entries as e on e.organisation_id = l.organisation_id and e.id = l.entry_id
  where l.organisation_id = p_organisation_id and l.gl_code_id = p_gl_code_id and e.status = 'posted' and e.entry_date < p_from
    and (p_department_id is null or l.department_id = p_department_id)
    and (p_cost_centre_id is null or l.cost_centre_id = p_cost_centre_id);
  return query
  select e.id, e.entry_number, e.entry_date, e.source_ref, coalesce(l.description, e.description), l.debit, l.credit,
         v_opening + sum(l.debit - l.credit) over (order by e.entry_date, e.entry_number, l.line_number)
  from public.journal_lines as l
  join public.journal_entries as e on e.organisation_id = l.organisation_id and e.id = l.entry_id
  where l.organisation_id = p_organisation_id and l.gl_code_id = p_gl_code_id and e.status = 'posted'
    and e.entry_date >= p_from and e.entry_date <= p_to
    and (p_department_id is null or l.department_id = p_department_id)
    and (p_cost_centre_id is null or l.cost_centre_id = p_cost_centre_id)
  order by e.entry_date, e.entry_number, l.line_number;
end;
$$;
revoke all on function public.account_enquiry(uuid, uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.account_enquiry(uuid, uuid, date, date, uuid, uuid) to authenticated;
