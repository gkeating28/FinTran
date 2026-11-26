-- General ledger, release B, phases 3 and 4: posting documents, payments and allocations (QULAPLUS_LEDGER_SPEC.md).
-- Entries are made by triggers on the status changes of documents and payments and on allocations, so every route to a
-- posted state is covered: the buttons, payment runs, imports, Ask Qula and the automatic credit note application. A failure
-- fails the whole action. This is shadow mode: a line with no usable GL code posts to the suspense account, nothing a person
-- does is refused that was allowed before, and release C turns the requirements on by changing private.ledger_strict().

-- Release C changes this to true.
create function private.ledger_strict() returns boolean
  language sql immutable set search_path to ''
as $$ select false $$;
revoke all on function private.ledger_strict() from public, anon, authenticated, service_role;

-- Spreading an amount over weights, in cents, by largest remainder. The parts add up to the total exactly. A tie goes to the
-- first weight. With no weight at all, the first part takes everything.
create function private.spread_cents(p_total numeric, p_weights numeric[]) returns numeric[]
  language plpgsql immutable set search_path to ''
as $$
declare
  v_n integer := coalesce(array_length(p_weights, 1), 0);
  v_sum numeric;
  v_result numeric[];
begin
  if v_n = 0 then
    return '{}'::numeric[];
  end if;
  select coalesce(sum(abs(w)), 0) into v_sum from unnest(p_weights) as w;
  if v_sum = 0 then
    return array[round(p_total, 2)] || array_fill(0::numeric, array[v_n - 1]);
  end if;
  with w as (
    select i, abs(wt) as wt from unnest(p_weights) with ordinality as t(wt, i)
  ), f as (
    select i, floor(abs(p_total) * wt / v_sum * 100) / 100 as fl, (abs(p_total) * wt / v_sum * 100) - floor(abs(p_total) * wt / v_sum * 100) as frac
    from w
  ), r as (
    select round((abs(round(p_total, 2)) - sum(fl)) * 100)::integer as leftover from f
  ), ranked as (
    select i, fl, row_number() over (order by frac desc, i) as rk from f
  )
  select array_agg((ranked.fl + case when ranked.rk <= (select leftover from r) then 0.01 else 0 end) * sign(p_total) order by ranked.i)
  into v_result
  from ranked;
  return v_result;
end;
$$;
revoke all on function private.spread_cents(numeric, numeric[]) from public, anon, authenticated, service_role;

-- The date a reversal takes: the entry's own date while that period is open and not exported, otherwise the day of the void.
create function private.reversal_date(p_organisation_id uuid, p_entry_date date, p_event_date date) returns date
  language sql stable security definer set search_path to ''
as $$
  select case
    when p_entry_date > coalesce(d.lock_date, '-infinity'::date) and p_entry_date > coalesce(d.exported_through, '-infinity'::date)
      then p_entry_date
    else p_event_date
  end
  from public.organisation_defaults as d
  where d.organisation_id = p_organisation_id
$$;
revoke all on function private.reversal_date(uuid, date, date) from public, anon, authenticated, service_role;

-- Writes one entry and its lines. Each line is a json object with: gl, dep, cc, amount (home, positive is a debit), ccy, rate,
-- foreign, customer, supplier, vat_category, vat_percentage, vat_taxable and desc. A line of nothing is left out. An entry with
-- no lines at all (a document worth nothing) is not made, and null comes back.
create function private.ledger_write_entry(
  p_tenant_id uuid, p_organisation_id uuid, p_date date, p_source_type text, p_description text, p_source_ref text,
  p_header uuid, p_payment uuid, p_allocation uuid, p_reverses uuid, p_backfilled boolean, p_lines jsonb
) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from jsonb_array_elements(p_lines) as l where (l->>'amount')::numeric <> 0) then
    return null;
  end if;
  perform set_config('fintran.ledger_post', 'on', true);
  insert into public.journal_entries (
    tenant_id, organisation_id, entry_number, entry_date, status, source_type, source_header_id, source_payment_id,
    source_allocation_id, reverses_entry_id, source_ref, description, backfilled, posted_at, posted_by
  ) values (
    p_tenant_id, p_organisation_id, private.next_entry_number(p_tenant_id, p_organisation_id), p_date, 'posted', p_source_type,
    p_header, p_payment, p_allocation, p_reverses, left(p_source_ref, 60), left(p_description, 200), p_backfilled, now(), (select auth.uid())
  ) returning id into v_id;

  insert into public.journal_lines (
    tenant_id, organisation_id, entry_id, line_number, gl_code_id, department_id, cost_centre_id, debit, credit,
    currency_id, exchange_rate, foreign_amount, customer_id, supplier_id, vat_category, vat_percentage, vat_taxable_home, description
  )
  select p_tenant_id, p_organisation_id, v_id, row_number() over (order by l.ord)::integer,
         (l.j->>'gl')::uuid, (l.j->>'dep')::uuid, (l.j->>'cc')::uuid,
         greatest((l.j->>'amount')::numeric, 0), greatest(-(l.j->>'amount')::numeric, 0),
         (l.j->>'ccy')::uuid, (l.j->>'rate')::numeric, (l.j->>'foreign')::numeric,
         (l.j->>'customer')::uuid, (l.j->>'supplier')::uuid,
         l.j->>'vat_category', (l.j->>'vat_percentage')::numeric, (l.j->>'vat_taxable')::numeric, left(l.j->>'desc', 200)
  from jsonb_array_elements(p_lines) with ordinality as l(j, ord)
  where (l.j->>'amount')::numeric <> 0;
  perform set_config('fintran.ledger_post', 'off', true);
  return v_id;
end;
$$;
revoke all on function private.ledger_write_entry(uuid, uuid, date, text, text, text, uuid, uuid, uuid, uuid, boolean, jsonb) from public, anon, authenticated, service_role;

-- The entry of a posted invoice or credit note. Lines and VAT are debits on a purchase invoice and a sales credit note, and
-- credits on a sales invoice and a purchase credit note. The control line takes the home total plus the home rounding amount, and
-- the rounding account takes whatever is left, so the entry always balances.
create function private.ledger_document_entry(p_header_id uuid, p_backfilled boolean default false) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  h public.transaction_headers%rowtype;
  v_type text;
  v_kind text;
  v_control uuid;
  v_vat uuid;
  v_round uuid;
  v_susp uuid;
  v_sign integer;
  v_lenient boolean := p_backfilled or not private.ledger_strict();
  v_lines jsonb := '[]'::jsonb;
  v_weights numeric[];
  v_spread numeric[];
  v_vat_spread numeric[];
  v_tax_spread numeric[];
  v_i integer := 0;
  v_ok boolean;
  v_sum numeric;
  v_label text;
  r record;
begin
  select * into h from public.transaction_headers where id = p_header_id;
  select tt.type, tt.document_kind::text into v_type, v_kind from public.transaction_types as tt where tt.id = h.transaction_type_id;
  select id into v_control from public.gl_codes where organisation_id = h.organisation_id
    and system_role = case when v_type = 'Sales' then 'debtors_control' else 'creditors_control' end;
  select id into v_vat from public.gl_codes where organisation_id = h.organisation_id
    and system_role = case when v_type = 'Sales' then 'vat_output' else 'vat_input' end;
  select id into v_round from public.gl_codes where organisation_id = h.organisation_id and system_role = 'rounding';
  select id into v_susp from public.gl_codes where organisation_id = h.organisation_id and system_role = 'suspense';
  if v_control is null or v_vat is null or v_round is null or v_susp is null then
    raise exception 'The organisation is missing one of its ledger accounts. Set them on the Accounting tab.';
  end if;
  v_sign := case when (v_type = 'Purchases') = (v_kind = 'invoice') then 1 else -1 end;

  select array_agg(nett_amount order by line_number) into v_weights from public.transaction_lines where header_id = h.id;
  v_spread := private.spread_cents(h.home_nett_amount, coalesce(v_weights, '{}'::numeric[]));
  for r in
    select l.*, g.id is not null and g.active as usable
    from public.transaction_lines as l
    left join public.gl_codes as g on g.id = l.gl_code_id and g.organisation_id = h.organisation_id
    where l.header_id = h.id
    order by l.line_number
  loop
    v_i := v_i + 1;
    v_ok := coalesce(r.usable, false);
    if not v_ok and not v_lenient then
      raise exception 'Line % has no GL code that can be used', r.line_number;
    end if;
    v_label := case when v_ok then '' when r.gl_code_id is null then ' (no GL code)' else ' (inactive GL code)' end;
    v_lines := v_lines || jsonb_build_object(
      'gl', case when v_ok then r.gl_code_id else v_susp end, 'dep', r.department_id, 'cc', r.cost_centre_id,
      'amount', v_sign * v_spread[v_i], 'ccy', h.currency_id, 'rate', h.exchange_rate, 'foreign', v_sign * r.nett_amount,
      'desc', coalesce(nullif(btrim(r.description), ''), h.document_number) || v_label);
  end loop;

  select array_agg(vat_amount order by vat_category, vat_percentage) into v_weights from public.transaction_vat_breakdown where header_id = h.id;
  v_vat_spread := private.spread_cents(h.home_vat_amount, coalesce(v_weights, '{}'::numeric[]));
  select array_agg(taxable_amount order by vat_category, vat_percentage) into v_weights from public.transaction_vat_breakdown where header_id = h.id;
  v_tax_spread := private.spread_cents(h.home_nett_amount, coalesce(v_weights, '{}'::numeric[]));
  v_i := 0;
  for r in select * from public.transaction_vat_breakdown where header_id = h.id order by vat_category, vat_percentage loop
    v_i := v_i + 1;
    v_lines := v_lines || jsonb_build_object(
      'gl', v_vat, 'amount', v_sign * v_vat_spread[v_i], 'ccy', h.currency_id, 'rate', h.exchange_rate, 'foreign', v_sign * r.vat_amount,
      'customer', h.customer_id, 'supplier', h.supplier_id, 'vat_category', r.vat_category, 'vat_percentage', r.vat_percentage,
      'vat_taxable', v_tax_spread[v_i], 'desc', 'VAT ' || h.document_number);
  end loop;

  v_lines := v_lines || jsonb_build_object(
    'gl', v_control, 'amount', -v_sign * (h.home_total_amount + round(h.rounding_amount / h.exchange_rate, 2)),
    'ccy', h.currency_id, 'rate', h.exchange_rate, 'foreign', -v_sign * (h.foreign_total_amount + h.rounding_amount),
    'customer', h.customer_id, 'supplier', h.supplier_id, 'desc', 'Total ' || h.document_number);

  select coalesce(sum((l->>'amount')::numeric), 0) into v_sum from jsonb_array_elements(v_lines) as l;
  if v_sum <> 0 then
    v_lines := v_lines || jsonb_build_object(
      'gl', v_round, 'amount', -v_sum, 'ccy', h.currency_id, 'rate', h.exchange_rate, 'foreign', v_sign * h.rounding_amount,
      'desc', 'Rounding ' || h.document_number);
  end if;

  return private.ledger_write_entry(
    h.tenant_id, h.organisation_id, h.transaction_date, 'document',
    (case when v_type = 'Sales' then 'Sales ' else 'Purchase ' end) || (case when v_kind = 'invoice' then 'invoice ' else 'credit note ' end)
      || h.document_number || ' ' || h.party_name,
    h.document_number, h.id, null, null, null, p_backfilled, v_lines);
end;
$$;
revoke all on function private.ledger_document_entry(uuid, boolean) from public, anon, authenticated, service_role;

-- The entry of a posted payment, receipt or refund. Money in debits the bank account and credits the control account, and money
-- out does the opposite. A migrated payment has no bank account, so its bank side goes to suspense.
create function private.ledger_payment_entry(p_payment_id uuid, p_backfilled boolean default false) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  p public.payments%rowtype;
  v_type text;
  v_kind text;
  v_control uuid;
  v_bank uuid;
  v_susp uuid;
  v_sign integer;
  v_label text;
  v_bank_label text := '';
begin
  select * into p from public.payments where id = p_payment_id;
  select tt.type, tt.document_kind::text into v_type, v_kind from public.transaction_types as tt where tt.id = p.transaction_type_id;
  select id into v_control from public.gl_codes where organisation_id = p.organisation_id
    and system_role = case when v_type = 'Sales' then 'debtors_control' else 'creditors_control' end;
  select id into v_susp from public.gl_codes where organisation_id = p.organisation_id and system_role = 'suspense';
  select gl_code_id into v_bank from public.bank_accounts where id = p.bank_account_id;
  if v_control is null or v_susp is null then
    raise exception 'The organisation is missing one of its ledger accounts. Set them on the Accounting tab.';
  end if;
  if v_bank is null then
    v_bank := v_susp;
    v_bank_label := ' (no bank account)';
  end if;
  v_sign := case when v_kind = 'receipt' then 1 else -1 end;
  v_label := case when v_type = 'Sales' and v_kind = 'receipt' then 'Customer receipt'
                  when v_type = 'Sales' then 'Customer refund'
                  when v_kind = 'receipt' then 'Supplier refund'
                  else 'Supplier payment' end;

  return private.ledger_write_entry(
    p.tenant_id, p.organisation_id, p.payment_date, 'payment', v_label || ' ' || coalesce(p.document_number, '') || ' ' || p.party_name,
    p.document_number, null, p.id, null, null, p_backfilled,
    jsonb_build_array(
      jsonb_build_object('gl', v_bank, 'amount', v_sign * p.home_amount, 'ccy', p.currency_id, 'rate', p.exchange_rate, 'foreign', v_sign * p.amount,
        'desc', coalesce(p.document_number, 'Payment') || ' ' || p.party_name || v_bank_label),
      jsonb_build_object('gl', v_control, 'amount', -v_sign * p.home_amount, 'ccy', p.currency_id, 'rate', p.exchange_rate, 'foreign', -v_sign * p.amount,
        'customer', p.customer_id, 'supplier', p.supplier_id, 'desc', coalesce(p.document_number, 'Payment') || ' ' || p.party_name)));
end;
$$;
revoke all on function private.ledger_payment_entry(uuid, boolean) from public, anon, authenticated, service_role;

-- The entry that clears the exchange difference of an allocation. A gain debits the control account of the target and credits
-- the exchange differences account, and a loss does the opposite.
create function private.ledger_allocation_entry(p_allocation_id uuid, p_backfilled boolean default false) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  a public.allocations%rowtype;
  v_type text;
  v_control uuid;
  v_fx uuid;
  v_home uuid;
  v_number text;
  v_customer uuid;
  v_supplier uuid;
begin
  select * into a from public.allocations where id = p_allocation_id;
  if a.exchange_difference is null or a.exchange_difference = 0 then
    return null;
  end if;
  select tt.type, h.customer_id, h.supplier_id into v_type, v_customer, v_supplier
  from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id
  where h.id = a.target_header_id;
  select id into v_control from public.gl_codes where organisation_id = a.organisation_id
    and system_role = case when v_type = 'Sales' then 'debtors_control' else 'creditors_control' end;
  select id into v_fx from public.gl_codes where organisation_id = a.organisation_id and system_role = 'fx_difference';
  select home_currency_id into v_home from public.organisation_defaults where organisation_id = a.organisation_id;
  if v_control is null or v_fx is null then
    raise exception 'The organisation is missing one of its ledger accounts. Set them on the Accounting tab.';
  end if;
  select coalesce(pay.document_number, src.document_number, '') into v_number
  from (select 1) as one
  left join public.payments as pay on pay.id = a.source_payment_id
  left join public.transaction_headers as src on src.id = a.source_header_id;

  return private.ledger_write_entry(
    a.tenant_id, a.organisation_id, a.allocation_date, 'allocation', 'Exchange difference ' || v_number, v_number,
    null, null, a.id, null, p_backfilled,
    jsonb_build_array(
      jsonb_build_object('gl', v_control, 'amount', a.exchange_difference, 'ccy', v_home, 'rate', 1, 'foreign', a.exchange_difference,
        'customer', v_customer, 'supplier', v_supplier, 'desc', 'Exchange difference ' || v_number),
      jsonb_build_object('gl', v_fx, 'amount', -a.exchange_difference, 'ccy', v_home, 'rate', 1, 'foreign', -a.exchange_difference,
        'desc', 'Exchange difference ' || v_number)));
end;
$$;
revoke all on function private.ledger_allocation_entry(uuid, boolean) from public, anon, authenticated, service_role;

-- A reversal turns round the lines of the entry, with the same accounts, dimensions, parties and VAT, and the signs of the
-- foreign amounts changed.
create function private.ledger_reverse_entry(p_entry_id uuid, p_date date, p_backfilled boolean default false) returns uuid
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
    e.source_header_id, e.source_payment_id, e.source_allocation_id, e.id, e.source_ref, left('Reversal: ' || e.description, 200),
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
revoke all on function private.ledger_reverse_entry(uuid, date, boolean) from public, anon, authenticated, service_role;

-- Triggers --------------------------------------------------------------------------------------------------------------
create function private.ledger_after_header() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_kind text;
  v_original public.journal_entries%rowtype;
begin
  select tt.document_kind::text into v_kind from public.transaction_types as tt where tt.id = new.transaction_type_id;
  if v_kind not in ('invoice', 'credit_note') then
    return null;
  end if;
  if new.status = 'posted' then
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
revoke all on function private.ledger_after_header() from public, anon, authenticated, service_role;
create trigger zz_ledger_post after update of status on public.transaction_headers
  for each row when (old.status is distinct from new.status and new.status in ('posted', 'void'))
  execute function private.ledger_after_header();

create function private.ledger_after_payment() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_original public.journal_entries%rowtype;
begin
  if new.status = 'posted' then
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
revoke all on function private.ledger_after_payment() from public, anon, authenticated, service_role;
create trigger zz_ledger_post after update of status on public.payments
  for each row when (old.status is distinct from new.status and new.status in ('posted', 'void'))
  execute function private.ledger_after_payment();

create function private.ledger_after_allocation() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_original public.journal_entries%rowtype;
begin
  if new.pending or new.exchange_difference is null or new.exchange_difference = 0 then
    return null;
  end if;
  if new.removed_at is null and (tg_op = 'INSERT' or old.pending) then
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
revoke all on function private.ledger_after_allocation() from public, anon, authenticated, service_role;
create trigger zz_ledger_post after insert or update of pending, removed_at on public.allocations
  for each row execute function private.ledger_after_allocation();
