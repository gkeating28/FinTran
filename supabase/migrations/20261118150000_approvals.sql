-- Purchase approvals and price tolerance (specs/QULAPLUS_APPROVALS_SPEC.md, phases 1 and 2).
--
-- An owner or admin sets rules for a purchase order or purchase invoice type: from this amount, this role must approve.
-- A purchase invoice with a line priced over its order line, past a tolerance, also needs an admin. The gate sits in
-- post_document and in the Activate action of set_order_status, so every way of posting passes through it. With no rule
-- and no tolerance set, nothing changes for anyone.

-- Rules ----------------------------------------------------------------------------------------------------------

create table public.approval_rules (
  id uuid not null default gen_random_uuid(),
  tenant_id uuid not null,
  organisation_id uuid not null,
  transaction_type_id uuid not null,
  amount numeric(18, 2) not null,
  required_role text not null,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  constraint approval_rules_pkey primary key (id),
  constraint approval_rules_amount_check check (amount > 0),
  constraint approval_rules_role_check check (required_role in ('admin', 'owner')),
  constraint approval_rules_organisation_id_transaction_type_id_amount_key unique (organisation_id, transaction_type_id, amount),
  constraint approval_rules_organisation_id_id_key unique (organisation_id, id),
  constraint approval_rules_tenant_id_fkey foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint approval_rules_organisation_id_fkey foreign key (organisation_id) references public.organisations (id) on delete cascade,
  constraint approval_rules_type_fkey foreign key (organisation_id, transaction_type_id) references public.transaction_types (organisation_id, id) on delete restrict,
  constraint approval_rules_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint approval_rules_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null
);

comment on table public.approval_rules is 'From this amount in the home currency, a purchase order or invoice of this type needs approval from this role.';

create index approval_rules_organisation_id_idx on public.approval_rules (organisation_id);
create index approval_rules_tenant_id_idx on public.approval_rules (tenant_id);
create index approval_rules_type_idx on public.approval_rules (organisation_id, transaction_type_id);
create index approval_rules_created_by_idx on public.approval_rules (created_by);
create index approval_rules_updated_by_idx on public.approval_rules (updated_by);

create function private.enforce_approval_rule() returns trigger
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
  if v_direction is distinct from 'Purchases' or v_kind not in ('invoice', 'order') then
    raise exception 'Approval rules are for purchase invoices and purchase orders';
  end if;

  new.amount := round(new.amount, 2);
  return new;
end;
$$;

revoke all on function private.enforce_approval_rule() from public, anon, authenticated, service_role;

create trigger approval_rules_scope before insert or update on public.approval_rules
  for each row execute function private.enforce_approval_rule();
create trigger zz_set_audit_columns before insert or update on public.approval_rules
  for each row execute function private.set_audit_columns();
create trigger zz_write_audit_log after insert or update or delete on public.approval_rules
  for each row execute function private.write_audit_log();

alter table public.approval_rules enable row level security;

create policy approval_rules_select on public.approval_rules for select to authenticated
  using ((select private.is_org_member(approval_rules.organisation_id)));
create policy approval_rules_insert on public.approval_rules for insert to authenticated
  with check ((select private.has_org_role(approval_rules.organisation_id, array['owner', 'admin'])));
create policy approval_rules_update on public.approval_rules for update to authenticated
  using ((select private.has_org_role(approval_rules.organisation_id, array['owner', 'admin'])))
  with check ((select private.has_org_role(approval_rules.organisation_id, array['owner', 'admin'])));
create policy approval_rules_delete on public.approval_rules for delete to authenticated
  using ((select private.has_org_role(approval_rules.organisation_id, array['owner', 'admin'])));

revoke all on table public.approval_rules from anon;
revoke truncate, references, trigger on table public.approval_rules from authenticated, service_role;

-- A type that has rules keeps its direction and kind, so a rule never points at the wrong sort of document.
create function private.guard_type_with_rules() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if (new.type is distinct from old.type or new.document_kind is distinct from old.document_kind)
     and exists (select 1 from public.approval_rules where transaction_type_id = new.id) then
    raise exception 'This type has approval rules, so its direction and kind cannot change. Delete the rules first.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_type_with_rules() from public, anon, authenticated, service_role;

create trigger transaction_types_rules_guard before update on public.transaction_types
  for each row execute function private.guard_type_with_rules();

-- Tolerance setting ---------------------------------------------------------------------------------------------

alter table public.organisation_defaults
  add column price_tolerance_percent numeric(5, 2),
  add column price_tolerance_needs_approval boolean not null default true,
  add constraint organisation_defaults_price_tolerance_check check (price_tolerance_percent is null or (price_tolerance_percent >= 0 and price_tolerance_percent <= 100));

comment on column public.organisation_defaults.price_tolerance_percent is 'How far a purchase invoice line may be priced above its order line, as a percentage. Null means no check.';
comment on column public.organisation_defaults.price_tolerance_needs_approval is 'Whether a line over the tolerance makes the invoice need approval, when its type has approval rules.';

-- Approval columns on a document --------------------------------------------------------------------------------

alter table public.transaction_headers
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
  add constraint transaction_headers_approval_status_check check (approval_status is null or approval_status in ('requested', 'approved', 'rejected')),
  add constraint transaction_headers_approval_role_check check (approval_required_role is null or approval_required_role in ('admin', 'owner')),
  add constraint transaction_headers_approval_reason_check check (approval_reason is null or approval_reason in ('amount', 'price', 'amount and price')),
  add constraint transaction_headers_approval_note_check check (approval_note is null or char_length(approval_note) <= 500),
  add constraint transaction_headers_approval_requested_by_fkey foreign key (approval_requested_by) references public.profiles (id) on delete set null,
  add constraint transaction_headers_approval_decided_by_fkey foreign key (approval_decided_by) references public.profiles (id) on delete set null;

create index transaction_headers_approval_requested_by_idx on public.transaction_headers (approval_requested_by);
create index transaction_headers_approval_decided_by_idx on public.transaction_headers (approval_decided_by);
create index transaction_headers_approval_status_idx on public.transaction_headers (organisation_id, approval_status) where approval_status is not null;

comment on column public.transaction_headers.approval_status is 'requested, approved or rejected. Null when approval was never asked for. Whether it still holds is worked out from approval_hash, so any change to the document cancels it.';
comment on column public.transaction_headers.approval_hash is 'A fingerprint of the document and its lines when approval was requested. A change to either makes the approval stop counting.';

-- Only the approval functions write these columns.
create function private.guard_approval_columns() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if coalesce(current_setting('fintran.approval_change', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.approval_status is not null or new.approval_required_role is not null or new.approval_reason is not null
       or new.approval_requested_by is not null or new.approval_requested_at is not null
       or new.approval_decided_by is not null or new.approval_decided_at is not null
       or new.approval_note is not null or new.approval_self or new.approval_hash is not null then
      raise exception 'Approval is asked for, given and refused with the approval buttons';
    end if;
  elsif new.approval_status is distinct from old.approval_status
     or new.approval_required_role is distinct from old.approval_required_role
     or new.approval_reason is distinct from old.approval_reason
     or new.approval_requested_by is distinct from old.approval_requested_by
     or new.approval_requested_at is distinct from old.approval_requested_at
     or new.approval_decided_by is distinct from old.approval_decided_by
     or new.approval_decided_at is distinct from old.approval_decided_at
     or new.approval_note is distinct from old.approval_note
     or new.approval_self is distinct from old.approval_self
     or new.approval_hash is distinct from old.approval_hash then
    raise exception 'Approval is asked for, given and refused with the approval buttons';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_approval_columns() from public, anon, authenticated, service_role;

create trigger zzy_guard_approval before insert or update on public.transaction_headers
  for each row execute function private.guard_approval_columns();

-- Price tolerance -------------------------------------------------------------------------------------------------

-- Each line of a purchase invoice that came from an order line, with both unit prices after any discount. Nothing when
-- the organisation has no tolerance set. A line is over when its unit price is higher than the order's by more than
-- the tolerance. A lower price is never over.
create function private.price_rows(p_header_id uuid)
returns table (
  line_id uuid,
  line_number integer,
  description text,
  order_price numeric,
  invoice_price numeric,
  order_unit_net numeric,
  invoice_unit_net numeric,
  difference_percent numeric,
  over boolean
)
language sql stable security definer
set search_path to ''
as $$
  with base as (
    select line.id as line_id, line.line_number, line.description,
      source.price as order_price, line.price as invoice_price,
      (source.price * source.quantity - source.discount_amount) / nullif(source.quantity, 0) as order_net,
      (line.price * line.quantity - line.discount_amount) / nullif(line.quantity, 0) as invoice_net,
      defaults.price_tolerance_percent as tolerance
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    join public.organisation_defaults as defaults on defaults.organisation_id = header.organisation_id
    join public.transaction_lines as line on line.header_id = header.id
    join public.transaction_lines as source on source.id = line.source_line_id
    where header.id = p_header_id
      and kind.type = 'Purchases'
      and kind.document_kind = 'invoice'
      and defaults.price_tolerance_percent is not null
  )
  select base.line_id, base.line_number, base.description, base.order_price, base.invoice_price,
    round(base.order_net, 4), round(base.invoice_net, 4),
    case when base.order_net > 0 then round((base.invoice_net - base.order_net) / base.order_net * 100, 2) end,
    case
      when base.order_net is null or base.invoice_net is null then false
      when base.order_net > 0 then (base.invoice_net - base.order_net) / base.order_net * 100 > base.tolerance
      else base.invoice_net > 0
    end
  from base
  order by base.line_number
$$;

revoke all on function private.price_rows(uuid) from public, anon, authenticated, service_role;

-- The same rows for the screen, for anyone who can see the document.
create function public.price_checks(p_header_id uuid)
returns table (
  line_id uuid,
  line_number integer,
  description text,
  order_price numeric,
  invoice_price numeric,
  order_unit_net numeric,
  invoice_unit_net numeric,
  difference_percent numeric,
  over boolean
)
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.transaction_headers where id = p_header_id;
  if v_org is null or not (select private.is_org_member(v_org)) then
    return;
  end if;
  return query select * from private.price_rows(p_header_id);
end;
$$;

revoke all on function public.price_checks(uuid) from public, anon;
grant execute on function public.price_checks(uuid) to authenticated;

-- The check ---------------------------------------------------------------------------------------------------------

create function private.role_rank(p_role text) returns integer
  language sql immutable
  set search_path to ''
as $$
  select case p_role when 'owner' then 3 when 'admin' then 2 when 'member' then 1 else 0 end
$$;

revoke all on function private.role_rank(text) from public, anon, authenticated, service_role;

-- A fingerprint of a document and its lines, leaving out who touched them and the approval itself. Saving a document
-- without changing it gives the same fingerprint.
create function private.approval_hash(p_header_id uuid) returns text
  language sql stable security definer
  set search_path to ''
as $$
  select encode(extensions.digest(convert_to(
    coalesce((
      select (to_jsonb(header)
        - 'approval_status' - 'approval_required_role' - 'approval_reason' - 'approval_requested_by' - 'approval_requested_at'
        - 'approval_decided_by' - 'approval_decided_at' - 'approval_note' - 'approval_self' - 'approval_hash'
        - 'created_at' - 'created_by' - 'updated_at' - 'updated_by')::text
      from public.transaction_headers as header where header.id = p_header_id
    ), '')
    || '|' ||
    coalesce((
      select jsonb_agg(to_jsonb(line) - 'id' - 'created_at' - 'created_by' - 'updated_at' - 'updated_by' order by line.line_number)::text
      from public.transaction_lines as line where line.header_id = p_header_id
    ), ''),
  'utf8'), 'sha256'), 'hex')
$$;

revoke all on function private.approval_hash(uuid) from public, anon, authenticated, service_role;

-- Whether a draft needs approval, from whom, and why. Only a draft purchase invoice or purchase order can.
create function private.approval_check(p_header_id uuid)
returns table (needed boolean, role text, reason text)
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_type uuid;
  v_total numeric;
  v_direction text;
  v_kind text;
  v_rule_role text;
  v_has_rules boolean;
  v_price boolean := false;
begin
  select header.organisation_id, header.status, header.transaction_type_id, header.home_total_amount, kind.type, kind.document_kind::text
    into v_org, v_status, v_type, v_total, v_direction, v_kind
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = p_header_id;

  if v_org is null or v_status is distinct from 'draft' or v_direction is distinct from 'Purchases' or v_kind not in ('invoice', 'order') then
    return query select false, null::text, null::text;
    return;
  end if;

  select rule.required_role into v_rule_role
  from public.approval_rules as rule
  where rule.organisation_id = v_org and rule.transaction_type_id = v_type and rule.active and rule.amount <= v_total
  order by rule.amount desc
  limit 1;

  select exists (
    select 1 from public.approval_rules as rule
    where rule.organisation_id = v_org and rule.transaction_type_id = v_type and rule.active
  ) into v_has_rules;

  if v_kind = 'invoice' and v_has_rules then
    select defaults.price_tolerance_needs_approval and exists (select 1 from private.price_rows(p_header_id) as row where row.over)
      into v_price
    from public.organisation_defaults as defaults
    where defaults.organisation_id = v_org;
    v_price := coalesce(v_price, false);
  end if;

  if v_rule_role is null and not v_price then
    return query select false, null::text, null::text;
    return;
  end if;

  return query select
    true,
    case when v_rule_role = 'owner' then 'owner' else 'admin' end,
    case when v_rule_role is not null and v_price then 'amount and price' when v_price then 'price' else 'amount' end;
end;
$$;

revoke all on function private.approval_check(uuid) from public, anon, authenticated, service_role;

-- Where a document stands: none (nothing needed), required, requested, approved or rejected. What was asked, given or
-- refused only counts while the document is as it was and the role needed has not gone up since.
create function private.approval_state(p_header_id uuid) returns text
  language plpgsql stable security definer
  set search_path to ''
as $$
declare
  c record;
  h record;
begin
  select * into c from private.approval_check(p_header_id);
  if not c.needed then
    return 'none';
  end if;
  select approval_status, approval_hash, approval_required_role into h
  from public.transaction_headers where id = p_header_id;
  if h.approval_status is null
     or h.approval_hash is distinct from private.approval_hash(p_header_id)
     or private.role_rank(c.role) > private.role_rank(h.approval_required_role) then
    return 'required';
  end if;
  return h.approval_status;
end;
$$;

revoke all on function private.approval_state(uuid) from public, anon, authenticated, service_role;

-- Called by post_document and by Activate: refuses with what to do next.
create function private.require_approval(p_header_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  c record;
  v_state text;
  v_who text;
  v_note text;
begin
  select * into c from private.approval_check(p_header_id);
  if not c.needed then
    return;
  end if;
  v_state := private.approval_state(p_header_id);
  if v_state = 'approved' then
    return;
  end if;
  v_who := case c.role when 'owner' then 'an owner' else 'an admin or owner' end;
  if v_state = 'requested' then
    raise exception 'Waiting for approval from %.', v_who;
  end if;
  if v_state = 'rejected' then
    select approval_note into v_note from public.transaction_headers where id = p_header_id;
    raise exception 'Approval was refused: %.', coalesce(nullif(v_note, ''), 'no reason was given');
  end if;
  raise exception 'This document needs approval from %. Request approval first.', v_who;
end;
$$;

revoke all on function private.require_approval(uuid) from public, anon, authenticated, service_role;

-- Asking, giving and refusing ---------------------------------------------------------------------------------------

create function public.request_approval(p_header_id uuid, p_note text default null) returns void
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
  select organisation_id into v_org from public.transaction_headers where id = p_header_id for update;
  if v_org is null then
    raise exception 'That document could not be found';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'The note can be up to 500 characters';
  end if;

  select * into c from private.approval_check(p_header_id);
  if not c.needed then
    raise exception 'This document does not need approval';
  end if;
  v_state := private.approval_state(p_header_id);
  if v_state = 'approved' then
    raise exception 'This document is already approved';
  end if;
  if v_state = 'requested' then
    raise exception 'Approval has already been asked for';
  end if;

  perform set_config('fintran.approval_change', 'on', true);
  update public.transaction_headers
  set approval_status = 'requested',
      approval_required_role = c.role,
      approval_reason = c.reason,
      approval_requested_by = (select auth.uid()),
      approval_requested_at = now(),
      approval_decided_by = null,
      approval_decided_at = null,
      approval_note = nullif(btrim(p_note), ''),
      approval_self = false,
      approval_hash = private.approval_hash(p_header_id)
  where id = p_header_id;
  perform set_config('fintran.approval_change', 'off', true);
end;
$$;

revoke all on function public.request_approval(uuid, text) from public, anon;
grant execute on function public.request_approval(uuid, text) to authenticated;

-- Shared by approving and refusing: the document must be waiting, the person must have the role, and the person who asked
-- cannot decide unless nobody else could.
create function private.check_approver(p_header_id uuid, out v_self boolean)
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
  from public.transaction_headers where id = p_header_id for update;
  if v_org is null then
    raise exception 'That document could not be found';
  end if;
  select * into c from private.approval_check(p_header_id);
  if not c.needed then
    raise exception 'This document does not need approval';
  end if;
  v_state := private.approval_state(p_header_id);
  if v_state = 'required' then
    raise exception 'Approval has not been asked for this version of the document. Ask again.';
  end if;
  if v_state <> 'requested' then
    raise exception 'Only an approval that is waiting can be decided';
  end if;

  v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
  if not (select private.has_org_role(v_org, v_roles)) then
    raise exception 'This needs %.', case c.role when 'owner' then 'an owner' else 'an admin or owner' end;
  end if;

  v_self := false;
  if v_requester is not distinct from (select auth.uid()) then
    if exists (
      select 1 from public.organisation_access as access
      where access.organisation_id = v_org and access.user_id <> (select auth.uid()) and access.role = any (v_roles)
    ) then
      raise exception 'You asked for this approval, so someone else has to decide it.';
    end if;
    v_self := true;
  end if;
end;
$$;

revoke all on function private.check_approver(uuid) from public, anon, authenticated, service_role;

create function public.approve_document(p_header_id uuid, p_note text default null) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_self boolean;
begin
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'The note can be up to 500 characters';
  end if;
  v_self := (select private.check_approver(p_header_id));
  perform set_config('fintran.approval_change', 'on', true);
  update public.transaction_headers
  set approval_status = 'approved',
      approval_decided_by = (select auth.uid()),
      approval_decided_at = now(),
      approval_note = coalesce(nullif(btrim(p_note), ''), approval_note),
      approval_self = v_self
  where id = p_header_id;
  perform set_config('fintran.approval_change', 'off', true);
end;
$$;

revoke all on function public.approve_document(uuid, text) from public, anon;
grant execute on function public.approve_document(uuid, text) to authenticated;

create function public.reject_document(p_header_id uuid, p_reason text) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_self boolean;
begin
  if v_reason is null then
    raise exception 'Enter a reason for refusing approval';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'The reason can be up to 500 characters';
  end if;
  v_self := (select private.check_approver(p_header_id));
  perform set_config('fintran.approval_change', 'on', true);
  update public.transaction_headers
  set approval_status = 'rejected',
      approval_decided_by = (select auth.uid()),
      approval_decided_at = now(),
      approval_note = v_reason,
      approval_self = v_self
  where id = p_header_id;
  perform set_config('fintran.approval_change', 'off', true);
end;
$$;

revoke all on function public.reject_document(uuid, text) from public, anon;
grant execute on function public.reject_document(uuid, text) to authenticated;

-- Where each of several documents stands, for the lists and the open document. Only documents that need approval are
-- returned. can_decide says whether the person asking could approve or refuse it now.
create function public.approval_status(p_header_ids uuid[])
returns table (
  header_id uuid,
  state text,
  required_role text,
  reason text,
  requested_by_name text,
  requested_at timestamp with time zone,
  decided_by_name text,
  decided_at timestamp with time zone,
  note text,
  self boolean,
  can_decide boolean,
  price_over boolean
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
  foreach v_id in array coalesce(p_header_ids, array[]::uuid[])
  loop
    select header.organisation_id, header.approval_requested_by, header.approval_requested_at, header.approval_decided_by,
           header.approval_decided_at, header.approval_note, header.approval_self
      into h
    from public.transaction_headers as header
    where header.id = v_id;
    if not found or not (select private.is_org_member(h.organisation_id)) then
      continue;
    end if;

    select * into c from private.approval_check(v_id);
    if not c.needed then
      continue;
    end if;
    v_state := private.approval_state(v_id);
    v_roles := case c.role when 'owner' then array['owner'] else array['owner', 'admin'] end;
    v_decide := v_state = 'requested'
      and (select private.has_org_role(h.organisation_id, v_roles))
      and (
        h.approval_requested_by is distinct from (select auth.uid())
        or not exists (
          select 1 from public.organisation_access as access
          where access.organisation_id = h.organisation_id and access.user_id <> (select auth.uid()) and access.role = any (v_roles)
        )
      );

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
      h.approval_self,
      v_decide,
      exists (select 1 from private.price_rows(v_id) as row where row.over);
  end loop;
end;
$$;

revoke all on function public.approval_status(uuid[]) from public, anon;
grant execute on function public.approval_status(uuid[]) to authenticated;

-- The gate: post_document and Activate ---------------------------------------------------------------------------

create or replace function public.post_document(p_header_id uuid, p_logo_path text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_supplier uuid;
  v_type uuid;
  v_reference integer;
  v_numbering public.numbering_rule;
  v_direction text;
  v_lines integer;
  v_issuer jsonb;
  v_party jsonb;
  v_iban text;
  v_customer uuid;
  v_errors text;
  v_kind text;
  v_preceding uuid;
  v_credit_total numeric;
  v_open numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date, supplier_id, customer_id, transaction_type_id, reference
    into v_org, v_status, v_date, v_supplier, v_customer, v_type, v_reference
  from public.transaction_headers
  where id = p_header_id
  for update;

  if v_org is null then
    raise exception 'That document could not be posted';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft document can be posted';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;
  if p_logo_path is not null
     and p_logo_path is distinct from v_org::text || '/snapshots/' || p_header_id::text then
    raise exception 'The posted logo path is not valid';
  end if;

  select count(*) into v_lines
  from public.transaction_lines
  where header_id = p_header_id;

  if v_lines < 1 then
    raise exception 'Add a line before posting';
  end if;

  -- A purchase invoice above an approval rule, or over the price tolerance, needs approval first.
  perform private.require_approval(p_header_id);

  select numbering, type into v_numbering, v_direction
  from public.transaction_types
  where id = v_type;

  if v_numbering = 'on_post' and v_reference is null then
    perform 1
    from public.transaction_types
    where id = v_type
    for update;
  end if;

  select defaults.iban into v_iban
  from public.organisation_defaults as defaults
  where defaults.organisation_id = v_org;

  if v_direction = 'Sales' and v_iban is not null then
    update public.transaction_headers
    set payment_means_code = '58'
    where id = p_header_id
      and payment_means_code is null;
  end if;

  if v_direction = 'Sales' then
    select string_agg(format('%s: %s', ready.rule_id, ready.message), ' ' order by ready.rule_id)
      into v_errors
    from public.en16931_readiness(p_header_id) as ready
    where ready.severity = 'error';
    if v_errors is not null then
      raise exception 'This sales document is not ready to post. %', v_errors;
    end if;
  end if;

  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  select jsonb_build_object(
    'name', organisation.name,
    'address', private.postal_address_text(
      defaults.address_line1, defaults.address_line2, defaults.address_line3,
      defaults.city, defaults.post_code, defaults.county, seller_country.name
    ),
    'addressLine1', defaults.address_line1,
    'addressLine2', defaults.address_line2,
    'addressLine3', defaults.address_line3,
    'city', defaults.city,
    'postCode', defaults.post_code,
    'county', defaults.county,
    'countryCode', defaults.country_code,
    'countryName', seller_country.name,
    'contactName', defaults.contact_name,
    'contactEmail', defaults.contact_email,
    'website', defaults.website,
    'phone', defaults.phone,
    'vatNumber', defaults.vat_number,
    'companyNumber', defaults.company_number,
    'peppolScheme', defaults.peppol_scheme,
    'peppolId', defaults.peppol_id,
    'iban', defaults.iban,
    'bic', defaults.bic,
    'bankAccountName', defaults.bank_account_name,
    'bankingDetails', defaults.banking_details,
    'logoPath', p_logo_path
  )
  into v_issuer
  from public.organisations as organisation
  left join public.organisation_defaults as defaults
    on defaults.organisation_id = organisation.id
  left join public.ref_countries as seller_country
    on seller_country.code = defaults.country_code
  where organisation.id = v_org;

  if v_direction = 'Sales' then
    select jsonb_build_object(
      'code', customers.code,
      'name', customers.name,
      'address', private.postal_address_text(
        customers.address_line1, customers.address_line2, customers.address_line3,
        customers.city, customers.post_code, customers.county, party_country.name
      ),
      'addressLine1', customers.address_line1,
      'addressLine2', customers.address_line2,
      'addressLine3', customers.address_line3,
      'city', customers.city,
      'postCode', customers.post_code,
      'county', customers.county,
      'countryCode', customers.country_code,
      'countryName', party_country.name,
      'phone', customers.phone,
      'email', customers.email,
      'website', customers.website,
      'contactDetails', customers.contact_details,
      'vatNumber', customers.vat_number,
      'companyNumber', customers.company_number,
      'peppolScheme', customers.peppol_scheme,
      'peppolId', customers.peppol_id
    )
    into v_party
    from public.customers as customers
    left join public.ref_countries as party_country
      on party_country.code = customers.country_code
    where customers.id = v_customer;
  else
  select jsonb_build_object(
    'code', supplier.code,
    'name', supplier.name,
    'address', private.postal_address_text(
      supplier.address_line1, supplier.address_line2, supplier.address_line3,
      supplier.city, supplier.post_code, supplier.county, party_country.name
    ),
    'addressLine1', supplier.address_line1,
    'addressLine2', supplier.address_line2,
    'addressLine3', supplier.address_line3,
    'city', supplier.city,
    'postCode', supplier.post_code,
    'county', supplier.county,
    'countryCode', supplier.country_code,
    'countryName', party_country.name,
    'phone', supplier.phone,
    'email', supplier.email,
    'website', supplier.website,
    'contactDetails', supplier.contact_details,
    'vatNumber', supplier.vat_number,
    'companyNumber', supplier.company_number,
    'peppolScheme', supplier.peppol_scheme,
    'peppolId', supplier.peppol_id
  )
  into v_party
  from public.suppliers as supplier
  left join public.ref_countries as party_country
    on party_country.code = supplier.country_code
  where supplier.id = v_supplier;
  end if;

  select kind.document_kind::text, header.preceding_header_id, header.foreign_total_amount
    into v_kind, v_preceding, v_credit_total
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = p_header_id;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      issuer_snapshot = v_issuer,
      party_snapshot = v_party,
      reference = v_reference,
      -- Fixed before anything is allocated, so the e-invoice of a credit note is not changed by its own application.
      paid_at_posting = paid_amount
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);

  -- A credit note with a preceding invoice is applied to it, up to what is still open on the invoice. The invoice is
  -- locked after the credit note, the same order every allocation uses. If it is already settled the credit note stays
  -- on account.
  if v_kind = 'credit_note' and v_preceding is not null then
    select header.foreign_total_amount + header.rounding_amount - header.paid_amount
      into v_open
    from public.transaction_headers as header
    where header.id = v_preceding and header.organisation_id = v_org and header.status = 'posted'
    for update;
    if coalesce(v_open, 0) > 0 then
      insert into public.allocations (tenant_id, organisation_id, source_header_id, target_header_id, amount)
      select tenant_id, organisation_id, id, v_preceding, least(v_credit_total, v_open)
      from public.transaction_headers
      where id = p_header_id;
    end if;
  end if;
end;
$$;

create or replace function public.set_order_status(p_header_id uuid, p_action text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_org uuid;
  v_status text;
  v_type uuid;
  v_reference integer;
  v_kind text;
  v_numbering public.numbering_rule;
  v_lines integer;
  v_next public.document_status;
begin
  if (select auth.uid()) is null then raise exception 'Sign in before changing an order'; end if;
  select organisation_id, status::text, transaction_type_id, reference
    into v_org, v_status, v_type, v_reference
  from public.transaction_headers where id = p_header_id for update;
  if v_org is null then raise exception 'That order was not found'; end if;
  if not (select private.is_org_member(v_org)) then raise exception 'You are not a member of this organisation'; end if;
  select document_kind::text, numbering into v_kind, v_numbering from public.transaction_types where id = v_type;
  if v_kind is null or v_kind not in ('order', 'requisition') then
    raise exception 'Only an order or a requisition can be activated and closed';
  end if;

  if p_action = 'open' then
    if v_status <> 'draft' then raise exception 'Only a draft order can be activated'; end if;
    select count(*) into v_lines from public.transaction_lines where header_id = p_header_id;
    if v_lines < 1 then raise exception 'Add a line before activating'; end if;
    -- A purchase order above an approval rule needs approval first.
    perform private.require_approval(p_header_id);
    if v_numbering = 'on_post' and v_reference is null then v_reference := private.issue_reference(v_type); end if;
    v_next := 'open';
  elsif p_action = 'close' then
    if v_status <> 'open' then raise exception 'Only an active order can be closed'; end if;
    v_next := 'closed';
  elsif p_action = 'reopen' then
    if v_status <> 'closed' then raise exception 'Only a closed order can be reopened'; end if;
    v_next := 'open';
  elsif p_action = 'cancel' then
    if v_status <> 'open' then raise exception 'Only an active order can be cancelled'; end if;
    if exists (
      select 1
      from public.transaction_lines as line
      join public.transaction_lines as drawn on drawn.source_line_id = line.id
      join public.transaction_headers as header on header.id = drawn.header_id
      where line.header_id = p_header_id and header.status <> 'void'
    ) then
      raise exception 'Another document has been created from this one, so it cannot be cancelled. Close it instead.';
    end if;
    v_next := 'cancelled';
  else
    raise exception 'That order action is not recognised';
  end if;

  perform set_config('fintran.status_change', 'on', true);
  -- A change made by a person is never a system close, so a later void leaves a hand-closed order closed.
  update public.transaction_headers set status = v_next, reference = v_reference, closed_by_system = false where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;
