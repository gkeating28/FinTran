-- Deleting a draft removes its lines. That must succeed even when the header row
-- is already gone, while posted and void lines stay protected.

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
  v_header uuid := case when tg_op = 'DELETE' then old.header_id else new.header_id end;
begin
  select status, transaction_date, organisation_id
    into v_status, v_date, v_organisation
  from public.transaction_headers
  where id = v_header;

  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'Lines on a posted or void document cannot be changed';
  end if;
  if private.document_period_locked(v_organisation, v_date) then
    raise exception 'This date is in a locked period';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_document_lines() from public, anon, authenticated;
