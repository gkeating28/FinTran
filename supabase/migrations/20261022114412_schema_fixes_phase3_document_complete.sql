-- Schema fixes phase 3. Posted and void documents are complete by constraint.

do $$
declare
  v_rows text;
begin
  select string_agg(id::text, ', ')
    into v_rows
  from public.transaction_headers
  where (status <> 'draft' and (
      document_number is null
      or issuer_snapshot is null
      or party_snapshot is null
      or posted_at is null
    ))
    or (status = 'draft' and (
      posted_at is not null
      or posted_by is not null
      or issuer_snapshot is not null
      or party_snapshot is not null
    ))
    or (status = 'void' and (voided_at is null or void_reason is null))
    or (status <> 'void' and (
      voided_at is not null
      or voided_by is not null
      or void_reason is not null
    ));
  if v_rows is not null then
    raise exception 'These documents are not complete enough for the new status rules: %', v_rows;
  end if;
end;
$$;

alter table public.transaction_headers
  add constraint transaction_headers_posted_complete
  check (status = 'draft' or (
    document_number is not null
    and issuer_snapshot is not null
    and party_snapshot is not null
    and posted_at is not null
  )),
  add constraint transaction_headers_draft_clean
  check (status <> 'draft' or (
    posted_at is null
    and posted_by is null
    and issuer_snapshot is null
    and party_snapshot is null
  )),
  add constraint transaction_headers_void_complete
  check (status <> 'void' or (voided_at is not null and void_reason is not null)),
  add constraint transaction_headers_void_only
  check (status = 'void' or (voided_at is null and voided_by is null and void_reason is null));
