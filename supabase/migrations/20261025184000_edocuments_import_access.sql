-- import_e_document runs as the signed-in user so purchase policies apply.
-- That user can execute the status helper, and needs to be allowed into the
-- private schema to reach it. The helper still refuses another organisation.

grant usage on schema private to authenticated;

create or replace function private.set_e_document_status(
  p_id uuid,
  p_to public.e_document_status,
  p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.e_documents%rowtype;
begin
  select * into v_row from public.e_documents where id = p_id for update;
  if v_row.id is null or not private.is_org_member(v_row.organisation_id) then
    raise exception 'That e-document was not found';
  end if;
  if not private.e_document_transition_allowed(v_row.direction, v_row.status, p_to) then
    raise exception 'That e-document status change is not allowed';
  end if;

  update public.e_documents
  set status = p_to,
      duplicate_of = coalesce(nullif(p_detail->>'duplicateOf', '')::uuid, duplicate_of),
      rejection_reason = case
        when p_to = 'rejected' then nullif(btrim(p_detail->>'reason'), '')
        else rejection_reason
      end,
      header_id = coalesce(nullif(p_detail->>'headerId', '')::uuid, header_id),
      validated_at = case
        when p_to in ('valid', 'invalid', 'duplicate') then coalesce(validated_at, now())
        else validated_at
      end,
      updated_at = now(),
      updated_by = (select auth.uid())
  where id = p_id;
end;
$$;

revoke all on function private.set_e_document_status(uuid, public.e_document_status, jsonb) from public, anon;
grant execute on function private.set_e_document_status(uuid, public.e_document_status, jsonb) to authenticated;
