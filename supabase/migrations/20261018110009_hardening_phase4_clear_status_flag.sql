-- Clear the posting flag after the status change so a later statement in the same transaction cannot change status directly.

create or replace function public.post_document(p_header_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_lines integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date
    into v_org, v_status, v_date
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

  select count(*) into v_lines
  from public.transaction_lines
  where header_id = p_header_id;

  if v_lines < 1 then
    raise exception 'Add a line before posting';
  end if;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid())
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

create or replace function public.void_document(p_header_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before voiding a document';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a reason for voiding this document';
  end if;

  select organisation_id, status, transaction_date
    into v_org, v_status, v_date
  from public.transaction_headers
  where id = p_header_id
  for update;

  if v_org is null then
    raise exception 'That document could not be voided';
  end if;
  if not (select private.has_org_role(v_org, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to void a document';
  end if;
  if v_status is distinct from 'posted' then
    raise exception 'Only a posted document can be voided';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'void',
      voided_at = now(),
      voided_by = (select auth.uid()),
      void_reason = v_reason
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

revoke all on function public.post_document(uuid) from public, anon;
revoke all on function public.void_document(uuid, text) from public, anon;
grant execute on function public.post_document(uuid) to authenticated;
grant execute on function public.void_document(uuid, text) to authenticated;
