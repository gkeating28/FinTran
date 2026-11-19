-- Payment runs (specs/QULAPLUS_PAYMENT_APPROVALS_SPEC.md, phase 4).
--
-- A payment run is a batch of draft supplier payments made together: one payment type, one bank account, one currency and
-- one payment date, with one draft payment for each supplier that has invoices in it. The run is approved as a whole by its
-- total, and posting the run posts every payment or none. A payment that belongs to a run cannot be posted on its own.
-- With no run, nothing changes for anyone.

create table public.payment_runs (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  transaction_type_id uuid not null,
  bank_account_id uuid not null,
  currency_id uuid not null,
  payment_date date not null,
  reference integer not null,
  document_number text not null,
  status text not null default 'draft',
  notes text,
  approval_status text,
  approval_required_role text,
  approval_reason text,
  approval_requested_by uuid,
  approval_requested_at timestamp with time zone,
  approval_decided_by uuid,
  approval_decided_at timestamp with time zone,
  approval_note text,
  approval_self boolean not null default false,
  approval_hash text,
  posted_at timestamp with time zone,
  posted_by uuid,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint payment_runs_pkey primary key (id),
  constraint payment_runs_organisation_id_id_key unique (organisation_id, id),
  constraint payment_runs_organisation_id_reference_key unique (organisation_id, reference),
  constraint payment_runs_status_check check (status in ('draft', 'posted', 'cancelled')),
  constraint payment_runs_notes_check check (notes is null or char_length(notes) <= 1000),
  constraint payment_runs_approval_status_check check (approval_status is null or approval_status in ('requested', 'approved', 'rejected')),
  constraint payment_runs_approval_role_check check (approval_required_role is null or approval_required_role in ('admin', 'owner')),
  constraint payment_runs_approval_reason_check check (approval_reason is null or approval_reason in ('amount', 'bank details', 'amount and bank details')),
  constraint payment_runs_approval_note_check check (approval_note is null or char_length(approval_note) <= 500),
  constraint payment_runs_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete restrict,
  constraint payment_runs_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete restrict,
  constraint payment_runs_type_fkey foreign key (organisation_id, transaction_type_id) references public.transaction_types (organisation_id, id) on delete restrict,
  constraint payment_runs_bank_account_fkey foreign key (organisation_id, bank_account_id) references public.bank_accounts (organisation_id, id) on delete restrict,
  constraint payment_runs_currency_fkey foreign key (organisation_id, currency_id) references public.currencies (organisation_id, id) on delete restrict,
  constraint payment_runs_approval_requested_by_fkey foreign key (approval_requested_by) references public.profiles (id) on delete set null,
  constraint payment_runs_approval_decided_by_fkey foreign key (approval_decided_by) references public.profiles (id) on delete set null,
  constraint payment_runs_posted_by_fkey foreign key (posted_by) references public.profiles (id) on delete set null,
  constraint payment_runs_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint payment_runs_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null
);

comment on table public.payment_runs is 'A batch of draft supplier payments made together and approved and posted as a whole. Written only by the payment run functions.';

create index payment_runs_organisation_id_idx on public.payment_runs (organisation_id);
create index payment_runs_tenant_id_idx on public.payment_runs (tenant_id);
create index payment_runs_type_idx on public.payment_runs (organisation_id, transaction_type_id);
create index payment_runs_bank_account_idx on public.payment_runs (organisation_id, bank_account_id);
create index payment_runs_currency_idx on public.payment_runs (organisation_id, currency_id);
create index payment_runs_approval_requested_by_idx on public.payment_runs (approval_requested_by);
create index payment_runs_approval_decided_by_idx on public.payment_runs (approval_decided_by);
create index payment_runs_posted_by_idx on public.payment_runs (posted_by);
create index payment_runs_created_by_idx on public.payment_runs (created_by);
create index payment_runs_updated_by_idx on public.payment_runs (updated_by);

create trigger zz_set_audit_columns before insert or update on public.payment_runs
  for each row execute function private.set_audit_columns();
create trigger zz_write_audit_log after insert or update or delete on public.payment_runs
  for each row execute function private.write_audit_log();
create trigger zzy_guard_approval before insert or update on public.payment_runs
  for each row execute function private.guard_approval_columns();

alter table public.payment_runs enable row level security;

create policy payment_runs_select on public.payment_runs for select to authenticated
  using ((select private.is_org_member(payment_runs.organisation_id)));

revoke all on table public.payment_runs from anon;
revoke insert, update, delete, truncate, references, trigger on table public.payment_runs from authenticated, service_role;

alter table public.payments add column payment_run_id uuid;
alter table public.payments
  add constraint payments_payment_run_fkey foreign key (organisation_id, payment_run_id) references public.payment_runs (organisation_id, id) on delete restrict;
create index payments_payment_run_idx on public.payments (organisation_id, payment_run_id) where payment_run_id is not null;

-- An email is about a document, a payment or a run, never more than one.
alter table public.email_outbox
  drop constraint email_outbox_subject_check,
  add column run_id uuid,
  add constraint email_outbox_run_id_fkey foreign key (run_id) references public.payment_runs (id) on delete cascade,
  add constraint email_outbox_subject_check check (num_nonnulls(header_id, payment_id, run_id) = 1);
create index email_outbox_run_id_idx on public.email_outbox (run_id);

-- A payment in a run is approved with the run -------------------------------------------------------------------------

create or replace function private.payment_approval_check(p_payment_id uuid)
returns table (needed boolean, role text, reason text)
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_type uuid;
  v_home numeric;
  v_supplier uuid;
  v_run uuid;
  v_kind text;
  v_rule_role text;
  v_bank boolean;
begin
  select payment.organisation_id, payment.status, payment.transaction_type_id, payment.home_amount, payment.supplier_id,
         payment.payment_run_id, kind.document_kind::text
    into v_org, v_status, v_type, v_home, v_supplier, v_run, v_kind
  from public.payments as payment
  join public.transaction_types as kind on kind.id = payment.transaction_type_id
  where payment.id = p_payment_id;

  -- A payment in a run is approved with the run, not on its own.
  if v_org is null or v_status is distinct from 'draft' or v_kind is distinct from 'payment' or v_run is not null then
    return query select false, null::text, null::text;
    return;
  end if;

  select rule.required_role into v_rule_role
  from public.approval_rules as rule
  where rule.organisation_id = v_org and rule.transaction_type_id = v_type and rule.active and rule.amount <= v_home
  order by rule.amount desc
  limit 1;

  v_bank := v_supplier is not null and private.bank_changed_recently(v_supplier);

  if v_rule_role is null and not v_bank then
    return query select false, null::text, null::text;
    return;
  end if;

  return query select
    true,
    case when v_rule_role = 'owner' then 'owner' else 'admin' end,
    case when v_rule_role is not null and v_bank then 'amount and bank details' when v_bank then 'bank details' else 'amount' end;
end;
$$;

-- The check for a run ----------------------------------------------------------------------------------------------------

create function private.run_home_total(p_run_id uuid) returns numeric
  language sql stable security definer
  set search_path to ''
as $$
  select coalesce(sum(payment.home_amount), 0) from public.payments as payment where payment.payment_run_id = p_run_id
$$;

revoke all on function private.run_home_total(uuid) from public, anon, authenticated, service_role;

-- A fingerprint of the run and of every payment in it with its planned allocations.
create function private.run_approval_hash(p_run_id uuid) returns text
  language sql stable security definer
  set search_path to ''
as $$
  select encode(extensions.digest(convert_to(
    coalesce((
      select (to_jsonb(run)
        - 'approval_status' - 'approval_required_role' - 'approval_reason' - 'approval_requested_by' - 'approval_requested_at'
        - 'approval_decided_by' - 'approval_decided_at' - 'approval_note' - 'approval_self' - 'approval_hash'
        - 'created_at' - 'created_by' - 'updated_at' - 'updated_by')::text
      from public.payment_runs as run where run.id = p_run_id
    ), '')
    || '|' ||
    coalesce((
      select string_agg(private.payment_approval_hash(payment.id), ',' order by payment.id)
      from public.payments as payment where payment.payment_run_id = p_run_id
    ), ''),
  'utf8'), 'sha256'), 'hex')
$$;

revoke all on function private.run_approval_hash(uuid) from public, anon, authenticated, service_role;

-- Whether a draft run needs approval, from whom, and why. The rules are those of the run's payment type, applied to its
-- total. A run also needs an admin when any supplier in it had its bank details changed inside the window.
create function private.run_approval_check(p_run_id uuid)
returns table (needed boolean, role text, reason text)
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_org uuid;
  v_status text;
  v_type uuid;
  v_total numeric;
  v_rule_role text;
  v_bank boolean;
begin
  select run.organisation_id, run.status, run.transaction_type_id into v_org, v_status, v_type
  from public.payment_runs as run where run.id = p_run_id;
  if v_org is null or v_status is distinct from 'draft' then
    return query select false, null::text, null::text;
    return;
  end if;
  v_total := private.run_home_total(p_run_id);
  if v_total <= 0 then
    return query select false, null::text, null::text;
    return;
  end if;

  select rule.required_role into v_rule_role
  from public.approval_rules as rule
  where rule.organisation_id = v_org and rule.transaction_type_id = v_type and rule.active and rule.amount <= v_total
  order by rule.amount desc
  limit 1;

  select exists (
    select 1 from public.payments as payment
    where payment.payment_run_id = p_run_id and payment.supplier_id is not null and private.bank_changed_recently(payment.supplier_id)
  ) into v_bank;

  if v_rule_role is null and not v_bank then
    return query select false, null::text, null::text;
    return;
  end if;
  return query select
    true,
    case when v_rule_role = 'owner' then 'owner' else 'admin' end,
    case when v_rule_role is not null and v_bank then 'amount and bank details' when v_bank then 'bank details' else 'amount' end;
end;
$$;

revoke all on function private.run_approval_check(uuid) from public, anon, authenticated, service_role;

create function private.run_approval_state(p_run_id uuid) returns text
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  c record;
  h record;
begin
  select * into c from private.run_approval_check(p_run_id);
  if not c.needed then
    return 'none';
  end if;
  select approval_status, approval_hash, approval_required_role into h from public.payment_runs where id = p_run_id;
  if h.approval_status is null
     or h.approval_hash is distinct from private.run_approval_hash(p_run_id)
     or private.role_rank(c.role) > private.role_rank(h.approval_required_role) then
    return 'required';
  end if;
  return h.approval_status;
end;
$$;

revoke all on function private.run_approval_state(uuid) from public, anon, authenticated, service_role;

create function private.require_run_approval(p_run_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  c record;
  v_state text;
  v_who text;
  v_note text;
begin
  select * into c from private.run_approval_check(p_run_id);
  if not c.needed then
    return;
  end if;
  v_state := private.run_approval_state(p_run_id);
  if v_state = 'approved' then
    return;
  end if;
  v_who := case c.role when 'owner' then 'an owner' else 'an admin or owner' end;
  if v_state = 'requested' then
    raise exception 'Waiting for approval from %.', v_who;
  end if;
  if v_state = 'rejected' then
    select approval_note into v_note from public.payment_runs where id = p_run_id;
    raise exception 'Approval was refused: %.', coalesce(nullif(v_note, ''), 'no reason was given');
  end if;
  raise exception 'This payment run needs approval from %. Request approval first.', v_who;
end;
$$;

revoke all on function private.require_run_approval(uuid) from public, anon, authenticated, service_role;

-- Creating, changing and cancelling a run -------------------------------------------------------------------------------

-- p_run: transactionTypeId, bankAccountId, paymentDate, notes and invoiceIds. One draft payment is made for each supplier,
-- allocating the full amount open on each of their chosen invoices.
create function public.create_payment_run(p_run jsonb) returns uuid
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_type uuid := nullif(p_run->>'transactionTypeId', '')::uuid;
  v_bank uuid := nullif(p_run->>'bankAccountId', '')::uuid;
  v_date date := nullif(p_run->>'paymentDate', '')::date;
  v_ids uuid[];
  v_org uuid;
  v_tenant uuid;
  v_direction text;
  v_kind text;
  v_bank_currency uuid;
  v_bank_active boolean;
  v_run uuid;
  v_reference integer;
  v_prefix text;
  v_invoice record;
  v_open numeric;
  v_supplier record;
  v_payment uuid;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before making a payment run';
  end if;
  select organisation_id, tenant_id, type, document_kind::text into v_org, v_tenant, v_direction, v_kind
  from public.transaction_types where id = v_type;
  if v_org is null then
    raise exception 'Choose a payment type';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_direction is distinct from 'Purchases' or v_kind is distinct from 'payment' then
    raise exception 'A payment run is for a supplier payment type';
  end if;
  if v_date is null then
    raise exception 'Enter the payment date';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;
  select currency_id, active into v_bank_currency, v_bank_active
  from public.bank_accounts where id = v_bank and organisation_id = v_org;
  if v_bank_currency is null then
    raise exception 'Choose a bank account from this organisation';
  end if;
  if not v_bank_active then
    raise exception 'The bank account is not active';
  end if;
  select coalesce(array_agg(distinct value::uuid), array[]::uuid[]) into v_ids
  from jsonb_array_elements_text(coalesce(p_run->'invoiceIds', '[]'::jsonb)) as value;
  if cardinality(v_ids) < 1 then
    raise exception 'Choose at least one invoice to pay';
  end if;

  -- Every chosen invoice: posted, a purchase invoice of this organisation in the bank account's currency, with something
  -- open, and not already in a draft run. Locked in id order, the same order every allocation uses.
  for v_invoice in
    select header.id, header.status, header.organisation_id, header.currency_id, header.supplier_id,
           header.foreign_total_amount + header.rounding_amount as total, header.document_number, kind.type, kind.document_kind::text as document_kind
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    where header.id = any (v_ids)
    order by header.id
    for update of header
  loop
    if v_invoice.organisation_id is distinct from v_org or v_invoice.type is distinct from 'Purchases' or v_invoice.document_kind is distinct from 'invoice' then
      raise exception '% is not a purchase invoice of this organisation', coalesce(v_invoice.document_number, 'A document');
    end if;
    if v_invoice.status is distinct from 'posted' then
      raise exception '% is not posted', coalesce(v_invoice.document_number, 'An invoice');
    end if;
    if v_invoice.currency_id is distinct from v_bank_currency then
      raise exception '% is not in the currency of the bank account', coalesce(v_invoice.document_number, 'An invoice');
    end if;
    v_open := v_invoice.total - private.header_settled(v_invoice.id, null);
    if v_open <= 0 then
      raise exception '% has nothing open', coalesce(v_invoice.document_number, 'An invoice');
    end if;
    if exists (
      select 1 from public.allocations as allocation
      join public.payments as payment on payment.id = allocation.source_payment_id
      where allocation.target_header_id = v_invoice.id and allocation.pending and payment.payment_run_id is not null and payment.status = 'draft'
    ) then
      raise exception '% is already in another payment run', coalesce(v_invoice.document_number, 'An invoice');
    end if;
  end loop;
  if (select count(*) from public.transaction_headers where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'One of the chosen invoices could not be found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 0));
  select coalesce(max(reference), 0) + 1 into v_reference from public.payment_runs where organisation_id = v_org;
  insert into public.payment_runs (tenant_id, organisation_id, transaction_type_id, bank_account_id, currency_id, payment_date, reference, document_number, notes)
  values (v_tenant, v_org, v_type, v_bank, v_bank_currency, v_date, v_reference, 'RUN-' || lpad(v_reference::text, 4, '0'), nullif(btrim(p_run->>'notes'), ''))
  returning id into v_run;

  for v_supplier in
    select header.supplier_id as id,
           jsonb_agg(jsonb_build_object('targetHeaderId', header.id,
                                        'amount', header.foreign_total_amount + header.rounding_amount - private.header_settled(header.id, null))
                     order by header.id) as lines,
           sum(header.foreign_total_amount + header.rounding_amount - private.header_settled(header.id, null)) as amount
    from public.transaction_headers as header
    where header.id = any (v_ids)
    group by header.supplier_id
    order by header.supplier_id
  loop
    v_payment := public.save_payment(jsonb_build_object(
      'transactionTypeId', v_type,
      'paymentDate', v_date,
      'supplierId', v_supplier.id,
      'bankAccountId', v_bank,
      'amount', v_supplier.amount,
      'allocations', v_supplier.lines
    ));
    update public.payments set payment_run_id = v_run where id = v_payment;
    v_count := v_count + 1;
  end loop;
  return v_run;
end;
$$;

revoke all on function public.create_payment_run(jsonb) from public, anon;
grant execute on function public.create_payment_run(jsonb) to authenticated;

-- Takes a payment out of a draft run. The payment stays, as an ordinary draft.
create function public.remove_run_payment(p_payment_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_run uuid;
  v_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before changing a payment run';
  end if;
  select payment.organisation_id, payment.payment_run_id into v_org, v_run
  from public.payments as payment where payment.id = p_payment_id for update;
  if v_org is null or v_run is null or not (select private.is_org_member(v_org)) then
    raise exception 'That payment is not in a payment run';
  end if;
  select status into v_status from public.payment_runs where id = v_run for update;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft payment run can be changed';
  end if;
  update public.payments set payment_run_id = null where id = p_payment_id;
end;
$$;

revoke all on function public.remove_run_payment(uuid) from public, anon;
grant execute on function public.remove_run_payment(uuid) to authenticated;

-- Cancels a draft run and deletes the draft payments in it, so every invoice is free again.
create function public.cancel_payment_run(p_run_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before cancelling a payment run';
  end if;
  select organisation_id, status into v_org, v_status from public.payment_runs where id = p_run_id for update;
  if v_org is null or not (select private.is_org_member(v_org)) then
    raise exception 'That payment run could not be found';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft payment run can be cancelled';
  end if;
  delete from public.allocations where pending and source_payment_id in (select id from public.payments where payment_run_id = p_run_id and status = 'draft');
  delete from public.payments where payment_run_id = p_run_id and status = 'draft';
  update public.payment_runs set status = 'cancelled' where id = p_run_id;
end;
$$;

revoke all on function public.cancel_payment_run(uuid) from public, anon;
grant execute on function public.cancel_payment_run(uuid) to authenticated;

-- Email ------------------------------------------------------------------------------------------------------------------

create function private.queue_run_approval_emails(p_run_id uuid, p_reason text) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  h record;
  c record;
  v_on boolean;
  v_roles text[];
  v_amount text;
  v_link text;
  v_subject text;
  v_body text;
  r record;
begin
  select run.organisation_id, run.tenant_id, run.document_number, run.approval_requested_by, run.approval_decided_by, run.approval_note,
         private.run_home_total(run.id) as home_total,
         (select count(*) from public.payments as payment where payment.payment_run_id = run.id) as payments,
         (select profile.display_name from public.profiles as profile where profile.id = run.approval_requested_by) as requester,
         (select profile.display_name from public.profiles as profile where profile.id = run.approval_decided_by) as decider
    into h
  from public.payment_runs as run where run.id = p_run_id;
  if h.organisation_id is null then
    return;
  end if;
  select defaults.approval_emails into v_on from public.organisation_defaults as defaults where defaults.organisation_id = h.organisation_id;
  if not coalesce(v_on, true) then
    return;
  end if;
  v_amount := '€' || to_char(round(coalesce(h.home_total, 0), 2), 'FM999,999,999,990.00');
  v_link := '/payment-runs?open=' || p_run_id;

  if p_reason = 'approval requested' then
    select * into c from private.run_approval_check(p_run_id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_subject := 'Payment run approval needed: ' || h.document_number || ' for ' || v_amount;
    v_body := coalesce(h.requester, 'Someone') || ' asked for approval of ' || h.document_number || ', ' || h.payments || ' payments, ' || v_amount || '.'
      || case c.reason when 'amount' then '' else E'\n\nA supplier''s bank details changed recently.' end
      || coalesce(E'\n\nNote: ' || h.approval_note, '');
    for r in
      select profile.id, profile.email, profile.display_name
      from public.organisation_access as access
      join public.profiles as profile on profile.id = access.user_id
      where access.organisation_id = h.organisation_id and access.role = any (v_roles) and access.user_id is distinct from (select auth.uid())
    loop
      insert into public.email_outbox (tenant_id, organisation_id, run_id, recipient_id, recipient_email, recipient_name, reason, subject, body, link_path)
      values (h.tenant_id, h.organisation_id, p_run_id, r.id, r.email, r.display_name, p_reason, v_subject, v_body, v_link);
    end loop;
  else
    if h.approval_requested_by is null or h.approval_requested_by is not distinct from (select auth.uid()) then
      return;
    end if;
    v_subject := case p_reason when 'approved' then 'Payment run approved: ' else 'Payment run refused: ' end || h.document_number;
    v_body := case p_reason
        when 'approved' then coalesce(h.decider, 'Someone') || ' approved ' || h.document_number || ' for ' || v_amount || '. It can be posted.'
        else coalesce(h.decider, 'Someone') || ' refused approval of ' || h.document_number || ' for ' || v_amount || '.'
      end
      || case when p_reason = 'rejected' then E'\n\nReason: ' || coalesce(h.approval_note, '') else coalesce(E'\n\nNote: ' || h.approval_note, '') end;
    insert into public.email_outbox (tenant_id, organisation_id, run_id, recipient_id, recipient_email, recipient_name, reason, subject, body, link_path)
    select h.tenant_id, h.organisation_id, p_run_id, profile.id, profile.email, profile.display_name, p_reason, v_subject, v_body, v_link
    from public.profiles as profile where profile.id = h.approval_requested_by;
  end if;
end;
$$;

revoke all on function private.queue_run_approval_emails(uuid, text) from public, anon, authenticated, service_role;

create function public.queued_run_emails(p_run_id uuid)
returns table (id uuid, recipient_email text, recipient_name text, subject text, body text, link_path text)
language sql stable security definer
set search_path to ''
as $$
  select outbox.id, outbox.recipient_email, outbox.recipient_name, outbox.subject, outbox.body, outbox.link_path
  from public.email_outbox as outbox
  where outbox.run_id = p_run_id
    and outbox.status = 'queued'
    and outbox.created_by = (select auth.uid())
    and (select private.is_org_member(outbox.organisation_id))
  order by outbox.created_at
$$;

revoke all on function public.queued_run_emails(uuid) from public, anon;
grant execute on function public.queued_run_emails(uuid) to authenticated;

-- Asking, giving and refusing for a run ------------------------------------------------------------------------------------

create function public.request_run_approval(p_run_id uuid, p_note text default null) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  c record;
  v_state text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before asking for approval';
  end if;
  select organisation_id into v_org from public.payment_runs where id = p_run_id for update;
  if v_org is null then
    raise exception 'That payment run could not be found';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'The note can be up to 500 characters';
  end if;
  select * into c from private.run_approval_check(p_run_id);
  if not c.needed then
    raise exception 'This payment run does not need approval';
  end if;
  v_state := private.run_approval_state(p_run_id);
  if v_state = 'approved' then
    raise exception 'This payment run is already approved';
  end if;
  if v_state = 'requested' then
    raise exception 'Approval has already been asked for';
  end if;

  perform set_config('fintran.approval_change', 'on', true);
  update public.payment_runs
  set approval_status = 'requested',
      approval_required_role = c.role,
      approval_reason = c.reason,
      approval_requested_by = (select auth.uid()),
      approval_requested_at = now(),
      approval_decided_by = null,
      approval_decided_at = null,
      approval_note = nullif(btrim(p_note), ''),
      approval_self = false,
      approval_hash = private.run_approval_hash(p_run_id)
  where id = p_run_id;
  perform set_config('fintran.approval_change', 'off', true);
  perform private.queue_run_approval_emails(p_run_id, 'approval requested');
end;
$$;

revoke all on function public.request_run_approval(uuid, text) from public, anon;
grant execute on function public.request_run_approval(uuid, text) to authenticated;

create function private.check_run_approver(p_run_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_requester uuid;
  c record;
  v_state text;
  v_roles text[];
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before deciding an approval';
  end if;
  select organisation_id, approval_requested_by into v_org, v_requester from public.payment_runs where id = p_run_id for update;
  if v_org is null then
    raise exception 'That payment run could not be found';
  end if;
  select * into c from private.run_approval_check(p_run_id);
  if not c.needed then
    raise exception 'This payment run does not need approval';
  end if;
  v_state := private.run_approval_state(p_run_id);
  if v_state = 'required' then
    raise exception 'Approval has not been asked for this version of the payment run. Ask again.';
  end if;
  if v_state <> 'requested' then
    raise exception 'Only an approval that is waiting can be decided';
  end if;
  v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
  if not (select private.has_org_role(v_org, v_roles)) then
    raise exception 'This needs %.', case c.role when 'owner' then 'an owner' else 'an admin or owner' end;
  end if;
  if v_requester is not distinct from (select auth.uid()) then
    raise exception 'You asked for this approval, so someone else has to decide it.';
  end if;
end;
$$;

revoke all on function private.check_run_approver(uuid) from public, anon, authenticated, service_role;

create function public.approve_run(p_run_id uuid, p_note text default null) returns void
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'The note can be up to 500 characters';
  end if;
  perform private.check_run_approver(p_run_id);
  perform set_config('fintran.approval_change', 'on', true);
  update public.payment_runs
  set approval_status = 'approved',
      approval_decided_by = (select auth.uid()),
      approval_decided_at = now(),
      approval_note = coalesce(nullif(btrim(p_note), ''), approval_note),
      approval_self = false
  where id = p_run_id;
  perform set_config('fintran.approval_change', 'off', true);
  perform private.queue_run_approval_emails(p_run_id, 'approved');
end;
$$;

revoke all on function public.approve_run(uuid, text) from public, anon;
grant execute on function public.approve_run(uuid, text) to authenticated;

create function public.reject_run(p_run_id uuid, p_reason text) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null then
    raise exception 'Enter a reason for refusing approval';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'The reason can be up to 500 characters';
  end if;
  perform private.check_run_approver(p_run_id);
  perform set_config('fintran.approval_change', 'on', true);
  update public.payment_runs
  set approval_status = 'rejected',
      approval_decided_by = (select auth.uid()),
      approval_decided_at = now(),
      approval_note = v_reason,
      approval_self = false
  where id = p_run_id;
  perform set_config('fintran.approval_change', 'off', true);
  perform private.queue_run_approval_emails(p_run_id, 'rejected');
end;
$$;

revoke all on function public.reject_run(uuid, text) from public, anon;
grant execute on function public.reject_run(uuid, text) to authenticated;

-- Where each of several runs stands, for the list and the open run.
create function public.payment_run_approval_status(p_run_ids uuid[])
returns table (
  run_id uuid,
  state text,
  required_role text,
  reason text,
  requested_by_name text,
  requested_at timestamp with time zone,
  decided_by_name text,
  decided_at timestamp with time zone,
  note text,
  can_decide boolean,
  home_total numeric,
  bank_suppliers text
)
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_id uuid;
  h record;
  c record;
  v_state text;
  v_roles text[];
  v_decide boolean;
begin
  foreach v_id in array coalesce(p_run_ids, array[]::uuid[])
  loop
    select run.organisation_id, run.approval_requested_by, run.approval_requested_at, run.approval_decided_by,
           run.approval_decided_at, run.approval_note
      into h
    from public.payment_runs as run where run.id = v_id;
    if not found or not (select private.is_org_member(h.organisation_id)) then
      continue;
    end if;
    select * into c from private.run_approval_check(v_id);
    if not c.needed then
      continue;
    end if;
    v_state := private.run_approval_state(v_id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_decide := v_state = 'requested'
      and (select private.has_org_role(h.organisation_id, v_roles))
      and h.approval_requested_by is distinct from (select auth.uid());
    return query select
      v_id, v_state, c.role, c.reason,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_requested_by),
      h.approval_requested_at,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_decided_by),
      h.approval_decided_at,
      h.approval_note,
      v_decide,
      private.run_home_total(v_id),
      (select string_agg(distinct payment.party_name, ', ' order by payment.party_name)
       from public.payments as payment
       where payment.payment_run_id = v_id and payment.supplier_id is not null and private.bank_changed_recently(payment.supplier_id));
  end loop;
end;
$$;

revoke all on function public.payment_run_approval_status(uuid[]) from public, anon;
grant execute on function public.payment_run_approval_status(uuid[]) to authenticated;

-- Posting ------------------------------------------------------------------------------------------------------------------

-- Posts every payment in the run, or none. Each is posted by post_payment, which checks what is still open on every invoice,
-- so a payment made elsewhere since the run was made stops the whole run.
create function public.post_payment_run(p_run_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_status text;
  v_payment record;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a payment run';
  end if;
  select organisation_id, status into v_org, v_status from public.payment_runs where id = p_run_id for update;
  if v_org is null then
    raise exception 'That payment run could not be found';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft payment run can be posted';
  end if;
  perform 1 from public.payments where payment_run_id = p_run_id for update;
  if not exists (select 1 from public.payments where payment_run_id = p_run_id) then
    raise exception 'Add a payment to the run before posting';
  end if;
  perform private.require_run_approval(p_run_id);

  perform set_config('fintran.run_post', 'on', true);
  for v_payment in select id from public.payments where payment_run_id = p_run_id and status = 'draft' order by id loop
    perform public.post_payment(v_payment.id);
    v_count := v_count + 1;
  end loop;
  perform set_config('fintran.run_post', 'off', true);

  update public.payment_runs set status = 'posted', posted_at = now(), posted_by = (select auth.uid()) where id = p_run_id;
end;
$$;

revoke all on function public.post_payment_run(uuid) from public, anon;
grant execute on function public.post_payment_run(uuid) to authenticated;

-- The gate for a single payment, now also refusing a payment that belongs to a run ----------------------------------------

create or replace function public.post_payment(p_payment_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_type uuid;
  v_reference integer;
  v_numbering public.numbering_rule;
  v_short text;
  v_allocation record;
  v_run_number text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a payment';
  end if;

  select organisation_id, status, payment_date, transaction_type_id, reference
    into v_org, v_status, v_date, v_type, v_reference
  from public.payments where id = p_payment_id for update;
  if v_org is null then
    raise exception 'That payment could not be posted';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft payment can be posted';
  end if;
  select run.document_number into v_run_number
  from public.payments as payment
  join public.payment_runs as run on run.id = payment.payment_run_id
  where payment.id = p_payment_id;
  if v_run_number is not null and coalesce(current_setting('fintran.run_post', true), '') <> 'on' then
    raise exception 'This payment is part of payment run %. Post the run instead.', v_run_number;
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;

  -- A payment that sends money out and is above an approval rule, or to a supplier whose bank details changed recently,
  -- needs approval first.
  perform private.require_payment_approval(p_payment_id);

  -- Lock every target in id order, then compare what each planned allocation wants with what is open now.
  perform 1
  from public.transaction_headers
  where id in (select target_header_id from public.allocations where source_payment_id = p_payment_id and pending)
  order by id
  for update;

  select string_agg(format('%s (%s wanted, %s open)', coalesce(header.document_number, header.reference::text, 'a document'),
                           trim(to_char(planned.amount, 'FM999G999G999G990D00')),
                           trim(to_char(greatest(open.amount, 0), 'FM999G999G999G990D00'))), ', ' order by header.id)
    into v_short
  from (
    select target_header_id, sum(amount) as amount
    from public.allocations where source_payment_id = p_payment_id and pending
    group by target_header_id
  ) as planned
  join public.transaction_headers as header on header.id = planned.target_header_id
  cross join lateral (
    select header.foreign_total_amount + header.rounding_amount - private.header_settled(header.id, null) as amount
  ) as open
  where header.status is distinct from 'posted' or planned.amount > open.amount;
  if v_short is not null then
    raise exception 'These documents no longer have enough open: %', v_short;
  end if;

  select numbering into v_numbering from public.transaction_types where id = v_type;
  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  perform set_config('fintran.status_change', 'on', true);
  update public.payments
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      reference = v_reference
  where id = p_payment_id;
  perform set_config('fintran.status_change', 'off', true);

  -- The planned allocations take effect, targets in id order. The allocation trigger sets their dates and home
  -- amounts, checks the lock date and checks every amount again.
  for v_allocation in
    select id from public.allocations where source_payment_id = p_payment_id and pending order by target_header_id, id
  loop
    update public.allocations set pending = false where id = v_allocation.id;
  end loop;
end;
$$;

-- Waiting and refused: documents, payments and runs together ----------------------------------------------------------------

drop function public.approval_queue(uuid);

create function public.approval_queue(p_organisation_id uuid)
returns table (
  header_id uuid,
  state text,
  type_code text,
  document_number text,
  party text,
  amount numeric,
  requested_by_name text,
  requested_at timestamp with time zone,
  decided_by_name text,
  decided_at timestamp with time zone,
  note text,
  item_kind text
)
language plpgsql stable security definer
set search_path to ''
as $$
declare
  h record;
  c record;
  v_state text;
  v_roles text[];
  v_decide boolean;
begin
  if not (select private.is_org_member(p_organisation_id)) then
    return;
  end if;
  for h in
    select header.id, header.document_number, header.home_total_amount, header.approval_requested_by, header.approval_requested_at,
           header.approval_decided_by, header.approval_decided_at, header.approval_note, header.supplier_id, kind.code
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    where header.organisation_id = p_organisation_id
      and header.status = 'draft'
      and header.approval_status in ('requested', 'rejected')
    order by coalesce(header.approval_requested_at, header.created_at)
  loop
    select * into c from private.approval_check(h.id);
    if not c.needed then
      continue;
    end if;
    v_state := private.approval_state(h.id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_decide := v_state = 'requested'
      and (select private.has_org_role(p_organisation_id, v_roles))
      and (
        h.approval_requested_by is distinct from (select auth.uid())
        or not exists (
          select 1 from public.organisation_access as access
          where access.organisation_id = p_organisation_id and access.user_id <> (select auth.uid()) and access.role = any (v_roles)
        )
      );
    if not (v_decide or (v_state = 'rejected' and h.approval_requested_by is not distinct from (select auth.uid()))) then
      continue;
    end if;
    return query select
      h.id,
      case when v_state = 'requested' then 'waiting' else 'refused' end,
      h.code,
      h.document_number,
      (select supplier.name from public.suppliers as supplier where supplier.id = h.supplier_id),
      h.home_total_amount,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_requested_by),
      h.approval_requested_at,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_decided_by),
      h.approval_decided_at,
      h.approval_note,
      'document'::text;
  end loop;

  for h in
    select payment.id, payment.document_number, payment.home_amount, payment.party_name, payment.approval_requested_by,
           payment.approval_requested_at, payment.approval_decided_by, payment.approval_decided_at, payment.approval_note, kind.code
    from public.payments as payment
    join public.transaction_types as kind on kind.id = payment.transaction_type_id
    where payment.organisation_id = p_organisation_id
      and payment.status = 'draft'
      and payment.approval_status in ('requested', 'rejected')
    order by coalesce(payment.approval_requested_at, payment.created_at)
  loop
    select * into c from private.payment_approval_check(h.id);
    if not c.needed then
      continue;
    end if;
    v_state := private.payment_approval_state(h.id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_decide := v_state = 'requested'
      and (select private.has_org_role(p_organisation_id, v_roles))
      and h.approval_requested_by is distinct from (select auth.uid());
    if not (v_decide or (v_state = 'rejected' and h.approval_requested_by is not distinct from (select auth.uid()))) then
      continue;
    end if;
    return query select
      h.id,
      case when v_state = 'requested' then 'waiting' else 'refused' end,
      h.code,
      h.document_number,
      h.party_name,
      h.home_amount,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_requested_by),
      h.approval_requested_at,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_decided_by),
      h.approval_decided_at,
      h.approval_note,
      'payment'::text;
  end loop;

  for h in
    select run.id, run.document_number, run.approval_requested_by, run.approval_requested_at, run.approval_decided_by,
           run.approval_decided_at, run.approval_note, kind.code,
           (select coalesce(sum(payment.home_amount), 0) from public.payments as payment where payment.payment_run_id = run.id) as home_total
    from public.payment_runs as run
    join public.transaction_types as kind on kind.id = run.transaction_type_id
    where run.organisation_id = p_organisation_id
      and run.status = 'draft'
      and run.approval_status in ('requested', 'rejected')
    order by coalesce(run.approval_requested_at, run.created_at)
  loop
    select * into c from private.run_approval_check(h.id);
    if not c.needed then
      continue;
    end if;
    v_state := private.run_approval_state(h.id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_decide := v_state = 'requested'
      and (select private.has_org_role(p_organisation_id, v_roles))
      and h.approval_requested_by is distinct from (select auth.uid());
    if not (v_decide or (v_state = 'rejected' and h.approval_requested_by is not distinct from (select auth.uid()))) then
      continue;
    end if;
    return query select
      h.id,
      case when v_state = 'requested' then 'waiting' else 'refused' end,
      h.code,
      h.document_number,
      'Payment run'::text,
      h.home_total,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_requested_by),
      h.approval_requested_at,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_decided_by),
      h.approval_decided_at,
      h.approval_note,
      'run'::text;
  end loop;
end;
$$;


revoke all on function public.approval_queue(uuid) from public, anon;
grant execute on function public.approval_queue(uuid) to authenticated;

