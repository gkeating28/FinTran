-- Journal export: a suspense account (QULAPLUS_JOURNAL_EXPORT_SPEC.md, J18).
-- A posted purchase line can have no GL code (an imported e-invoice, for one) and a posted line cannot be edited, so the
-- preview would list it for ever and no batch could be made. With a suspense account set, such a line is journalled to it,
-- marked "(no GL code)" in its description, and the accountant recodes it in their system. With none set it is still a problem.

alter table public.accounting_settings
  add column suspense_gl_code_id uuid,
  add constraint accounting_settings_suspense_fkey foreign key (organisation_id, suspense_gl_code_id) references public.gl_codes (organisation_id, id) on delete set null (suspense_gl_code_id);

create index accounting_settings_suspense_idx on public.accounting_settings (organisation_id, suspense_gl_code_id);

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
           case when h.status = 'posted' then 'post' else 'reversal' end as stage,
           case when h.status = 'posted' then h.transaction_date else h.voided_at::date end as jdate,
           -- Positive net means a debit. The side lines and VAT take is a debit on a purchase invoice and a sales credit
           -- note, and a credit on a sales invoice and a purchase credit note. A reversal is the opposite.
           case when (kind.type = 'Purchases') = (kind.document_kind = 'invoice') then 1 else -1 end
             * case when h.status = 'posted' then 1 else -1 end as sign
    from public.transaction_headers as h
    join public.transaction_types as kind on kind.id = h.transaction_type_id
    join public.currencies as cur on cur.id = h.currency_id
    where h.organisation_id = p_organisation_id
      and kind.document_kind in ('invoice', 'credit_note')
      and (
        (h.status = 'posted'
         and h.transaction_date <= p_up_to
         and h.transaction_date >= coalesce((select start_date from settings), h.transaction_date)
         and not exists (select 1 from public.journal_exports e where e.source_ref = 'document' and e.source_id = h.id and e.stage = 'post'))
        or
        (h.status = 'void'
         and h.voided_at::date <= p_up_to
         and exists (select 1 from public.journal_exports e where e.source_ref = 'document' and e.source_id = h.id and e.stage = 'post')
         and not exists (select 1 from public.journal_exports e where e.source_ref = 'document' and e.source_id = h.id and e.stage = 'reversal'))
      )
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
           case when p.status = 'posted' then 'post' else 'reversal' end as stage,
           case when p.status = 'posted' then p.payment_date else p.voided_at::date end as jdate,
           -- Money in is a debit to the bank. A reversal is the opposite.
           case when kind.document_kind = 'receipt' then 1 else -1 end * case when p.status = 'posted' then 1 else -1 end as sign
    from public.payments as p
    join public.transaction_types as kind on kind.id = p.transaction_type_id
    join public.currencies as cur on cur.id = p.currency_id
    where p.organisation_id = p_organisation_id
      and (
        (p.status = 'posted'
         and p.payment_date <= p_up_to
         and p.payment_date >= coalesce((select start_date from settings), p.payment_date)
         and not exists (select 1 from public.journal_exports e where e.source_ref = 'payment' and e.source_id = p.id and e.stage = 'post'))
        or
        (p.status = 'void'
         and p.voided_at::date <= p_up_to
         and exists (select 1 from public.journal_exports e where e.source_ref = 'payment' and e.source_id = p.id and e.stage = 'post')
         and not exists (select 1 from public.journal_exports e where e.source_ref = 'payment' and e.source_id = p.id and e.stage = 'reversal'))
      )
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
           case when a.removed_at is null then 'post' else 'reversal' end as stage,
           case when a.removed_at is null then a.allocation_date else a.removed_at::date end as jdate,
           case when a.removed_at is null then 1 else -1 end as sign
    from public.allocations as a
    join public.transaction_headers as tgt on tgt.id = a.target_header_id
    join public.transaction_types as tkind on tkind.id = tgt.transaction_type_id
    join public.currencies as cur on cur.id = tgt.currency_id
    left join public.payments as pay on pay.id = a.source_payment_id
    left join public.transaction_headers as src on src.id = a.source_header_id
    where a.organisation_id = p_organisation_id
      and not a.pending
      and a.exchange_difference <> 0
      and (
        (a.removed_at is null
         and a.allocation_date <= p_up_to
         and a.allocation_date >= coalesce((select start_date from settings), a.allocation_date)
         and not exists (select 1 from public.journal_exports e where e.source_ref = 'allocation' and e.source_id = a.id and e.stage = 'post'))
        or
        (a.removed_at is not null
         and a.removed_at::date <= p_up_to
         and exists (select 1 from public.journal_exports e where e.source_ref = 'allocation' and e.source_id = a.id and e.stage = 'post')
         and not exists (select 1 from public.journal_exports e where e.source_ref = 'allocation' and e.source_id = a.id and e.stage = 'reversal'))
      )
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
  everything as (
    select * from doc_parts where net <> 0
    union all select * from doc_control where net <> 0
    union all select * from pay_parts where net <> 0
    union all select * from alloc_parts where net <> 0
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
         n.account_id, g.code, g.description, n.role,
         n.description,
         greatest(n.net, 0)::numeric(18, 2), greatest(-n.net, 0)::numeric(18, 2),
         n.ccode, n.fcy::numeric(18, 2),
         dep.code, cc.code,
         case n.ref
           when 'allocation' then 'exchange difference'
           else
             case n.kind
               when 'invoice' then case when n.direction = 'Sales' then 'sales' else 'purchase' end || ' invoice'
               when 'credit_note' then case when n.direction = 'Sales' then 'sales' else 'purchase' end || ' credit note'
               when 'receipt' then case when n.direction = 'Sales' then 'customer receipt' else 'supplier refund' end
               else case when n.direction = 'Purchases' then 'supplier payment' else 'customer refund' end
             end
         end,
         n.number, n.party, n.ref, n.ref_id, n.stage,
         case n.role
           when 'line' then n.problem
           when 'bank' then n.problem
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
