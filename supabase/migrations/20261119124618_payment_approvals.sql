-- Payment approvals (specs/QULAPLUS_PAYMENT_APPROVALS_SPEC.md, phase 2).
--
-- A payment that sends money out (a supplier payment or a customer refund) can need approval before it is posted: from an
-- amount set by a rule, or whatever its amount when the supplier's bank details changed inside the organisation's window.
-- The gate sits in post_payment. Unlike documents, the person who asked can never decide, even when nobody else could.
-- With no rule and no bank change window, nothing changes for anyone.

-- Rules for payment types ---------------------------------------------------------------------------------------------

create or replace function private.enforce_approval_rule() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_tenant uuid;
  v_direction text;
  v_kind text;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'An approval rule cannot be moved to another organisation or type';
  end if;

  select tenant_id into v_tenant from public.organisations where id = new.organisation_id;
  if v_tenant is null or v_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  select type, document_kind::text into v_direction, v_kind
  from public.transaction_types
  where id = new.transaction_type_id and organisation_id = new.organisation_id;
  if not ((v_direction = 'Purchases' and v_kind in ('invoice', 'order')) or v_kind = 'payment') then
    raise exception 'Approval rules are for purchase invoices, purchase orders and payments that send money out';
  end if;

  new.amount := round(new.amount, 2);
  return new;
end;
$$;

-- Approval columns on a payment ----------------------------------------------------------------------------------------

alter table public.payments
  add column approval_status text,
  add column approval_required_role text,
  add column approval_reason text,
  add column approval_requested_by uuid,
  add column approval_requested_at timestamp with time zone,
  add column approval_decided_by uuid,
  add column approval_decided_at timestamp with time zone,
  add column approval_note text,
  add column approval_self boolean not null default false,
  add column approval_hash text,
  add constraint payments_approval_status_check check (approval_status is null or approval_status in ('requested', 'approved', 'rejected')),
  add constraint payments_approval_role_check check (approval_required_role is null or approval_required_role in ('admin', 'owner')),
  add constraint payments_approval_reason_check check (approval_reason is null or approval_reason in ('amount', 'bank details', 'amount and bank details')),
  add constraint payments_approval_note_check check (approval_note is null or char_length(approval_note) <= 500),
  add constraint payments_approval_requested_by_fkey foreign key (approval_requested_by) references public.profiles (id) on delete set null,
  add constraint payments_approval_decided_by_fkey foreign key (approval_decided_by) references public.profiles (id) on delete set null;

create index payments_approval_requested_by_idx on public.payments (approval_requested_by);
create index payments_approval_decided_by_idx on public.payments (approval_decided_by);
create index payments_approval_status_idx on public.payments (organisation_id, approval_status) where approval_status is not null;

comment on column public.payments.approval_status is 'requested, approved or rejected. Null when approval was never asked for. Whether it still holds is worked out from approval_hash, so any change to the payment or its planned allocations cancels it.';

-- The guard that keeps people away from the approval columns of a document works unchanged here: the columns have the same names.
create trigger zzy_guard_approval before insert or update on public.payments
  for each row execute function private.guard_approval_columns();

-- The check ---------------------------------------------------------------------------------------------------------------

-- A fingerprint of the payment and what it plans to settle, leaving out who touched it and the approval itself.
create function private.payment_approval_hash(p_payment_id uuid) returns text
  language sql stable security definer
  set search_path to ''
as $$
  select encode(extensions.digest(convert_to(
    coalesce((
      select (to_jsonb(payment)
        - 'approval_status' - 'approval_required_role' - 'approval_reason' - 'approval_requested_by' - 'approval_requested_at'
        - 'approval_decided_by' - 'approval_decided_at' - 'approval_note' - 'approval_self' - 'approval_hash'
        - 'created_at' - 'created_by' - 'updated_at' - 'updated_by')::text
      from public.payments as payment where payment.id = p_payment_id
    ), '')
    || '|' ||
    coalesce((
      select jsonb_agg(jsonb_build_object('target', allocation.target_header_id, 'amount', allocation.amount)
                       order by allocation.target_header_id, allocation.amount)::text
      from public.allocations as allocation
      where allocation.source_payment_id = p_payment_id and allocation.pending
    ), ''),
  'utf8'), 'sha256'), 'hex')
$$;

revoke all on function private.payment_approval_hash(uuid) from public, anon, authenticated, service_role;

-- Whether a draft payment needs approval, from whom, and why. Only a draft payment that sends money out can.
create function private.payment_approval_check(p_payment_id uuid)
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
  v_kind text;
  v_rule_role text;
  v_bank boolean;
begin
  select payment.organisation_id, payment.status, payment.transaction_type_id, payment.home_amount, payment.supplier_id, kind.document_kind::text
    into v_org, v_status, v_type, v_home, v_supplier, v_kind
  from public.payments as payment
  join public.transaction_types as kind on kind.id = payment.transaction_type_id
  where payment.id = p_payment_id;

  if v_org is null or v_status is distinct from 'draft' or v_kind is distinct from 'payment' then
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

revoke all on function private.payment_approval_check(uuid) from public, anon, authenticated, service_role;

create function private.payment_approval_state(p_payment_id uuid) returns text
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  c record;
  h record;
begin
  select * into c from private.payment_approval_check(p_payment_id);
  if not c.needed then
    return 'none';
  end if;
  select approval_status, approval_hash, approval_required_role into h from public.payments where id = p_payment_id;
  if h.approval_status is null
     or h.approval_hash is distinct from private.payment_approval_hash(p_payment_id)
     or private.role_rank(c.role) > private.role_rank(h.approval_required_role) then
    return 'required';
  end if;
  return h.approval_status;
end;
$$;

revoke all on function private.payment_approval_state(uuid) from public, anon, authenticated, service_role;

-- Called by post_payment: refuses with what to do next.
create function private.require_payment_approval(p_payment_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  c record;
  v_state text;
  v_who text;
  v_note text;
begin
  select * into c from private.payment_approval_check(p_payment_id);
  if not c.needed then
    return;
  end if;
  v_state := private.payment_approval_state(p_payment_id);
  if v_state = 'approved' then
    return;
  end if;
  v_who := case c.role when 'owner' then 'an owner' else 'an admin or owner' end;
  if v_state = 'requested' then
    raise exception 'Waiting for approval from %.', v_who;
  end if;
  if v_state = 'rejected' then
    select approval_note into v_note from public.payments where id = p_payment_id;
    raise exception 'Approval was refused: %.', coalesce(nullif(v_note, ''), 'no reason was given');
  end if;
  raise exception 'This payment needs approval from %. Request approval first.', v_who;
end;
$$;

revoke all on function private.require_payment_approval(uuid) from public, anon, authenticated, service_role;

-- Email ---------------------------------------------------------------------------------------------------------------------

-- An email is about a document or about a payment, never both.
alter table public.email_outbox
  alter column header_id drop not null,
  add column payment_id uuid,
  add constraint email_outbox_payment_id_fkey foreign key (payment_id) references public.payments (id) on delete cascade,
  add constraint email_outbox_subject_check check ((header_id is not null) <> (payment_id is not null));

create index email_outbox_payment_id_idx on public.email_outbox (payment_id);

create function private.queue_payment_approval_emails(p_payment_id uuid, p_reason text) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  h record;
  c record;
  v_on boolean;
  v_roles text[];
  v_label text;
  v_amount text;
  v_link text;
  v_subject text;
  v_body text;
  r record;
begin
  select payment.organisation_id, payment.tenant_id, payment.document_number, payment.home_amount, payment.party_name,
         payment.approval_requested_by, payment.approval_decided_by, payment.approval_note, kind.code as type_code,
         (select profile.display_name from public.profiles as profile where profile.id = payment.approval_requested_by) as requester,
         (select profile.display_name from public.profiles as profile where profile.id = payment.approval_decided_by) as decider
    into h
  from public.payments as payment
  join public.transaction_types as kind on kind.id = payment.transaction_type_id
  where payment.id = p_payment_id;
  if h.organisation_id is null then
    return;
  end if;

  select defaults.approval_emails into v_on from public.organisation_defaults as defaults where defaults.organisation_id = h.organisation_id;
  if not coalesce(v_on, true) then
    return;
  end if;

  v_label := h.type_code || ' ' || coalesce(h.document_number, 'draft');
  v_amount := '€' || to_char(round(coalesce(h.home_amount, 0), 2), 'FM999,999,999,990.00');
  v_link := '/transactions/' || h.type_code || '?open=' || p_payment_id;

  if p_reason = 'approval requested' then
    select * into c from private.payment_approval_check(p_payment_id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_subject := 'Payment approval needed: ' || v_label || ' for ' || v_amount;
    v_body := coalesce(h.requester, 'Someone') || ' asked for approval of ' || v_label || ' to ' || h.party_name || ', ' || v_amount || '.'
      || case c.reason when 'bank details' then E'\n\nThe supplier''s bank details changed recently.' when 'amount and bank details' then E'\n\nThe supplier''s bank details changed recently.' else '' end
      || coalesce(E'\n\nNote: ' || h.approval_note, '');
    for r in
      select profile.id, profile.email, profile.display_name
      from public.organisation_access as access
      join public.profiles as profile on profile.id = access.user_id
      where access.organisation_id = h.organisation_id
        and access.role = any (v_roles)
        and access.user_id is distinct from (select auth.uid())
    loop
      insert into public.email_outbox (tenant_id, organisation_id, payment_id, recipient_id, recipient_email, recipient_name, reason, subject, body, link_path)
      values (h.tenant_id, h.organisation_id, p_payment_id, r.id, r.email, r.display_name, p_reason, v_subject, v_body, v_link);
    end loop;
  else
    if h.approval_requested_by is null or h.approval_requested_by is not distinct from (select auth.uid()) then
      return;
    end if;
    v_subject := case p_reason when 'approved' then 'Payment approved: ' else 'Payment refused: ' end || v_label;
    v_body := case p_reason
        when 'approved' then coalesce(h.decider, 'Someone') || ' approved ' || v_label || ' to ' || h.party_name || ' for ' || v_amount || '. It can be posted.'
        else coalesce(h.decider, 'Someone') || ' refused approval of ' || v_label || ' to ' || h.party_name || ' for ' || v_amount || '.'
      end
      || case when p_reason = 'rejected' then E'\n\nReason: ' || coalesce(h.approval_note, '') else coalesce(E'\n\nNote: ' || h.approval_note, '') end;
    insert into public.email_outbox (tenant_id, organisation_id, payment_id, recipient_id, recipient_email, recipient_name, reason, subject, body, link_path)
    select h.tenant_id, h.organisation_id, p_payment_id, profile.id, profile.email, profile.display_name, p_reason, v_subject, v_body, v_link
    from public.profiles as profile
    where profile.id = h.approval_requested_by;
  end if;
end;
$$;

revoke all on function private.queue_payment_approval_emails(uuid, text) from public, anon, authenticated, service_role;

create function public.queued_payment_emails(p_payment_id uuid)
returns table (id uuid, recipient_email text, recipient_name text, subject text, body text, link_path text)
language sql stable security definer
set search_path to ''
as $$
  select outbox.id, outbox.recipient_email, outbox.recipient_name, outbox.subject, outbox.body, outbox.link_path
  from public.email_outbox as outbox
  where outbox.payment_id = p_payment_id
    and outbox.status = 'queued'
    and outbox.created_by = (select auth.uid())
    and (select private.is_org_member(outbox.organisation_id))
  order by outbox.created_at
$$;

revoke all on function public.queued_payment_emails(uuid) from public, anon;
grant execute on function public.queued_payment_emails(uuid) to authenticated;

-- Asking, giving and refusing ---------------------------------------------------------------------------------------------

create function public.request_payment_approval(p_payment_id uuid, p_note text default null) returns void
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
  select organisation_id into v_org from public.payments where id = p_payment_id for update;
  if v_org is null then
    raise exception 'That payment could not be found';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'The note can be up to 500 characters';
  end if;

  select * into c from private.payment_approval_check(p_payment_id);
  if not c.needed then
    raise exception 'This payment does not need approval';
  end if;
  v_state := private.payment_approval_state(p_payment_id);
  if v_state = 'approved' then
    raise exception 'This payment is already approved';
  end if;
  if v_state = 'requested' then
    raise exception 'Approval has already been asked for';
  end if;

  perform set_config('fintran.approval_change', 'on', true);
  update public.payments
  set approval_status = 'requested',
      approval_required_role = c.role,
      approval_reason = c.reason,
      approval_requested_by = (select auth.uid()),
      approval_requested_at = now(),
      approval_decided_by = null,
      approval_decided_at = null,
      approval_note = nullif(btrim(p_note), ''),
      approval_self = false,
      approval_hash = private.payment_approval_hash(p_payment_id)
  where id = p_payment_id;
  perform set_config('fintran.approval_change', 'off', true);
  perform private.queue_payment_approval_emails(p_payment_id, 'approval requested');
end;
$$;

revoke all on function public.request_payment_approval(uuid, text) from public, anon;
grant execute on function public.request_payment_approval(uuid, text) to authenticated;

-- Shared by approving and refusing: the payment must be waiting, the person must have the role, and the person who asked
-- can never decide it, even when nobody else could.
create function private.check_payment_approver(p_payment_id uuid) returns void
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
  select organisation_id, approval_requested_by into v_org, v_requester
  from public.payments where id = p_payment_id for update;
  if v_org is null then
    raise exception 'That payment could not be found';
  end if;
  select * into c from private.payment_approval_check(p_payment_id);
  if not c.needed then
    raise exception 'This payment does not need approval';
  end if;
  v_state := private.payment_approval_state(p_payment_id);
  if v_state = 'required' then
    raise exception 'Approval has not been asked for this version of the payment. Ask again.';
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

revoke all on function private.check_payment_approver(uuid) from public, anon, authenticated, service_role;

create function public.approve_payment(p_payment_id uuid, p_note text default null) returns void
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'The note can be up to 500 characters';
  end if;
  perform private.check_payment_approver(p_payment_id);
  perform set_config('fintran.approval_change', 'on', true);
  update public.payments
  set approval_status = 'approved',
      approval_decided_by = (select auth.uid()),
      approval_decided_at = now(),
      approval_note = coalesce(nullif(btrim(p_note), ''), approval_note),
      approval_self = false
  where id = p_payment_id;
  perform set_config('fintran.approval_change', 'off', true);
  perform private.queue_payment_approval_emails(p_payment_id, 'approved');
end;
$$;

revoke all on function public.approve_payment(uuid, text) from public, anon;
grant execute on function public.approve_payment(uuid, text) to authenticated;

create function public.reject_payment(p_payment_id uuid, p_reason text) returns void
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
  perform private.check_payment_approver(p_payment_id);
  perform set_config('fintran.approval_change', 'on', true);
  update public.payments
  set approval_status = 'rejected',
      approval_decided_by = (select auth.uid()),
      approval_decided_at = now(),
      approval_note = v_reason,
      approval_self = false
  where id = p_payment_id;
  perform set_config('fintran.approval_change', 'off', true);
  perform private.queue_payment_approval_emails(p_payment_id, 'rejected');
end;
$$;

revoke all on function public.reject_payment(uuid, text) from public, anon;
grant execute on function public.reject_payment(uuid, text) to authenticated;

-- Where each of several payments stands, for the lists and the open payment. Only payments that need approval are returned.
create function public.payment_approval_status(p_payment_ids uuid[])
returns table (
  payment_id uuid,
  state text,
  required_role text,
  reason text,
  requested_by_name text,
  requested_at timestamp with time zone,
  decided_by_name text,
  decided_at timestamp with time zone,
  note text,
  can_decide boolean
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
  foreach v_id in array coalesce(p_payment_ids, array[]::uuid[])
  loop
    select payment.organisation_id, payment.approval_requested_by, payment.approval_requested_at, payment.approval_decided_by,
           payment.approval_decided_at, payment.approval_note
      into h
    from public.payments as payment
    where payment.id = v_id;
    if not found or not (select private.is_org_member(h.organisation_id)) then
      continue;
    end if;

    select * into c from private.payment_approval_check(v_id);
    if not c.needed then
      continue;
    end if;
    v_state := private.payment_approval_state(v_id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_decide := v_state = 'requested'
      and (select private.has_org_role(h.organisation_id, v_roles))
      and h.approval_requested_by is distinct from (select auth.uid());

    return query select
      v_id,
      v_state,
      c.role,
      c.reason,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_requested_by),
      h.approval_requested_at,
      (select profile.display_name from public.profiles as profile where profile.id = h.approval_decided_by),
      h.approval_decided_at,
      h.approval_note,
      v_decide;
  end loop;
end;
$$;

revoke all on function public.payment_approval_status(uuid[]) from public, anon;
grant execute on function public.payment_approval_status(uuid[]) to authenticated;

-- The gate -----------------------------------------------------------------------------------------------------------------

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
