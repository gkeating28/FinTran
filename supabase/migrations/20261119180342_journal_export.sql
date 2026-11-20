-- Journal export (QULAPLUS_JOURNAL_EXPORT_SPEC.md, phases 1 to 3).
-- Accounting settings, the journal as a calculation, and immutable export batches. Nothing here changes how a document or a
-- payment is posted, numbered, approved or voided: what a batch has exported is recorded in journal_exports, not on the sources.

-- Phase 1: the accounting settings ------------------------------------------------------------------------------

create table public.accounting_settings (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  receivables_gl_code_id uuid,
  payables_gl_code_id uuid,
  vat_sales_gl_code_id uuid,
  vat_purchases_gl_code_id uuid,
  exchange_gl_code_id uuid,
  rounding_gl_code_id uuid,
  start_date date,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint accounting_settings_pkey primary key (id),
  constraint accounting_settings_organisation_id_key unique (organisation_id),
  constraint accounting_settings_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint accounting_settings_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete cascade,
  constraint accounting_settings_receivables_fkey foreign key (organisation_id, receivables_gl_code_id) references public.gl_codes (organisation_id, id) on delete set null (receivables_gl_code_id),
  constraint accounting_settings_payables_fkey foreign key (organisation_id, payables_gl_code_id) references public.gl_codes (organisation_id, id) on delete set null (payables_gl_code_id),
  constraint accounting_settings_vat_sales_fkey foreign key (organisation_id, vat_sales_gl_code_id) references public.gl_codes (organisation_id, id) on delete set null (vat_sales_gl_code_id),
  constraint accounting_settings_vat_purchases_fkey foreign key (organisation_id, vat_purchases_gl_code_id) references public.gl_codes (organisation_id, id) on delete set null (vat_purchases_gl_code_id),
  constraint accounting_settings_exchange_fkey foreign key (organisation_id, exchange_gl_code_id) references public.gl_codes (organisation_id, id) on delete set null (exchange_gl_code_id),
  constraint accounting_settings_rounding_fkey foreign key (organisation_id, rounding_gl_code_id) references public.gl_codes (organisation_id, id) on delete set null (rounding_gl_code_id),
  constraint accounting_settings_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint accounting_settings_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null
);

comment on table public.accounting_settings is 'The GL codes the journal export uses for control, VAT, exchange and rounding lines, and the date its history starts. One row for each organisation. Owners and admins only.';

create index accounting_settings_tenant_id_idx on public.accounting_settings (tenant_id);
create index accounting_settings_created_by_idx on public.accounting_settings (created_by);
create index accounting_settings_updated_by_idx on public.accounting_settings (updated_by);
create index accounting_settings_receivables_idx on public.accounting_settings (organisation_id, receivables_gl_code_id);
create index accounting_settings_payables_idx on public.accounting_settings (organisation_id, payables_gl_code_id);
create index accounting_settings_vat_sales_idx on public.accounting_settings (organisation_id, vat_sales_gl_code_id);
create index accounting_settings_vat_purchases_idx on public.accounting_settings (organisation_id, vat_purchases_gl_code_id);
create index accounting_settings_exchange_idx on public.accounting_settings (organisation_id, exchange_gl_code_id);
create index accounting_settings_rounding_idx on public.accounting_settings (organisation_id, rounding_gl_code_id);

create function private.enforce_accounting_settings() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_tenant uuid;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'The accounting settings cannot be moved to another organisation';
  end if;
  select tenant_id into v_tenant from public.organisations where id = new.organisation_id;
  if v_tenant is null or v_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_accounting_settings() from public, anon, authenticated, service_role;

create trigger accounting_settings_scope before insert or update on public.accounting_settings
  for each row execute function private.enforce_accounting_settings();
create trigger zz_set_audit_columns before insert or update on public.accounting_settings
  for each row execute function private.set_audit_columns();
create trigger zz_write_audit_log after insert or update or delete on public.accounting_settings
  for each row execute function private.write_audit_log();

alter table public.accounting_settings enable row level security;

create policy accounting_settings_select on public.accounting_settings for select to authenticated
  using ((select private.has_org_role(accounting_settings.organisation_id, array['owner', 'admin'])));
create policy accounting_settings_insert on public.accounting_settings for insert to authenticated
  with check ((select private.has_org_role(accounting_settings.organisation_id, array['owner', 'admin'])));
create policy accounting_settings_update on public.accounting_settings for update to authenticated
  using ((select private.has_org_role(accounting_settings.organisation_id, array['owner', 'admin'])))
  with check ((select private.has_org_role(accounting_settings.organisation_id, array['owner', 'admin'])));
create policy accounting_settings_delete on public.accounting_settings for delete to authenticated
  using ((select private.has_org_role(accounting_settings.organisation_id, array['owner', 'admin'])));

revoke all on table public.accounting_settings from anon;
revoke truncate, references, trigger on table public.accounting_settings from authenticated, service_role;

-- Phase 3 tables: batches, their lines and what each batch exported ------------------------------------------------

create table public.journal_batches (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  number integer not null,
  up_to date not null,
  journal_count integer not null,
  line_count integer not null,
  total_debit numeric(18, 2) not null,
  total_credit numeric(18, 2) not null,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid(),
  constraint journal_batches_pkey primary key (id),
  constraint journal_batches_organisation_id_number_key unique (organisation_id, number),
  constraint journal_batches_organisation_id_id_key unique (organisation_id, id),
  constraint journal_batches_balanced_check check (total_debit = total_credit),
  constraint journal_batches_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint journal_batches_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete cascade,
  constraint journal_batches_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null
);

comment on table public.journal_batches is 'One journal export. Written only by create_journal_batch. Never changed or deleted.';

create index journal_batches_tenant_id_idx on public.journal_batches (tenant_id);
create index journal_batches_created_by_idx on public.journal_batches (created_by);

create table public.journal_batch_lines (
  id bigint generated always as identity,
  tenant_id uuid not null,
  organisation_id uuid not null,
  batch_id uuid not null,
  line_number integer not null,
  journal_number text not null,
  journal_date date not null,
  account_code text not null,
  account_name text not null,
  description text not null,
  debit numeric(18, 2) not null,
  credit numeric(18, 2) not null,
  currency_code text,
  amount_in_currency numeric(18, 2),
  department_code text,
  cost_centre_code text,
  source_kind text not null,
  source_number text,
  party text,
  constraint journal_batch_lines_pkey primary key (id),
  constraint journal_batch_lines_batch_id_line_number_key unique (batch_id, line_number),
  constraint journal_batch_lines_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint journal_batch_lines_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete cascade,
  constraint journal_batch_lines_batch_fkey foreign key (organisation_id, batch_id) references public.journal_batches (organisation_id, id) on delete cascade
);

comment on table public.journal_batch_lines is 'The lines of a journal batch as they were made, so a download is the same later whatever has changed since.';

create index journal_batch_lines_tenant_id_idx on public.journal_batch_lines (tenant_id);
create index journal_batch_lines_organisation_batch_idx on public.journal_batch_lines (organisation_id, batch_id);

create table public.journal_exports (
  id bigint generated always as identity,
  tenant_id uuid not null,
  organisation_id uuid not null,
  batch_id uuid not null,
  source_ref text not null,
  source_id uuid not null,
  stage text not null,
  constraint journal_exports_pkey primary key (id),
  constraint journal_exports_source_key unique (source_ref, source_id, stage),
  constraint journal_exports_ref_check check (source_ref in ('document', 'payment', 'allocation')),
  constraint journal_exports_stage_check check (stage in ('post', 'reversal')),
  constraint journal_exports_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint journal_exports_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete cascade,
  constraint journal_exports_batch_fkey foreign key (organisation_id, batch_id) references public.journal_batches (organisation_id, id) on delete cascade
);

comment on table public.journal_exports is 'Which batch exported each document, payment and allocation, and which exported its reversal. The unique key is what stops anything being exported twice.';

create index journal_exports_tenant_id_idx on public.journal_exports (tenant_id);
create index journal_exports_organisation_batch_idx on public.journal_exports (organisation_id, batch_id);

alter table public.journal_batches enable row level security;
alter table public.journal_batch_lines enable row level security;
alter table public.journal_exports enable row level security;

create policy journal_batches_select on public.journal_batches for select to authenticated
  using ((select private.has_org_role(journal_batches.organisation_id, array['owner', 'admin'])));
create policy journal_batch_lines_select on public.journal_batch_lines for select to authenticated
  using ((select private.has_org_role(journal_batch_lines.organisation_id, array['owner', 'admin'])));
create policy journal_exports_select on public.journal_exports for select to authenticated
  using ((select private.has_org_role(journal_exports.organisation_id, array['owner', 'admin'])));

-- No insert, update or delete policy exists, and the privileges are taken away too, so only create_journal_batch writes.
revoke all on table public.journal_batches from anon;
revoke all on table public.journal_batch_lines from anon;
revoke all on table public.journal_exports from anon;
revoke insert, update, delete, truncate, references, trigger on table public.journal_batches from authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.journal_batch_lines from authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.journal_exports from authenticated, service_role;

create trigger zz_write_audit_log after insert on public.journal_batches
  for each row execute function private.write_audit_log();

-- Phase 2: the journal as a calculation ------------------------------------------------------------------------

-- Everything not yet exported up to a date, as journal lines. Nothing is written. A line whose account cannot be found has
-- a null account_id and a message in `problem`. The public functions below check the caller's role.
create function private.journal_lines(p_organisation_id uuid, p_up_to date)
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
           10 + h.line_number as line_order, 'line'::text as role, h.gl_code_id as account_id,
           case when h.gl_code_id is null then 'Line ' || h.line_number || ' has no GL code' end as problem,
           coalesce(nullif(btrim(h.line_description), ''), d.document_number) as description,
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

revoke all on function private.journal_lines(uuid, date) from public, anon, authenticated, service_role;

create function public.journal_preview(p_organisation_id uuid, p_up_to date)
returns table (
  journal_number integer,
  line_number integer,
  journal_date date,
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
  stage text
)
language plpgsql stable security definer
set search_path to ''
as $$
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  if p_up_to is null then
    raise exception 'Choose the date to export up to';
  end if;
  return query
  select l.journal_seq, (row_number() over (order by l.journal_seq, l.line_order))::integer, l.journal_date,
         l.account_code, l.account_name, l.account_role, l.description, l.debit, l.credit, l.currency_code, l.amount_in_currency,
         l.department_code, l.cost_centre_code, l.source_kind, l.source_number, l.party, l.source_ref, l.source_id, l.stage
  from private.journal_lines(p_organisation_id, p_up_to) as l
  -- A journal with a problem is held back whole, so what is shown always balances.
  where not exists (
    select 1 from private.journal_lines(p_organisation_id, p_up_to) as bad
    where bad.journal_key = l.journal_key and bad.problem is not null
  )
  order by l.journal_seq, l.line_order;
end;
$$;

revoke all on function public.journal_preview(uuid, date) from public, anon;
grant execute on function public.journal_preview(uuid, date) to authenticated;

create function public.journal_problems(p_organisation_id uuid, p_up_to date)
returns table (
  source_ref text,
  source_id uuid,
  source_kind text,
  source_number text,
  party text,
  message text
)
language plpgsql stable security definer
set search_path to ''
as $$
begin
  if not (select private.has_org_role(p_organisation_id, array['owner', 'admin'])) then
    return;
  end if;
  if p_up_to is null then
    raise exception 'Choose the date to export up to';
  end if;
  return query
  select distinct l.source_ref, l.source_id, l.source_kind, l.source_number, l.party, l.problem
  from private.journal_lines(p_organisation_id, p_up_to) as l
  where l.problem is not null
  order by 4, 6;
end;
$$;

revoke all on function public.journal_problems(uuid, date) from public, anon;
grant execute on function public.journal_problems(uuid, date) to authenticated;

-- Phase 3: batches -----------------------------------------------------------------------------------------------

create function public.create_journal_batch(p_organisation_id uuid, p_up_to date)
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
    debit, credit, currency_code, amount_in_currency, department_code, cost_centre_code, source_kind, source_number, party
  )
  select v_tenant, p_organisation_id, v_batch,
         (row_number() over (order by m.journal_seq, m.line_order))::integer,
         'JB-' || lpad(v_number::text, 4, '0') || '-' || lpad(m.journal_seq::text, 4, '0'),
         m.journal_date, m.account_code, m.account_name, m.description,
         m.debit, m.credit, m.currency_code, m.amount_in_currency, m.department_code, m.cost_centre_code,
         case when m.stage = 'reversal' then 'reversal of ' || m.source_kind else m.source_kind end,
         m.source_number, m.party
  from pg_temp.journal_made as m;

  insert into public.journal_exports (tenant_id, organisation_id, batch_id, source_ref, source_id, stage)
  select distinct v_tenant, p_organisation_id, v_batch, m.source_ref, m.source_id, m.stage
  from pg_temp.journal_made as m;

  drop table pg_temp.journal_made;
  return v_batch;
end;
$$;

revoke all on function public.create_journal_batch(uuid, date) from public, anon;
grant execute on function public.create_journal_batch(uuid, date) to authenticated;

create function public.journal_batch_lines_for(p_batch_id uuid)
returns table (
  journal_number text,
  journal_date date,
  account_code text,
  account_name text,
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
  batch_number text
)
language plpgsql security definer
set search_path to ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_number integer;
begin
  select organisation_id, tenant_id, number into v_org, v_tenant, v_number from public.journal_batches where id = p_batch_id;
  if v_org is null or not (select private.has_org_role(v_org, array['owner', 'admin'])) then
    raise exception 'That batch could not be found';
  end if;
  insert into public.audit_log (table_name, row_id, action, new_values, changed_by, tenant_id, organisation_id)
  values ('journal_batches', p_batch_id::text, 'UPDATE', jsonb_build_object('event', 'downloaded', 'number', v_number), auth.uid(), v_tenant, v_org);
  return query
  select l.journal_number, l.journal_date, l.account_code, l.account_name, l.description, l.debit, l.credit, l.currency_code,
         l.amount_in_currency, l.department_code, l.cost_centre_code, l.source_kind, l.source_number, l.party,
         'JB-' || lpad(v_number::text, 4, '0')
  from public.journal_batch_lines as l
  where l.batch_id = p_batch_id
  order by l.line_number;
end;
$$;

revoke all on function public.journal_batch_lines_for(uuid) from public, anon;
grant execute on function public.journal_batch_lines_for(uuid) to authenticated;
