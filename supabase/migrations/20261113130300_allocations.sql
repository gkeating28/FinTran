-- Payments release B, phase 3: allocations and settlement (QULAPLUS_PAYMENTS_SPEC.md, 3.1 to 3.5 and 3.10 to 3.11).
--
-- An allocation applies part or all of a payment, a receipt or a credit note to an open invoice or credit note.
-- People cannot write the table. The functions at the end do, and the trigger checks every rule.

create table public.allocations (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  source_payment_id uuid,
  source_header_id uuid,
  target_header_id uuid not null,
  amount numeric(18, 2) not null,
  allocation_date date not null,
  home_amount_at_target_rate numeric(18, 2) not null default 0,
  home_amount_at_source_rate numeric(18, 2) not null default 0,
  exchange_difference numeric(18, 2) not null default 0,
  pending boolean not null default false,
  removed_at timestamp with time zone,
  removed_by uuid,
  removal_reason text,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint allocations_pkey primary key (id),
  constraint allocations_organisation_id_id_key unique (organisation_id, id),
  constraint allocations_one_source_check check ((source_payment_id is null) <> (source_header_id is null)),
  constraint allocations_amount_check check (amount > 0),
  constraint allocations_removed_check check ((removed_at is null) = (removal_reason is null)),
  constraint allocations_pending_not_removed_check check (not pending or removed_at is null),
  constraint allocations_removal_reason_check check (removal_reason is null or (char_length(removal_reason) >= 1 and char_length(removal_reason) <= 500)),
  constraint allocations_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete restrict,
  constraint allocations_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete restrict,
  constraint allocations_source_payment_fkey foreign key (organisation_id, source_payment_id) references public.payments (organisation_id, id) on delete restrict,
  constraint allocations_source_header_fkey foreign key (organisation_id, source_header_id) references public.transaction_headers (organisation_id, id) on delete restrict,
  constraint allocations_target_header_fkey foreign key (organisation_id, target_header_id) references public.transaction_headers (organisation_id, id) on delete restrict,
  constraint allocations_removed_by_fkey foreign key (removed_by) references public.profiles (id) on delete set null,
  constraint allocations_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint allocations_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null
);

comment on table public.allocations is 'A payment, receipt or credit note applied to an invoice or credit note. Effective means not pending and not removed. A removal is recorded, not deleted.';
comment on column public.allocations.pending is 'True while the source payment is a draft. A pending allocation has no effect until the payment posts.';
comment on column public.allocations.exchange_difference is 'Home currency gain (positive) or loss for the organisation. Not posted anywhere: kept for the accounting integration.';

create index allocations_organisation_id_idx on public.allocations (organisation_id);
create index allocations_tenant_id_idx on public.allocations (tenant_id);
create index allocations_source_payment_idx on public.allocations (organisation_id, source_payment_id);
create index allocations_source_header_idx on public.allocations (organisation_id, source_header_id);
create index allocations_target_header_idx on public.allocations (organisation_id, target_header_id);
create index allocations_removed_by_idx on public.allocations (removed_by);
create index allocations_created_by_idx on public.allocations (created_by);
create index allocations_updated_by_idx on public.allocations (updated_by);
create index allocations_effective_target_idx on public.allocations (target_header_id) where removed_at is null and not pending;
create index allocations_effective_source_payment_idx on public.allocations (source_payment_id) where removed_at is null and not pending;
create index allocations_effective_source_header_idx on public.allocations (source_header_id) where removed_at is null and not pending;

-- What a document or a payment has settled, from effective allocations. A credit note is settled by what is applied
-- from it and by what is refunded against it. An allocation never has the same document on both sides.
create function private.header_settled(p_header_id uuid, p_except uuid) returns numeric
  language sql stable security definer
  set search_path to ''
as $$
  select coalesce(sum(amount), 0)
  from public.allocations
  where removed_at is null and not pending
    and id is distinct from p_except
    and (target_header_id = p_header_id or source_header_id = p_header_id);
$$;

create function private.header_home_settled(p_header_id uuid, p_except uuid) returns numeric
  language sql stable security definer
  set search_path to ''
as $$
  select coalesce(sum(case when target_header_id = p_header_id then home_amount_at_target_rate else home_amount_at_source_rate end), 0)
  from public.allocations
  where removed_at is null and not pending
    and id is distinct from p_except
    and (target_header_id = p_header_id or source_header_id = p_header_id);
$$;

revoke all on function private.header_settled(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.header_home_settled(uuid, uuid) from public, anon, authenticated, service_role;

-- The one place that writes paid_amount, amount_due and home_amount_due on documents, and allocated_amount,
-- unallocated_amount and home_unallocated_amount on payments. Void documents are never refreshed.
create function private.refresh_settlement(p_header_ids uuid[], p_payment_ids uuid[]) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_flag text := current_setting('fintran.settlement', true);
  v_id uuid;
  v_paid numeric;
  v_home numeric;
begin
  perform set_config('fintran.settlement', 'on', true);

  for v_id in select distinct id from unnest(p_header_ids) as id where id is not null order by 1 loop
    select coalesce(sum(amount), 0),
           coalesce(sum(case when target_header_id = v_id then home_amount_at_target_rate else home_amount_at_source_rate end), 0)
      into v_paid, v_home
    from public.allocations
    where removed_at is null and not pending
      and (target_header_id = v_id or source_header_id = v_id);

    update public.transaction_headers
    set paid_amount = v_paid,
        amount_due = round(foreign_total_amount + rounding_amount - v_paid, 2),
        home_amount_due = home_total_amount - v_home
    where id = v_id and status = 'posted';
  end loop;

  for v_id in select distinct id from unnest(p_payment_ids) as id where id is not null order by 1 loop
    select coalesce(sum(amount), 0), coalesce(sum(home_amount_at_source_rate), 0)
      into v_paid, v_home
    from public.allocations
    where removed_at is null and not pending and source_payment_id = v_id;

    update public.payments
    set allocated_amount = v_paid,
        unallocated_amount = amount - v_paid,
        home_unallocated_amount = case when v_paid = amount then 0 else home_amount - v_home end
    where id = v_id and status = 'posted';
  end loop;

  perform set_config('fintran.settlement', coalesce(nullif(v_flag, ''), 'off'), true);
end;
$$;

revoke all on function private.refresh_settlement(uuid[], uuid[]) from public, anon, authenticated, service_role;

-- Every rule for an allocation. Source then target are locked before anything is read, so two allocations cannot take
-- the same open amount, and every function that allocates locks in that order.
create function private.enforce_allocation() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_src record;
  v_tgt record;
  v_source_kind text;
  v_source_direction text;
  v_want_kind text;
  v_effective boolean;
  v_minimum date;
  v_used numeric;
  v_open numeric;
  v_receivable boolean;
  v_src_rate numeric;
  v_home_target numeric;
  v_home_source numeric;
  v_migrating boolean := coalesce(current_setting('fintran.migration', true) = 'on', false);
  v_reason text;
begin
  if tg_op = 'DELETE' then
    if not old.pending then
      raise exception 'An allocation cannot be deleted. Remove it instead.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.source_payment_id is distinct from old.source_payment_id
       or new.source_header_id is distinct from old.source_header_id
       or new.target_header_id is distinct from old.target_header_id
       or new.amount is distinct from old.amount then
      raise exception 'An allocation cannot be edited. Remove it and add a new one.';
    end if;
    if old.removed_at is not null then
      raise exception 'A removed allocation cannot be changed';
    end if;
    if not old.pending and not new.pending and new.removed_at is null then
      raise exception 'An allocation cannot be edited. Remove it and add a new one.';
    end if;
    if old.pending and new.pending and new.removed_at is null then
      raise exception 'An allocation cannot be edited. Remove it and add a new one.';
    end if;
    if new.removed_at is not null and new.pending then
      raise exception 'A pending allocation is deleted, not removed';
    end if;
  end if;

  -- Lock the source, then the target.
  if new.source_payment_id is not null then
    select payment.status::text as status, payment.organisation_id, payment.customer_id, payment.supplier_id,
           payment.currency_id, payment.exchange_rate, payment.amount, payment.home_amount, payment.payment_date as source_date,
           type.type as direction, type.document_kind::text as kind, payment.document_number
      into v_src
    from public.payments as payment
    join public.transaction_types as type on type.id = payment.transaction_type_id
    where payment.id = new.source_payment_id
    for update of payment;
  else
    select header.status::text as status, header.organisation_id, header.customer_id, header.supplier_id,
           header.currency_id, header.exchange_rate, header.foreign_total_amount as amount, header.home_total_amount as home_amount,
           header.transaction_date as source_date, header.rounding_amount,
           type.type as direction, type.document_kind::text as kind, header.document_number
      into v_src
    from public.transaction_headers as header
    join public.transaction_types as type on type.id = header.transaction_type_id
    where header.id = new.source_header_id
    for update of header;
  end if;
  if v_src.status is null then
    raise exception 'The payment or credit note was not found';
  end if;

  select header.status::text as status, header.organisation_id, header.customer_id, header.supplier_id,
         header.currency_id, header.exchange_rate, header.foreign_total_amount as total, header.rounding_amount,
         header.home_total_amount as home_total, header.transaction_date as target_date,
         type.type as direction, type.document_kind::text as kind, header.document_number
    into v_tgt
  from public.transaction_headers as header
  join public.transaction_types as type on type.id = header.transaction_type_id
  where header.id = new.target_header_id
  for update of header;
  if v_tgt.status is null then
    raise exception 'The document to settle was not found';
  end if;

  -- Rows from another organisation are refused by the composite foreign keys, which say so.
  if v_src.organisation_id is distinct from new.organisation_id or v_tgt.organisation_id is distinct from new.organisation_id then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.removed_at is not null then
    -- Removal.
    v_reason := nullif(btrim(new.removal_reason), '');
    if v_reason is null then
      raise exception 'Enter a reason for removing this allocation';
    end if;
    new.removal_reason := v_reason;
    new.removed_at := now();
    new.removed_by := auth.uid();
    if not v_migrating and (private.document_period_locked(old.organisation_id, old.allocation_date)
                            or private.document_period_locked(old.organisation_id, current_date)) then
      raise exception 'This date is in a locked period';
    end if;
    return new;
  end if;

  -- Insert, or a pending allocation becoming effective: the pair, the party and the amounts are checked.
  if tg_op = 'INSERT' and (new.removed_at is not null or new.removed_by is not null or new.removal_reason is not null) then
    raise exception 'A new allocation cannot be removed';
  end if;

  if new.source_payment_id is not null then
    if v_src.status = 'void' then
      raise exception 'A void payment cannot be allocated';
    end if;
    v_source_kind := v_src.kind;
    v_source_direction := v_src.direction;
    v_want_kind := case
      when (v_source_kind = 'receipt' and v_source_direction = 'Sales') or (v_source_kind = 'payment' and v_source_direction = 'Purchases') then 'invoice'
      when (v_source_kind = 'payment' and v_source_direction = 'Sales') or (v_source_kind = 'receipt' and v_source_direction = 'Purchases') then 'credit_note'
    end;
    if tg_op = 'INSERT' then
      new.pending := v_src.status = 'draft';
    end if;
  else
    if v_src.kind is distinct from 'credit_note' then
      raise exception 'Only a credit note can be applied to an invoice';
    end if;
    if v_src.status is distinct from 'posted' then
      raise exception 'A credit note must be posted before it is applied';
    end if;
    v_source_direction := v_src.direction;
    v_want_kind := 'invoice';
    new.pending := false;
  end if;
  v_effective := not new.pending;

  if v_tgt.status is distinct from 'posted' or v_tgt.kind not in ('invoice', 'credit_note') then
    raise exception 'Only a posted invoice or credit note can be settled';
  end if;
  if v_tgt.kind is distinct from v_want_kind or v_tgt.direction is distinct from v_source_direction then
    raise exception 'A % cannot be applied to this %',
      case when new.source_payment_id is not null then 'payment' else 'credit note' end,
      case v_tgt.kind when 'invoice' then 'invoice' else 'credit note' end;
  end if;
  if v_source_direction = 'Sales' and v_src.customer_id is distinct from v_tgt.customer_id then
    raise exception 'The payment and the document must be for the same customer';
  end if;
  if v_source_direction = 'Purchases' and v_src.supplier_id is distinct from v_tgt.supplier_id then
    raise exception 'The payment and the document must be for the same supplier';
  end if;
  if v_src.currency_id is distinct from v_tgt.currency_id then
    raise exception 'The payment and the document must be in the same currency';
  end if;

  -- Dates: the later of the two documents, or later, never earlier. A pending allocation takes its final date when it
  -- becomes effective.
  v_minimum := greatest(v_src.source_date, v_tgt.target_date);
  if new.allocation_date is null then
    new.allocation_date := v_minimum;
  elsif new.allocation_date < v_minimum then
    if tg_op = 'UPDATE' then
      new.allocation_date := v_minimum;
    else
      raise exception 'The allocation date cannot be before the payment or the document';
    end if;
  end if;

  -- Over-allocation is refused (K9). A target's open amount never goes below zero.
  v_used := private.header_settled(new.target_header_id, new.id);
  v_open := v_tgt.total + v_tgt.rounding_amount - v_used;
  if new.amount > v_open then
    raise exception '% has % still due, so % cannot be allocated to it',
      coalesce(v_tgt.document_number, 'The document'), trim(to_char(greatest(v_open, 0), 'FM999G999G999G990D00')), trim(to_char(new.amount, 'FM999G999G999G990D00'));
  end if;

  if new.source_payment_id is not null then
    select coalesce(sum(amount), 0) into v_used
    from public.allocations
    where source_payment_id = new.source_payment_id and removed_at is null and id is distinct from new.id;
    if v_used + new.amount > v_src.amount then
      raise exception 'The payment has only % left to allocate', trim(to_char(greatest(v_src.amount - v_used, 0), 'FM999G999G999G990D00'));
    end if;
  else
    v_used := private.header_settled(new.source_header_id, new.id);
    if v_used + new.amount > v_src.amount + v_src.rounding_amount then
      raise exception 'The credit note has only % left to apply', trim(to_char(greatest(v_src.amount + v_src.rounding_amount - v_used, 0), 'FM999G999G999G990D00'));
    end if;
  end if;

  if not v_effective then
    -- Pending: figures are worked out when the payment posts.
    new.home_amount_at_target_rate := 0;
    new.home_amount_at_source_rate := 0;
    new.exchange_difference := 0;
    return new;
  end if;

  if not v_migrating and private.document_period_locked(new.organisation_id, new.allocation_date) then
    raise exception 'This date is in a locked period';
  end if;

  -- Home amounts. The allocation that settles a document, or uses up a payment, takes the home balance that is left,
  -- so a settled document always ends with nothing due at home.
  v_src_rate := v_src.exchange_rate;
  v_home_target := round(new.amount / v_tgt.exchange_rate, 2);
  if private.header_settled(new.target_header_id, new.id) + new.amount = v_tgt.total + v_tgt.rounding_amount then
    v_home_target := v_tgt.home_total - private.header_home_settled(new.target_header_id, new.id);
  end if;

  v_home_source := round(new.amount / v_src_rate, 2);
  if new.source_payment_id is not null then
    select coalesce(sum(amount), 0) into v_used
    from public.allocations
    where source_payment_id = new.source_payment_id and removed_at is null and not pending and id is distinct from new.id;
    if v_used + new.amount = v_src.amount then
      v_home_source := v_src.home_amount - coalesce((
        select sum(home_amount_at_source_rate) from public.allocations
        where source_payment_id = new.source_payment_id and removed_at is null and not pending and id is distinct from new.id
      ), 0);
    end if;
  elsif private.header_settled(new.source_header_id, new.id) + new.amount = v_src.amount + v_src.rounding_amount then
    v_home_source := v_src.home_amount - private.header_home_settled(new.source_header_id, new.id);
  end if;

  -- Equal rates mean no exchange difference, whatever the rounding.
  if v_src_rate = v_tgt.exchange_rate then
    v_home_source := v_home_target;
  end if;

  v_receivable := (v_tgt.direction = 'Sales' and v_tgt.kind = 'invoice') or (v_tgt.direction = 'Purchases' and v_tgt.kind = 'credit_note');
  new.home_amount_at_target_rate := v_home_target;
  new.home_amount_at_source_rate := v_home_source;
  new.exchange_difference := case when v_receivable then v_home_source - v_home_target else v_home_target - v_home_source end;
  return new;
end;
$$;

revoke all on function private.enforce_allocation() from public, anon, authenticated, service_role;

create function private.settle_after_allocation() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_settlement(array[old.target_header_id, old.source_header_id], array[old.source_payment_id]);
    return old;
  end if;
  perform private.refresh_settlement(array[new.target_header_id, new.source_header_id], array[new.source_payment_id]);
  return new;
end;
$$;

revoke all on function private.settle_after_allocation() from public, anon, authenticated, service_role;

create trigger aa_allocation_rules before insert or update or delete on public.allocations
  for each row execute function private.enforce_allocation();
create trigger zz_set_audit_columns before insert or update on public.allocations
  for each row execute function private.set_audit_columns();
create trigger zz_write_audit_log after insert or update or delete on public.allocations
  for each row execute function private.write_audit_log();
create trigger zz_settle after insert or update or delete on public.allocations
  for each row execute function private.settle_after_allocation();

alter table public.allocations enable row level security;
create policy allocations_select on public.allocations for select to authenticated
  using ((select private.is_org_member(allocations.organisation_id)));

-- Nobody writes allocations directly: the functions below do, and check membership themselves.
revoke all on table public.allocations from anon;
revoke insert, update, delete, truncate, references, trigger on table public.allocations from authenticated, service_role;

create function public.allocate(p_source jsonb, p_target_header_id uuid, p_amount numeric, p_date date default null) returns uuid
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_payment uuid;
  v_note uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before allocating';
  end if;
  select organisation_id, tenant_id into v_org, v_tenant
  from public.transaction_headers where id = p_target_header_id;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That document could not be found';
  end if;
  v_payment := nullif(p_source->>'paymentId', '')::uuid;
  v_note := nullif(p_source->>'creditNoteId', '')::uuid;
  if (v_payment is null) = (v_note is null) then
    raise exception 'Choose a payment or a credit note to apply';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount greater than 0 with at most 2 decimal places';
  end if;

  insert into public.allocations (tenant_id, organisation_id, source_payment_id, source_header_id, target_header_id, amount, allocation_date)
  values (v_tenant, v_org, v_payment, v_note, p_target_header_id, p_amount, p_date)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.remove_allocation(p_allocation_id uuid, p_reason text) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_removed timestamptz;
  v_pending boolean;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before removing an allocation';
  end if;
  select organisation_id, removed_at, pending into v_org, v_removed, v_pending
  from public.allocations where id = p_allocation_id;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That allocation could not be found';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a reason for removing this allocation';
  end if;
  if v_removed is not null then
    raise exception 'That allocation has already been removed';
  end if;
  if v_pending then
    raise exception 'A planned allocation on a draft payment is changed on the payment';
  end if;

  update public.allocations
  set removed_at = now(), removal_reason = v_reason
  where id = p_allocation_id;
end;
$$;

-- Applies what is left of a payment, receipt or credit note to the party's open documents, oldest due date first,
-- then oldest date, then lowest id. Returns how many allocations it made.
create function public.allocate_oldest_first(p_source jsonb) returns integer
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_payment uuid := nullif(p_source->>'paymentId', '')::uuid;
  v_note uuid := nullif(p_source->>'creditNoteId', '')::uuid;
  v_org uuid;
  v_customer uuid;
  v_supplier uuid;
  v_currency uuid;
  v_direction text;
  v_kind text;
  v_status text;
  v_want_kind text;
  v_left numeric;
  v_candidate record;
  v_amount numeric;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before allocating';
  end if;
  if (v_payment is null) = (v_note is null) then
    raise exception 'Choose a payment or a credit note to apply';
  end if;

  if v_payment is not null then
    select payment.organisation_id, payment.customer_id, payment.supplier_id, payment.currency_id, payment.status::text,
           type.type, type.document_kind::text,
           payment.amount - coalesce((select sum(allocation.amount) from public.allocations as allocation
             where allocation.source_payment_id = payment.id and allocation.removed_at is null), 0)
      into v_org, v_customer, v_supplier, v_currency, v_status, v_direction, v_kind, v_left
    from public.payments as payment
    join public.transaction_types as type on type.id = payment.transaction_type_id
    where payment.id = v_payment;
    v_want_kind := case
      when (v_kind = 'receipt' and v_direction = 'Sales') or (v_kind = 'payment' and v_direction = 'Purchases') then 'invoice'
      else 'credit_note'
    end;
  else
    select header.organisation_id, header.customer_id, header.supplier_id, header.currency_id, header.status::text,
           type.type, type.document_kind::text,
           header.foreign_total_amount + header.rounding_amount - header.paid_amount
      into v_org, v_customer, v_supplier, v_currency, v_status, v_direction, v_kind, v_left
    from public.transaction_headers as header
    join public.transaction_types as type on type.id = header.transaction_type_id
    where header.id = v_note;
    v_want_kind := 'invoice';
    if v_kind is distinct from 'credit_note' then
      raise exception 'Only a credit note can be applied to an invoice';
    end if;
  end if;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That payment or credit note could not be found';
  end if;
  if v_status = 'void' then
    raise exception 'A void payment cannot be allocated';
  end if;
  if v_left is null or v_left <= 0 then
    return 0;
  end if;

  -- Lock every candidate in id order before reading what is open on any of them.
  perform 1
  from public.transaction_headers as header
  join public.transaction_types as type on type.id = header.transaction_type_id
  where header.organisation_id = v_org and header.status = 'posted'
    and type.document_kind::text = v_want_kind and type.type = v_direction
    and header.currency_id = v_currency
    and (v_customer is null or header.customer_id = v_customer)
    and (v_supplier is null or header.supplier_id = v_supplier)
    and header.id is distinct from v_note
  order by header.id
  for update of header;

  for v_candidate in
    select header.id, header.foreign_total_amount + header.rounding_amount - header.paid_amount as open_amount
    from public.transaction_headers as header
    join public.transaction_types as type on type.id = header.transaction_type_id
    where header.organisation_id = v_org and header.status = 'posted'
      and type.document_kind::text = v_want_kind and type.type = v_direction
      and header.currency_id = v_currency
      and (v_customer is null or header.customer_id = v_customer)
      and (v_supplier is null or header.supplier_id = v_supplier)
      and header.id is distinct from v_note
      and header.foreign_total_amount + header.rounding_amount - header.paid_amount > 0
    order by header.due_date nulls last, header.transaction_date, header.id
  loop
    exit when v_left <= 0;
    v_amount := least(v_left, v_candidate.open_amount);
    perform public.allocate(p_source, v_candidate.id, v_amount, null);
    v_left := v_left - v_amount;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.allocate(jsonb, uuid, numeric, date) from public, anon;
revoke all on function public.remove_allocation(uuid, text) from public, anon;
revoke all on function public.allocate_oldest_first(jsonb) from public, anon;
grant execute on function public.allocate(jsonb, uuid, numeric, date) to authenticated;
grant execute on function public.remove_allocation(uuid, text) to authenticated;
grant execute on function public.allocate_oldest_first(jsonb) to authenticated;
