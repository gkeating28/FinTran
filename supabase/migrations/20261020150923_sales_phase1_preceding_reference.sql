create or replace function private.enforce_preceding_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.document_kind;
  v_direction text;
  v_target_status public.document_status;
  v_target_kind public.document_kind;
  v_target_direction text;
  v_target_supplier uuid;
  v_target_customer uuid;
  v_target_reference integer;
  v_target_number text;
  v_target_date date;
  v_found boolean;
begin
  if tg_op = 'UPDATE' and old.status in ('posted', 'void') then
    return new;
  end if;

  new.preceding_reference := nullif(btrim(new.preceding_reference), '');
  if new.preceding_reference is not null and char_length(new.preceding_reference) > 60 then
    raise exception 'The credited invoice reference can be up to 60 characters';
  end if;

  if new.preceding_header_id is not null then
    if new.preceding_header_id = new.id then
      raise exception 'A document cannot credit itself';
    end if;

    select
      header.status,
      header.supplier_id,
      header.customer_id,
      header.reference,
      header.document_number,
      header.transaction_date,
      kind.document_kind,
      kind.type
    into
      v_target_status,
      v_target_supplier,
      v_target_customer,
      v_target_reference,
      v_target_number,
      v_target_date,
      v_target_kind,
      v_target_direction
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    where header.id = new.preceding_header_id
      and header.organisation_id = new.organisation_id;

    v_found := found;

    if v_found then
      if v_target_status is distinct from 'posted' or v_target_kind is distinct from 'invoice' then
        raise exception 'The credited document must be a posted invoice';
      end if;

      select document_kind, type into v_kind, v_direction
      from public.transaction_types
      where id = new.transaction_type_id;

      if v_target_direction is distinct from v_direction then
        raise exception 'Choose a posted invoice from this organisation';
      end if;

      if v_direction = 'Purchases' and v_target_supplier is distinct from new.supplier_id then
        raise exception 'The credited document must be for the same supplier';
      end if;

      if v_direction = 'Sales' and v_target_customer is distinct from new.customer_id then
        raise exception 'The credited document must be for the same customer';
      end if;

      if new.preceding_reference is null then
        new.preceding_reference := coalesce(v_target_number, v_target_reference::text);
      end if;
      if new.preceding_date is null then
        new.preceding_date := v_target_date;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.status is distinct from 'posted'
     and new.status = 'posted' then
    select document_kind into v_kind
    from public.transaction_types
    where id = new.transaction_type_id;

    if v_kind = 'credit_note' and new.preceding_reference is null then
      raise exception 'Enter the invoice this credit note applies to';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_preceding_invoice() from public, anon, authenticated;
