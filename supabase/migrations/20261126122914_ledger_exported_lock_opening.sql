-- General ledger, release C: the exported lock and the opening figures (QULAPLUS_LEDGER_SPEC.md, 2.4 and 6.2).
-- The lock date already keeps dates before go-live open until the opening balance journal is posted, so opening debtors and
-- creditors can be entered. The exported lock had no such exception, so an organisation that had already exported could not enter
-- them unless it turned the lock off. It now has the same exception, so the two rules agree.
create or replace function private.check_not_exported(p_organisation_id uuid, p_date date) returns void
  language plpgsql stable security definer set search_path to ''
as $$
declare
  v_lock boolean;
  v_through date;
  v_start date;
begin
  select lock_exported, exported_through, ledger_start_date into v_lock, v_through, v_start
  from public.organisation_defaults where organisation_id = p_organisation_id;
  if v_lock and v_through is not null and p_date <= v_through
     and not (
       v_start is not null and p_date < v_start
       and not exists (select 1 from public.journal_entries as e where e.organisation_id = p_organisation_id and e.is_opening)
     ) then
    raise exception 'This date is in a period that has been exported. Use a later date.';
  end if;
end;
$$;
