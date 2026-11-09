create or replace function private.enforce_transaction_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  header_org uuid;
  header_tenant uuid;
  header_type uuid;
  header_reference integer;
  vat_kind text;
  vat_rate numeric(5, 2);
  v_category text;
  v_exemption_code text;
  v_exemption_reason text;
  v_direction text;
  copy_rate boolean;
begin
  select organisation_id, tenant_id, transaction_type_id, reference
    into header_org, header_tenant, header_type, header_reference
  from public.transaction_headers
  where id = new.header_id;

  if header_org is null then
    raise exception 'Choose a transaction';
  end if;

  new.organisation_id := header_org;
  new.tenant_id := header_tenant;
  new.transaction_type_id := header_type;
  new.reference := header_reference;
  new.description := btrim(new.description);

  if new.discount_amount > new.quantity * new.price then
    raise exception 'Discount cannot be more than quantity times price';
  end if;

  new.nett_amount := round(new.quantity * new.price - new.discount_amount, 2);
  copy_rate := tg_op = 'INSERT' or new.vat_rate_id is distinct from old.vat_rate_id;

  select type into v_direction
  from public.transaction_types
  where id = new.transaction_type_id;

  if new.vat_rate_id is null then
    new.vat_percentage := 0;
    new.vat_category := 'O';
    new.exemption_code := null;
    new.exemption_reason := null;
  elsif copy_rate then
    select vat_type, rate, vat_rates.vat_category, exemption_code, exemption_reason
      into vat_kind, vat_rate, v_category, v_exemption_code, v_exemption_reason
    from public.vat_rates
    where id = new.vat_rate_id;

    if v_direction = 'Sales' and vat_kind is distinct from 'Sales' then
      raise exception 'Sales VAT code must be a Sales rate';
    end if;
    if v_direction is distinct from 'Sales' and vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;

    new.vat_percentage := vat_rate;
    new.vat_category := v_category;
    new.exemption_code := v_exemption_code;
    new.exemption_reason := v_exemption_reason;
  else
    select vat_type into vat_kind
    from public.vat_rates
    where id = new.vat_rate_id;

    if v_direction = 'Sales' and vat_kind is distinct from 'Sales' then
      raise exception 'Sales VAT code must be a Sales rate';
    end if;
    if v_direction is distinct from 'Sales' and vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;
  end if;

  new.vat_amount := round(new.nett_amount * new.vat_percentage / 100, 2);
  return new;
end;
$$;

revoke all on function private.enforce_transaction_line() from public, anon, authenticated;

alter table public.transaction_headers disable trigger zz_document_status;
update public.transaction_headers
set document_number = reference::text
where reference is not null
  and document_number is null;
alter table public.transaction_headers enable trigger zz_document_status;
