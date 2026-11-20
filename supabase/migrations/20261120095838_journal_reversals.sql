-- Journal export: a reversal inverts the lines that were exported (QULAPLUS_JOURNAL_EXPORT_SPEC.md, J10).
-- The first version rebuilt a reversal from the current accounting settings and the bank account's current GL code, so changing
-- an account after an export and then voiding sent the reversal to the new account and left the old one unreversed. Each
-- stored line now records the source and stage it came from, and a reversal is those lines turned round, with the accounts and
-- amounts they were exported with. A reversal also can no longer be blocked by a missing account.

-- A batch made before this migration stored lines that do not say which document, payment or allocation they came from, so
-- its reversals could not be built, and they would be skipped without a word. None exists on the hosted project (checked when
-- the first migration was applied). If one exists anywhere else, stop here instead of leaving it unreversible.
do $$
begin
  if exists (select 1 from public.journal_batches) then
    raise exception 'A journal batch was made before journal_reversals. Its lines do not record their source, so its reversals cannot be built. Remove the batch or add the sources by hand first.';
  end if;
end $$;

alter table public.journal_batch_lines
  add column source_ref text not null,
  add column source_id uuid not null,
  add column stage text not null,
  add constraint journal_batch_lines_ref_check check (source_ref in ('document', 'payment', 'allocation')),
  add constraint journal_batch_lines_stage_check check (stage in ('post', 'reversal'));

create index journal_batch_lines_source_idx on public.journal_batch_lines (organisation_id, source_ref, source_id) where stage = 'post';

create or replace function private.journal_lines(p_organisation_id uuid, p_up_to date)
returns table (
  journal_key text,
  journal_seq integer,
  line_order integer,
  journal_date date,
  account_id uuid,
  account_code text,
  account_name text,
  account_role text,
  description text,
  debit numeric,
  credit numeric,
  currency_code text,
  amount_in_currency numeric,
  department_code text,
  cost_centre_code text,
  source_kind text,
  source_number text,
  party text,
  source_ref text,
  source_id uuid,
  stage text,
  problem text
)
language sql stable security definer
set search_path to ''
as $$
  with settings as (
    select s.*
    from (select 1) as one
    left join public.accounting_settings as s on s.organisation_id = p_organisation_id
  ),
  -- Documents -------------------------------------------------------------------------------------------------
  docs as (
    select h.id, h.document_number, h.party_name, h.exchange_rate, h.home_nett_amount, h.home_total_amount,
           h.foreign_nett_amount, h.foreign_vat_amount, h.foreign_total_amount, h.rounding_amount,
           cur.code as ccode, kind.type as direction, kind.document_kind::text as kind,
           'post'::text as stage,
           h.transaction_date as jdate,
           -- Positive net means a debit. The side lines and VAT take is a debit on a purchase invoice and a sales credit
           -- note, and a credit on a sales invoice and a purchase credit note.
           case when (kind.type = 'Purchases') = (kind.document_kind = 'invoice') then 1 else -1 end as sign
    from public.transaction_headers as h
    join public.transaction_types as kind on kind.id = h.transaction_type_id
    join public.currencies as cur on cur.id = h.currency_id
    where h.organisation_id = p_organisation_id
      and kind.document_kind in ('invoice', 'credit_note')
      and h.status = 'posted'
      and h.transaction_date <= p_up_to
      and h.transaction_date >= coalesce((select start_date from settings), h.transaction_date)
      and not exists (select 1 from public.journal_exports e where e.source_ref = 'document' and e.source_id = h.id and e.stage = 'post')
  ),
  doc_line_converted as (
    select d.id as doc_id, l.line_number, l.description as line_description, l.gl_code_id, l.department_id, l.cost_centre_id,
           l.nett_amount as foreign_nett, round(l.nett_amount / d.exchange_rate, 2) as converted,
           lead(l.line_number) over (partition by d.id order by l.line_number) is null as is_last
    from docs as d
    join public.transaction_lines as l on l.header_id = d.id
  ),
  doc_line_home as (
    select c.*,
           case when c.is_last
             then (select home_nett_amount from docs where id = c.doc_id)
                  - coalesce(sum(c.converted) over (partition by c.doc_id order by c.line_number rows between unbounded preceding and 1 preceding), 0)
             else c.converted
           end as home_nett
    from doc_line_converted as c
  ),
  doc_parts as (
    select d.id as ref_id, 'document'::text as ref, d.stage, d.jdate, d.direction, d.document_number as number, d.party_name as party,
           d.ccode, d.kind, d.sign,
           10 + h.line_number as line_order, 'line'::text as role, coalesce(h.gl_code_id, (select suspense_gl_code_id from settings)) as account_id,
           case when h.gl_code_id is null and (select suspense_gl_code_id from settings) is null
                then 'Line ' || h.line_number || ' has no GL code and no suspense account is set in the accounting settings' end as problem,
           coalesce(nullif(btrim(h.line_description), ''), d.document_number) || case when h.gl_code_id is null then ' (no GL code)' else '' end as description,
           d.sign * h.home_nett as net, abs(h.foreign_nett) as fcy, h.department_id, h.cost_centre_id
    from docs as d
    join doc_line_home as h on h.doc_id = d.id
    union all
    select d.id, 'document', d.stage, d.jdate, d.direction, d.document_number, d.party_name, d.ccode, d.kind, d.sign,
           900, 'vat',
           case when d.direction = 'Sales' then (select vat_sales_gl_code_id from settings) else (select vat_purchases_gl_code_id from settings) end,
           null,
           'VAT ' || d.document_number,
           d.sign * (d.home_total_amount - d.home_nett_amount), abs(d.foreign_vat_amount), null::uuid, null::uuid
    from docs as d
    union all
    select d.id, 'document', d.stage, d.jdate, d.direction, d.document_number, d.party_name, d.ccode, d.kind, d.sign,
           910, 'rounding', (select rounding_gl_code_id from settings), null,
           'Rounding ' || d.document_number,
           d.sign * round(d.rounding_amount / d.exchange_rate, 2), abs(d.rounding_amount), null::uuid, null::uuid
    from docs as d
  ),
  doc_control as (
    select p.ref_id, 'document'::text as ref, p.stage, p.jdate, p.direction, p.number, p.party, p.ccode, p.kind, p.sign,
           999 as line_order, 'control'::text as role,
           case when p.direction = 'Sales' then (select receivables_gl_code_id from settings) else (select payables_gl_code_id from settings) end as account_id,
           null::text as problem, 'Total ' || p.number as description,
           -sum(p.net) as net,
           (select abs(d.foreign_total_amount + d.rounding_amount) from docs d where d.id = p.ref_id) as fcy,
           null::uuid as department_id, null::uuid as cost_centre_id
    from doc_parts as p
    where p.net <> 0 or p.role = 'line'
    group by p.ref_id, p.stage, p.jdate, p.direction, p.number, p.party, p.ccode, p.kind, p.sign
  ),
  -- Payments --------------------------------------------------------------------------------------------------
  pays as (
    select p.id, p.document_number, p.party_name, p.home_amount, p.amount, p.bank_account_id,
           cur.code as ccode, kind.type as direction, kind.document_kind::text as kind,
           'post'::text as stage,
           p.payment_date as jdate,
           -- Money in is a debit to the bank.
           case when kind.document_kind = 'receipt' then 1 else -1 end as sign
    from public.payments as p
    join public.transaction_types as kind on kind.id = p.transaction_type_id
    join public.currencies as cur on cur.id = p.currency_id
    where p.organisation_id = p_organisation_id
      and p.status = 'posted'
      and p.payment_date <= p_up_to
      and p.payment_date >= coalesce((select start_date from settings), p.payment_date)
      and not exists (select 1 from public.journal_exports e where e.source_ref = 'payment' and e.source_id = p.id and e.stage = 'post')
  ),
  pay_parts as (
    select p.id as ref_id, 'payment'::text as ref, p.stage, p.jdate, p.direction, p.document_number as number, p.party_name as party,
           p.ccode, p.kind, p.sign, 10 as line_order, 'bank'::text as role, b.gl_code_id as account_id,
           case when p.bank_account_id is null then 'The payment has no bank account'
                when b.gl_code_id is null then 'Bank account ' || b.code || ' has no GL code' end as problem,
           coalesce(p.document_number, 'Payment') || ' ' || p.party_name as description,
           p.sign * p.home_amount as net, p.amount as fcy, null::uuid as department_id, null::uuid as cost_centre_id
    from pays as p
    left join public.bank_accounts as b on b.id = p.bank_account_id
    union all
    select p.id, 'payment', p.stage, p.jdate, p.direction, p.document_number, p.party_name, p.ccode, p.kind, p.sign,
           20, 'control',
           case when p.direction = 'Sales' then (select receivables_gl_code_id from settings) else (select payables_gl_code_id from settings) end,
           null,
           coalesce(p.document_number, 'Payment') || ' ' || p.party_name,
           -p.sign * p.home_amount, p.amount, null::uuid, null::uuid
    from pays as p
  ),
  -- Exchange differences on allocations -------------------------------------------------------------------------
  allocs as (
    select a.id, a.exchange_difference, a.removed_at, a.allocation_date,
           coalesce(pay.document_number, src.document_number) as number, tgt.party_name as party, cur.code as ccode,
           tkind.type as direction, tkind.document_kind::text as kind,
           'post'::text as stage,
           a.allocation_date as jdate,
           1 as sign
    from public.allocations as a
    join public.transaction_headers as tgt on tgt.id = a.target_header_id
    join public.transaction_types as tkind on tkind.id = tgt.transaction_type_id
    join public.currencies as cur on cur.id = tgt.currency_id
    left join public.payments as pay on pay.id = a.source_payment_id
    left join public.transaction_headers as src on src.id = a.source_header_id
    where a.organisation_id = p_organisation_id
      and not a.pending
      and a.exchange_difference <> 0
      and a.removed_at is null
      and a.allocation_date <= p_up_to
      and a.allocation_date >= coalesce((select start_date from settings), a.allocation_date)
      and not exists (select 1 from public.journal_exports e where e.source_ref = 'allocation' and e.source_id = a.id and e.stage = 'post')
  ),
  alloc_parts as (
    -- A gain is a debit to the control account and a credit to the exchange account. A loss is the opposite.
    select a.id as ref_id, 'allocation'::text as ref, a.stage, a.jdate, a.direction, a.number, a.party, a.ccode, 'exchange'::text as kind, a.sign,
           10 as line_order, 'control'::text as role,
           case when a.direction = 'Sales' then (select receivables_gl_code_id from settings) else (select payables_gl_code_id from settings) end as account_id,
           null::text as problem, 'Exchange difference ' || coalesce(a.number, '') as description,
           a.sign * a.exchange_difference as net, null::numeric as fcy, null::uuid as department_id, null::uuid as cost_centre_id
    from allocs as a
    union all
    select a.id, 'allocation', a.stage, a.jdate, a.direction, a.number, a.party, a.ccode, 'exchange', a.sign,
           20, 'exchange', (select exchange_gl_code_id from settings), null,
           'Exchange difference ' || coalesce(a.number, ''),
           -a.sign * a.exchange_difference, null, null::uuid, null::uuid
    from allocs as a
  ),
  -- A reversal is the exported lines turned round, with the accounts they were exported to. It does not look at the settings
  -- again, so changing an account after an export cannot send the reversal somewhere else.
  reversal_sources as (
    select e.source_ref, e.source_id,
           case e.source_ref
             when 'document' then (select h.voided_at::date from public.transaction_headers h where h.id = e.source_id and h.status = 'void')
             when 'payment' then (select p.voided_at::date from public.payments p where p.id = e.source_id and p.status = 'void')
             else (select a.removed_at::date from public.allocations a where a.id = e.source_id and a.removed_at is not null)
           end as jdate
    from public.journal_exports as e
    where e.organisation_id = p_organisation_id
      and e.stage = 'post'
      and not exists (
        select 1 from public.journal_exports as r
        where r.source_ref = e.source_ref and r.source_id = e.source_id and r.stage = 'reversal'
      )
  ),
  reversals as (
    select l.source_id as ref_id, l.source_ref as ref, 'reversal'::text as stage, s.jdate, null::text as direction,
           l.source_number as number, l.party, l.currency_code as ccode, null::text as kind, 1 as sign,
           l.line_number as line_order, 'reversal'::text as role, null::uuid as account_id, null::text as problem,
           'Reversal: ' || l.description as description, l.credit - l.debit as net, l.amount_in_currency as fcy,
           null::uuid as department_id, null::uuid as cost_centre_id,
           l.account_code as acc_code, l.account_name as acc_name, l.department_code as dep_code, l.cost_centre_code as cc_code,
           l.source_kind as kind_text
    from reversal_sources as s
    join public.journal_batch_lines as l
      on l.organisation_id = p_organisation_id and l.source_ref = s.source_ref and l.source_id = s.source_id and l.stage = 'post'
    where s.jdate is not null
      and s.jdate <= p_up_to
  ),
  everything as (
    select p.*, null::text as acc_code, null::text as acc_name, null::text as dep_code, null::text as cc_code, null::text as kind_text from doc_parts as p where p.net <> 0
    union all select p.*, null::text, null::text, null::text, null::text, null::text from doc_control as p where p.net <> 0
    union all select p.*, null::text, null::text, null::text, null::text, null::text from pay_parts as p where p.net <> 0
    union all select p.*, null::text, null::text, null::text, null::text, null::text from alloc_parts as p where p.net <> 0
    union all select r.* from reversals as r where r.net <> 0
  ),
  numbered as (
    select e.*,
           e.ref || ':' || e.ref_id::text || ':' || e.stage as journal_key,
           dense_rank() over (
             order by e.jdate,
                      case e.ref when 'document' then 1 when 'payment' then 2 else 3 end,
                      e.number, e.stage desc, e.ref_id
           )::integer as seq
    from everything as e
  )
  select n.journal_key, n.seq, n.line_order, n.jdate,
         n.account_id, coalesce(g.code, n.acc_code), coalesce(g.description, n.acc_name), n.role,
         n.description,
         greatest(n.net, 0)::numeric(18, 2), greatest(-n.net, 0)::numeric(18, 2),
         n.ccode, n.fcy::numeric(18, 2),
         coalesce(dep.code, n.dep_code), coalesce(cc.code, n.cc_code),
         case when n.kind_text is not null then n.kind_text else case n.ref
           when 'allocation' then 'exchange difference'
           else
             case n.kind
               when 'invoice' then case when n.direction = 'Sales' then 'sales' else 'purchase' end || ' invoice'
               when 'credit_note' then case when n.direction = 'Sales' then 'sales' else 'purchase' end || ' credit note'
               when 'receipt' then case when n.direction = 'Sales' then 'customer receipt' else 'supplier refund' end
               else case when n.direction = 'Purchases' then 'supplier payment' else 'customer refund' end
             end
         end end,
         n.number, n.party, n.ref, n.ref_id, n.stage,
         case n.role
           when 'line' then n.problem
           when 'bank' then n.problem
           when 'reversal' then null
           else case when n.account_id is null then
             case n.role
               when 'control' then case when n.direction = 'Sales' then 'The receivables account is not set in the accounting settings' else 'The payables account is not set in the accounting settings' end
               when 'vat' then case when n.direction = 'Sales' then 'The VAT on sales account is not set in the accounting settings' else 'The VAT on purchases account is not set in the accounting settings' end
               when 'rounding' then 'The rounding account is not set in the accounting settings'
               else 'The exchange gain or loss account is not set in the accounting settings'
             end
           end
         end
  from numbered as n
  left join public.gl_codes as g on g.id = n.account_id
  left join public.departments as dep on dep.id = n.department_id
  left join public.cost_centres as cc on cc.id = n.cost_centre_id
  order by n.seq, n.line_order;
$$;

create or replace function public.create_journal_batch(p_organisation_id uuid, p_up_to date)
returns uuid
language plpgsql security definer
set search_path to ''
as $$
declare
  v_tenant uuid;
  v_number integer;
  v_batch uuid;
  v_lines integer;
  v_journals integer;
  v_debit numeric;
  v_credit numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before exporting';
  end if;
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to export a journal';
  end if;
  if p_up_to is null then
    raise exception 'Choose the date to export up to';
  end if;
  select tenant_id into v_tenant from public.organisations where id = p_organisation_id;

  -- One batch at a time for an organisation, so two people cannot export the same item twice.
  perform pg_advisory_xact_lock(hashtextextended('journal_batch:' || p_organisation_id::text, 0));

  if exists (select 1 from private.journal_lines(p_organisation_id, p_up_to) where problem is not null) then
    raise exception 'The export cannot be made until the problems listed in the preview are fixed';
  end if;

  create temporary table pg_temp.journal_made on commit drop as
  select * from private.journal_lines(p_organisation_id, p_up_to);

  select count(*), count(distinct journal_seq), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_lines, v_journals, v_debit, v_credit
  from pg_temp.journal_made;
  if v_lines = 0 then
    raise exception 'There is nothing to export up to that date';
  end if;
  if v_debit <> v_credit then
    raise exception 'The journal does not balance, so it was not exported';
  end if;

  select coalesce(max(number), 0) + 1 into v_number from public.journal_batches where organisation_id = p_organisation_id;

  insert into public.journal_batches (tenant_id, organisation_id, number, up_to, journal_count, line_count, total_debit, total_credit)
  values (v_tenant, p_organisation_id, v_number, p_up_to, v_journals, v_lines, v_debit, v_credit)
  returning id into v_batch;

  insert into public.journal_batch_lines (
    tenant_id, organisation_id, batch_id, line_number, journal_number, journal_date, account_code, account_name, description,
    debit, credit, currency_code, amount_in_currency, department_code, cost_centre_code, source_kind, source_number, party,
    source_ref, source_id, stage
  )
  select v_tenant, p_organisation_id, v_batch,
         (row_number() over (order by m.journal_seq, m.line_order))::integer,
         'JB-' || lpad(v_number::text, 4, '0') || '-' || lpad(m.journal_seq::text, 4, '0'),
         m.journal_date, m.account_code, m.account_name, m.description,
         m.debit, m.credit, m.currency_code, m.amount_in_currency, m.department_code, m.cost_centre_code,
         case when m.stage = 'reversal' then 'reversal of ' || m.source_kind else m.source_kind end,
         m.source_number, m.party, m.source_ref, m.source_id, m.stage
  from pg_temp.journal_made as m;

  insert into public.journal_exports (tenant_id, organisation_id, batch_id, source_ref, source_id, stage)
  select distinct v_tenant, p_organisation_id, v_batch, m.source_ref, m.source_id, m.stage
  from pg_temp.journal_made as m;

  drop table pg_temp.journal_made;
  return v_batch;
end;
$$;
