-- User-facing e-invoice messages use the product name Qula Plus.
-- Each function is redefined from its own definition with the name replaced, so nothing else changes.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array['public.import_e_document(uuid, jsonb)', 'private.enforce_e_invoice_totals()'] loop
    execute replace(pg_get_functiondef(v_signature::regprocedure), 'Qula Tran', 'Qula Plus');
  end loop;
end
$$;
