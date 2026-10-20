-- Store sales orders. They follow the other sales rules and are still not exported.

create or replace function private.enforce_transaction_header()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  type_kind text;
  v_numbering public.numbering_rule;
  v_prefix text;
  v_padding integer;
  v_party_currency uuid;
  nett numeric(16, 4);
  vat numeric(16, 4);
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id
       or new.transaction_type_id is distinct from old.transaction_type_id) then
    raise exception 'A transaction cannot be moved or renumbered';
  end if;

  if tg_op = 'UPDATE' and new.reference is distinct from old.reference then
    if old.reference is not null
       or current_setting('fintran.status_change', true) is distinct from 'on' then
      raise exception 'A transaction cannot be moved or renumbered';
    end if;
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  select type, numbering
    into type_kind, v_numbering
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_kind = 'Sales' then
    if new.customer_id is null then
      raise exception 'Choose a customer';
    end if;
    if new.supplier_id is not null then
      raise exception 'A sales document cannot have a supplier';
    end if;
  elsif type_kind = 'Purchases' then
    if new.supplier_id is null then
      raise exception 'Choose a supplier';
    end if;
    if new.customer_id is not null then
      raise exception 'A purchase document cannot have a customer';
    end if;
  else
    raise exception 'Choose a Purchases transaction type';
  end if;

  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;

  new.party_name := btrim(new.party_name);
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  new.order_number := nullif(btrim(new.order_number), '');
  new.supplier_reference := nullif(btrim(new.supplier_reference), '');
  new.flex1 := nullif(btrim(new.flex1), '');
  new.flex2 := nullif(btrim(new.flex2), '');
  new.flex3 := nullif(btrim(new.flex3), '');
  new.flex4 := nullif(btrim(new.flex4), '');
  new.flex5 := nullif(btrim(new.flex5), '');
  if new.rounding_amount is null then
    new.rounding_amount := 0;
  end if;

  if type_kind = 'Sales' and new.supplier_reference is not null then
    raise exception 'A supplier invoice number is only stored on a purchase';
  end if;

  if type_kind = 'Sales' then
    select currency_id into v_party_currency
    from public.customers
    where id = new.customer_id
      and organisation_id = new.organisation_id;
  else
    select currency_id into v_party_currency
    from public.suppliers
    where id = new.supplier_id
      and organisation_id = new.organisation_id;
  end if;
  if v_party_currency is null or v_party_currency is distinct from new.currency_id then
    raise exception 'The document currency must match the party currency';
  end if;

  if tg_op = 'INSERT' and v_numbering is distinct from 'on_post' then
    new.reference := private.issue_reference(new.transaction_type_id);
  elsif tg_op = 'INSERT' then
    new.reference := null;
  end if;

  if tg_op = 'UPDATE' and old.document_number is not null then
    new.document_number := old.document_number;
  elsif new.reference is not null then
    select reference_prefix, reference_padding into v_prefix, v_padding
    from public.transaction_types
    where id = new.transaction_type_id;
    new.document_number := private.format_document_number(v_prefix, v_padding, new.reference);
    if char_length(new.document_number) > 30 or char_length(new.document_number) < 1 then
      raise exception 'The document number is too long';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status in ('posted', 'void') then
    new.foreign_nett_amount := old.foreign_nett_amount;
    new.foreign_vat_amount := old.foreign_vat_amount;
    new.foreign_total_amount := old.foreign_total_amount;
    new.home_nett_amount := old.home_nett_amount;
    new.home_vat_amount := old.home_vat_amount;
    new.home_total_amount := old.home_total_amount;
    new.rounding_amount := old.rounding_amount;
    new.amount_due := round(old.foreign_total_amount - coalesce(new.paid_amount, 0) + old.rounding_amount, 2);
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'posted' then
    if type_kind = 'Sales' and exists (
      select 1 from public.transaction_lines
      where header_id = new.id and vat_rate_id is null
    ) then
      raise exception 'Enter a VAT code on every line';
    end if;
    if exists (
      select 1
      from public.transaction_lines
      where header_id = new.id
      group by vat_category, vat_percentage
      having count(distinct coalesce(exemption_code, '') || '|' || coalesce(exemption_reason, '')) > 1
    ) then
      raise exception 'Lines with the same VAT category and rate must use the same exemption';
    end if;
  end if;

  select coalesce(sum(grouped.taxable), 0), coalesce(sum(grouped.vat), 0)
    into nett, vat
  from (
    select
      round(sum(nett_amount), 2) as taxable,
      round(round(sum(nett_amount), 2) * vat_percentage / 100, 2) as vat
    from public.transaction_lines
    where header_id = new.id
    group by vat_category, vat_percentage
  ) as grouped;

  new.foreign_nett_amount := nett;
  new.foreign_vat_amount := vat;
  new.foreign_total_amount := nett + vat;
  new.home_nett_amount := round(nett / new.exchange_rate, 2);
  new.home_vat_amount := round(vat / new.exchange_rate, 2);
  new.home_total_amount := round((nett + vat) / new.exchange_rate, 2);
  new.amount_due := round(nett + vat - coalesce(new.paid_amount, 0) + new.rounding_amount, 2);
  return new;
end;
$$;

revoke all on function private.enforce_transaction_header() from public, anon, authenticated;
