-- User-facing e-invoice errors use the product name. Rolls back.
begin;

do $$
declare
  v_import text := pg_get_functiondef('public.import_e_document(uuid, jsonb)'::regprocedure);
  v_totals text := pg_get_functiondef('private.enforce_e_invoice_totals()'::regprocedure);
begin
  if position('Qula Plus' in v_import) = 0 or position('FinTran' in v_import) > 0 then
    raise exception 'import_e_document still names FinTran';
  end if;
  if position('Qula Plus' in v_totals) = 0 or position('FinTran' in v_totals) > 0 then
    raise exception 'e-invoice total message still names FinTran';
  end if;
end $$;

rollback;
