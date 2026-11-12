-- Phase 4: document status, posting, voiding, and the period lock.

create type public.document_status as enum ('draft', 'posted', 'void');

alter table public.transaction_headers
  add column status public.document_status not null default 'draft',
  add column posted_at timestamptz,
  add column posted_by uuid references public.profiles (id) on delete set null,
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (id) on delete set null,
  add column void_reason text,
  add constraint transaction_headers_void_reason_check
    check (void_reason is null or char_length(void_reason) between 1 and 500);

create index transaction_headers_posted_by_idx on public.transaction_headers (posted_by);
create index transaction_headers_voided_by_idx on public.transaction_headers (voided_by);

alter table public.organisation_defaults
  add column lock_date date;

update public.transaction_headers
set status = 'posted',
    posted_at = created_at
where status = 'draft';

create or replace function private.document_period_locked(p_organisation_id uuid, p_transaction_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_defaults
    where organisation_id = p_organisation_id
      and lock_date is not null
      and p_transaction_date <= lock_date
  );
$$;

revoke all on function private.document_period_locked(uuid, date) from public, anon, authenticated;

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
    'created_at', 'created_by', 'updated_at', 'updated_by',
    'foreign_nett_amount', 'foreign_vat_amount', 'foreign_total_amount',
    'home_nett_amount', 'home_vat_amount', 'home_total_amount'
  ];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted and void documents cannot be deleted';
    end if;
    if private.document_period_locked(old.organisation_id, old.transaction_date) then
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
    if private.document_period_locked(new.organisation_id, new.transaction_date) then
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
      raise exception 'Document status can only be changed by posting or voiding';
    end if;
    if not (
      (old.status = 'draft' and new.status = 'posted')
      or (old.status = 'posted' and new.status = 'void')
    ) then
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
  end if;

  if private.document_period_locked(new.organisation_id, new.transaction_date)
     or private.document_period_locked(old.organisation_id, old.transaction_date) then
    raise exception 'This date is in a locked period';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_document_status() from public, anon, authenticated;

create trigger zz_document_status
  before insert or update or delete on public.transaction_headers
  for each row execute function private.enforce_document_status();

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

create trigger zz_document_lines
  before insert or update or delete on public.transaction_lines
  for each row execute function private.enforce_document_lines();

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
end;
$$;

revoke all on function public.post_document(uuid) from public, anon;
revoke all on function public.void_document(uuid, text) from public, anon;
grant execute on function public.post_document(uuid) to authenticated;
grant execute on function public.void_document(uuid, text) to authenticated;
