-- Close-out database rules. Rolls back.
begin;

do $$
declare
  v_import text := pg_get_functiondef('public.import_e_document(uuid, jsonb)'::regprocedure);
  v_delete text := pg_get_functiondef('public.delete_organisation(uuid)'::regprocedure);
  v_reject text := pg_get_functiondef('public.reject_e_document(uuid, text)'::regprocedure);
  v_store text := pg_get_functiondef('public.store_e_document(jsonb, text, text)'::regprocedure);
begin
  if position('Create the supplier before importing' in v_import) = 0 then
    raise exception 'import_e_document still creates suppliers';
  end if;
  if position('This organisation has e-documents and cannot be deleted.' in v_delete) = 0 then
    raise exception 'delete_organisation does not mention e-documents';
  end if;
  if position('Only an owner or admin can reject' in v_reject) = 0 then
    raise exception 'reject_e_document does not require an owner or admin';
  end if;
  if position('ubl_root' in v_store) = 0 then
    raise exception 'duplicate detection does not compare the document kind';
  end if;
end $$;

rollback;
