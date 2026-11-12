-- Order lifecycle, part 2. Orders and requisitions are opened and closed. Invoices and credit notes are posted and voided.
-- An order or a requisition goes draft, open, closed. An open one can be cancelled and a closed one can be reopened.
-- An open order can still be changed. A closed or cancelled one cannot. The period lock does not apply to them.

-- Posting details are only required on posted and void documents.
alter table public.transaction_headers drop constraint transaction_headers_posted_complete;
alter table public.transaction_headers add constraint transaction_headers_posted_complete check (
  status::text not in ('posted', 'void')
  or (document_number is not null and issuer_snapshot is not null and party_snapshot is not null and posted_at is not null)
);

create or replace function private.enforce_document_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_allowed text[] := array[
    'paid_amount',
    'amount_due',
    'created_at', 'created_by', 'updated_at', 'updated_by'
  ];
  v_kind text;
  v_order boolean;
begin
  select document_kind::text into v_kind
  from public.transaction_types
  where id = case when tg_op = 'DELETE' then old.transaction_type_id else new.transaction_type_id end;
  v_order := coalesce(v_kind in ('order', 'requisition'), false);

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      if v_order then
        raise exception 'Only a draft order can be deleted. Cancel it instead.';
      end if;
      raise exception 'Posted and void documents cannot be deleted';
    end if;
    if not v_order and private.document_period_locked(old.organisation_id, old.transaction_date) then
      raise exception 'This date is in a locked period';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft'
       or new.posted_at is not null
       or new.posted_by is not null
       or new.voided_at is not null
       or new.voided_by is not null
       or new.void_reason is not null then
      raise exception 'Document status can only be changed by posting or voiding';
    end if;
    if not v_order and private.document_period_locked(new.organisation_id, new.transaction_date) then
      raise exception 'This date is in a locked period';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.posted_at is distinct from old.posted_at
     or new.posted_by is distinct from old.posted_by
     or new.voided_at is distinct from old.voided_at
     or new.voided_by is distinct from old.voided_by
     or new.void_reason is distinct from old.void_reason then
    if current_setting('fintran.status_change', true) is distinct from 'on' then
      if v_order then
        raise exception 'An order status is changed with Open, Close, Reopen or Cancel';
      end if;
      raise exception 'Document status can only be changed by posting or voiding';
    end if;
    if v_order then
      if new.status in ('posted', 'void') then
        raise exception 'An order is opened and closed. It is not posted.';
      end if;
      if new.posted_at is not null or new.posted_by is not null
         or new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then
        raise exception 'That status change is not allowed';
      end if;
      if not (
        (old.status = 'draft' and new.status = 'open')
        or (old.status = 'open' and new.status in ('closed', 'cancelled'))
        or (old.status = 'closed' and new.status = 'open')
      ) then
        raise exception 'That status change is not allowed';
      end if;
    elsif not (
      (old.status = 'draft' and new.status = 'posted')
      or (old.status = 'posted' and new.status = 'void')
    ) then
      if new.status in ('open', 'closed', 'cancelled') then
        raise exception 'Only an order or a requisition can be opened and closed';
      end if;
      raise exception 'That status change is not allowed';
    end if;
  elsif old.status = 'posted' then
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      raise exception 'Only the paid amount can be changed on a posted document';
    end if;
  elsif old.status = 'void' then
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      raise exception 'A void document cannot be changed';
    end if;
  elsif old.status in ('closed', 'cancelled') then
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      if old.status = 'closed' then
        raise exception 'A closed order cannot be changed. Reopen it first.';
      end if;
      raise exception 'A cancelled order cannot be changed';
    end if;
  end if;

  if not v_order and (
    private.document_period_locked(new.organisation_id, new.transaction_date)
    or private.document_period_locked(old.organisation_id, old.transaction_date)
  ) then
    raise exception 'This date is in a locked period';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_document_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.document_status;
  v_date date;
  v_organisation uuid;
  v_kind text;
  v_order boolean;
  v_header uuid := case when tg_op = 'DELETE' then old.header_id else new.header_id end;
begin
  select header.status, header.transaction_date, header.organisation_id, kind.document_kind::text
    into v_status, v_date, v_organisation, v_kind
  from public.transaction_headers as header
  left join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = v_header;
  v_order := coalesce(v_kind in ('order', 'requisition'), false);

  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;

  if v_status in ('closed', 'cancelled') then
    raise exception 'Lines on a closed or cancelled order cannot be changed';
  end if;
  if v_status not in ('draft', 'open') then
    raise exception 'Lines on a posted or void document cannot be changed';
  end if;
  if not v_order and private.document_period_locked(v_organisation, v_date) then
    raise exception 'This date is in a locked period';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Two existing functions change by one line each. Each is redefined from its own definition so nothing else moves.
do $$
declare
  v_definition text;
  v_changed text;
begin
  v_definition := pg_get_functiondef('public.save_document(jsonb)'::regprocedure);
  v_changed := replace(
    v_definition,
    $old$if v_status is distinct from 'draft' then raise exception 'Only a draft document can be changed'; end if;$old$,
    $new$if v_status::text not in ('draft', 'open') then raise exception 'Only a draft document or an open order can be changed'; end if;$new$
  );
  if v_changed = v_definition then
    raise exception 'save_document does not have the expected status check';
  end if;
  execute v_changed;

  v_definition := pg_get_functiondef('public.en16931_document(uuid)'::regprocedure);
  v_changed := replace(
    v_definition,
    $old$if v_source->>'kind' = 'order' then raise exception 'An order is not exported'; end if;$old$,
    $new$if v_source->>'kind' in ('order', 'requisition') then raise exception 'An order is not exported'; end if;$new$
  );
  if v_changed = v_definition then
    raise exception 'en16931_document does not have the expected order check';
  end if;
  execute v_changed;
end
$$;

-- A requisition is the step before a purchase order, so it is a Purchases document.
create or replace function private.enforce_requisition_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.document_kind::text = 'requisition' and new.type is distinct from 'Purchases' then
    raise exception 'A requisition is a Purchases document';
  end if;
  return new;
end;
$$;

create trigger transaction_types_requisition
before insert or update on public.transaction_types
for each row execute function private.enforce_requisition_type();

create or replace function public.set_order_status(p_header_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    raise exception 'Only an order or a requisition can be opened and closed';
  end if;

  if p_action = 'open' then
    if v_status <> 'draft' then raise exception 'Only a draft order can be opened'; end if;
    select count(*) into v_lines from public.transaction_lines where header_id = p_header_id;
    if v_lines < 1 then raise exception 'Add a line before opening'; end if;
    if v_numbering = 'on_post' and v_reference is null then v_reference := private.issue_reference(v_type); end if;
    v_next := 'open';
  elsif p_action = 'close' then
    if v_status <> 'open' then raise exception 'Only an open order can be closed'; end if;
    v_next := 'closed';
  elsif p_action = 'reopen' then
    if v_status <> 'closed' then raise exception 'Only a closed order can be reopened'; end if;
    v_next := 'open';
  elsif p_action = 'cancel' then
    if v_status <> 'open' then raise exception 'Only an open order can be cancelled'; end if;
    v_next := 'cancelled';
  else
    raise exception 'That order action is not recognised';
  end if;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers set status = v_next, reference = v_reference where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
