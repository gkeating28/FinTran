-- General ledger, release C, phase 7: manual journals and the opening balance journal (QULAPLUS_LEDGER_SPEC.md).
-- A manual journal is a draft until it is posted. Owners and admins save, post, delete and reverse. It is home currency only and
-- may not use a control account (L13). Everything is written by these functions, never directly.

-- Saves a draft. p_journal: organisationId, id (to replace a draft), date, description and lines, each with glCodeId, debit,
-- credit, departmentId, costCentreId and description. A draft may be unbalanced and short. Posting checks that.
create function private.save_manual_journal(p_journal jsonb, p_opening boolean) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  v_org uuid := nullif(p_journal->>'organisationId', '')::uuid;
  v_id uuid := nullif(p_journal->>'id', '')::uuid;
  v_date date;
  v_desc text := btrim(coalesce(p_journal->>'description', ''));
  v_tenant uuid;
  v_home uuid;
  v_start date;
  v_status text;
  v_source text;
  v_number integer := 0;
  v_debit numeric;
  v_credit numeric;
  l jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before saving a journal';
  end if;
  if v_org is null or not (select private.has_org_role(v_org, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to work with journals';
  end if;
  select o.tenant_id, d.home_currency_id, d.ledger_start_date into v_tenant, v_home, v_start
  from public.organisations as o join public.organisation_defaults as d on d.organisation_id = o.id
  where o.id = v_org;
  if v_tenant is null then
    raise exception 'That organisation could not be found';
  end if;

  if p_opening then
    if v_start is null then
      raise exception 'Set the go-live date before posting the opening balance journal';
    end if;
    v_date := v_start - 1;
    v_desc := coalesce(nullif(v_desc, ''), 'Opening balances');
  else
    v_date := nullif(p_journal->>'date', '')::date;
    if v_date is null then
      raise exception 'Enter the date of the journal';
    end if;
  end if;
  if char_length(v_desc) not between 1 and 200 then
    raise exception 'Enter a description of up to 200 characters';
  end if;
  if jsonb_typeof(p_journal->'lines') is distinct from 'array' then
    raise exception 'Send the lines of the journal as a list';
  end if;

  if v_id is null then
    insert into public.journal_entries (tenant_id, organisation_id, entry_date, status, source_type, description, is_opening)
    values (v_tenant, v_org, v_date, 'draft', 'manual', v_desc, p_opening)
    returning id into v_id;
  else
    select status, source_type into v_status, v_source from public.journal_entries where organisation_id = v_org and id = v_id for update;
    if v_status is null then
      raise exception 'That journal could not be found';
    end if;
    if v_status <> 'draft' or v_source <> 'manual' then
      raise exception 'Only a draft manual journal can be changed';
    end if;
    update public.journal_entries set entry_date = v_date, description = v_desc where organisation_id = v_org and id = v_id;
    delete from public.journal_lines where organisation_id = v_org and entry_id = v_id;
  end if;

  for l in select value from jsonb_array_elements(p_journal->'lines') loop
    v_number := v_number + 1;
    v_debit := round(coalesce(nullif(l->>'debit', '')::numeric, 0), 2);
    v_credit := round(coalesce(nullif(l->>'credit', '')::numeric, 0), 2);
    if v_debit < 0 or v_credit < 0 or (v_debit > 0) = (v_credit > 0) then
      raise exception 'Line %: enter either a debit or a credit, above zero', v_number;
    end if;
    if nullif(l->>'glCodeId', '') is null then
      raise exception 'Line %: choose a GL code', v_number;
    end if;
    insert into public.journal_lines (
      tenant_id, organisation_id, entry_id, line_number, gl_code_id, department_id, cost_centre_id, debit, credit,
      currency_id, exchange_rate, foreign_amount, description
    ) values (
      v_tenant, v_org, v_id, v_number, (l->>'glCodeId')::uuid, nullif(l->>'departmentId', '')::uuid, nullif(l->>'costCentreId', '')::uuid,
      v_debit, v_credit, v_home, 1, v_debit - v_credit, left(nullif(btrim(coalesce(l->>'description', '')), ''), 200)
    );
  end loop;
  return v_id;
end;
$$;
revoke all on function private.save_manual_journal(jsonb, boolean) from public, anon, authenticated, service_role;

create function public.save_manual_journal(p_journal jsonb) returns uuid
  language sql security definer set search_path to ''
as $$ select private.save_manual_journal(p_journal, false) $$;
revoke all on function public.save_manual_journal(jsonb) from public, anon;
grant execute on function public.save_manual_journal(jsonb) to authenticated;

-- Posts a draft: it balances, has two lines or more, uses no control account and only codes in use, and its date is open.
-- The entry number is issued last, so the counter is the last lock taken.
create function private.post_manual_journal(p_entry_id uuid) returns void
  language plpgsql security definer set search_path to ''
as $$
declare
  e public.journal_entries%rowtype;
  v_lines integer;
  v_debit numeric;
  v_credit numeric;
  v_code text;
  v_number bigint;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if e.id is null or not (select private.has_org_role(e.organisation_id, array['owner', 'admin'])) then
    raise exception 'That journal could not be found';
  end if;
  if e.status <> 'draft' or e.source_type <> 'manual' then
    raise exception 'Only a draft manual journal can be posted';
  end if;
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_lines, v_debit, v_credit
  from public.journal_lines where organisation_id = e.organisation_id and entry_id = e.id;
  if v_lines < 2 then
    raise exception 'A journal needs at least two lines';
  end if;
  if v_debit <> v_credit then
    raise exception 'The journal does not balance. Debits are %, credits are %.', v_debit, v_credit;
  end if;
  select g.code into v_code
  from public.journal_lines as l join public.gl_codes as g on g.id = l.gl_code_id
  where l.organisation_id = e.organisation_id and l.entry_id = e.id and g.system_role in ('debtors_control', 'creditors_control')
  limit 1;
  if v_code is not null then
    raise exception 'GL code % is a control account. Only the system posts to it.', v_code;
  end if;
  select g.code into v_code
  from public.journal_lines as l join public.gl_codes as g on g.id = l.gl_code_id
  where l.organisation_id = e.organisation_id and l.entry_id = e.id and not g.active
  limit 1;
  if v_code is not null then
    raise exception 'GL code % is not in use', v_code;
  end if;
  if not e.is_opening then
    perform private.check_not_exported(e.organisation_id, e.entry_date);
  end if;

  v_number := private.next_entry_number(e.tenant_id, e.organisation_id);
  update public.journal_entries
  set status = 'posted', entry_number = v_number, posted_at = now(), posted_by = (select auth.uid()), source_ref = 'JNL-' || v_number
  where id = e.id;
end;
$$;
revoke all on function private.post_manual_journal(uuid) from public, anon, authenticated, service_role;

create function public.post_manual_journal(p_entry_id uuid) returns void
  language sql security definer set search_path to ''
as $$ select private.post_manual_journal(p_entry_id) $$;
revoke all on function public.post_manual_journal(uuid) from public, anon;
grant execute on function public.post_manual_journal(uuid) to authenticated;

create function public.delete_manual_journal(p_entry_id uuid) returns void
  language plpgsql security definer set search_path to ''
as $$
declare
  e public.journal_entries%rowtype;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if e.id is null or not (select private.has_org_role(e.organisation_id, array['owner', 'admin'])) then
    raise exception 'That journal could not be found';
  end if;
  if e.status <> 'draft' or e.source_type <> 'manual' then
    raise exception 'Only a draft manual journal can be deleted';
  end if;
  delete from public.journal_entries where id = e.id;
end;
$$;
revoke all on function public.delete_manual_journal(uuid) from public, anon;
grant execute on function public.delete_manual_journal(uuid) to authenticated;

-- Reverses a posted manual journal on a date on or after its own, for accruals and prepayments. The opening journal is not reversed.
create function public.reverse_journal(p_entry_id uuid, p_date date, p_description text default null) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  e public.journal_entries%rowtype;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if e.id is null or not (select private.has_org_role(e.organisation_id, array['owner', 'admin'])) then
    raise exception 'That journal could not be found';
  end if;
  if e.status <> 'posted' or e.source_type <> 'manual' then
    raise exception 'Only a posted manual journal can be reversed here. Void the document or payment instead.';
  end if;
  if e.is_opening then
    raise exception 'The opening balance journal cannot be reversed';
  end if;
  if p_date is null or p_date < e.entry_date then
    raise exception 'Reverse on or after the date of the journal, %', e.entry_date;
  end if;
  if exists (select 1 from public.journal_entries where organisation_id = e.organisation_id and reverses_entry_id = e.id) then
    raise exception 'That journal has already been reversed';
  end if;
  return private.ledger_reverse_entry(e.id, p_date, false, p_description);
end;
$$;
revoke all on function public.reverse_journal(uuid, date, text) from public, anon;
grant execute on function public.reverse_journal(uuid, date, text) to authenticated;

-- The opening balance journal: a manual journal dated the day before go-live, posted once. It may not touch a control account,
-- because opening debtors and creditors are entered as ordinary documents dated before go-live.
create function public.post_opening_journal(p_journal jsonb) returns uuid
  language plpgsql security definer set search_path to ''
as $$
declare
  v_id uuid;
begin
  if exists (
    select 1 from public.journal_entries
    where organisation_id = nullif(p_journal->>'organisationId', '')::uuid and is_opening
  ) then
    raise exception 'The opening balance journal has already been posted';
  end if;
  v_id := private.save_manual_journal(p_journal - 'id', true);
  perform private.post_manual_journal(v_id);
  return v_id;
end;
$$;
revoke all on function public.post_opening_journal(jsonb) from public, anon;
grant execute on function public.post_opening_journal(jsonb) to authenticated;
