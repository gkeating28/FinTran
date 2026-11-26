-- Fixtures written before the ledger made a GL code compulsory on every invoice line leave it out. This gives each line without one
-- a code of the right kind (income for a sale, expense for a purchase), made if the organisation has none, for the rest of the
-- test transaction. A test about the refusal itself does not include this file, or sets a line's code back to null with
-- fintran.test_no_default_gl on.
create function pg_temp.default_line_gl() returns trigger
  language plpgsql security definer set search_path to ''
as $$
declare
  v_type text;
  v_id uuid;
  v_tenant uuid;
begin
  if new.gl_code_id is not null or current_setting('fintran.test_no_default_gl', true) = 'on' then
    return new;
  end if;
  select case when tt.type = 'Sales' then 'Income' else 'Expense' end into v_type
  from public.transaction_headers as h join public.transaction_types as tt on tt.id = h.transaction_type_id
  where h.id = new.header_id;
  select id into v_id from public.gl_codes
  where organisation_id = new.organisation_id and active and system_role is null and account_type = v_type
  order by code limit 1;
  if v_id is null then
    select tenant_id into v_tenant from public.organisations where id = new.organisation_id;
    insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
    values (v_tenant, new.organisation_id, case when v_type = 'Income' then 'TSTI' else 'TSTE' end, 'Test ' || lower(v_type), v_type)
    returning id into v_id;
  end if;
  new.gl_code_id := v_id;
  return new;
end;
$$;
create trigger aa_default_line_gl before insert on public.transaction_lines
  for each row execute function pg_temp.default_line_gl();
