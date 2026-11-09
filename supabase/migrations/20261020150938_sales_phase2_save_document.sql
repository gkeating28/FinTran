create or replace function private.apply_sales_document_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direction text;
  v_days integer;
  v_buyer text;
begin
  if tg_op = 'UPDATE' and old.status in ('posted', 'void') then
    return new;
  end if;

  select type into v_direction
  from public.transaction_types
  where id = new.transaction_type_id;

  if v_direction is distinct from 'Sales' or new.customer_id is null then
    return new;
  end if;

  select payment_terms_days, default_buyer_reference
    into v_days, v_buyer
  from public.customers
  where id = new.customer_id
    and organisation_id = new.organisation_id;

  if tg_op = 'INSERT' then
    if new.buyer_reference is null then
      new.buyer_reference := v_buyer;
    end if;
    if v_days is not null and new.due_date is null then
      new.due_date := new.transaction_date + v_days;
    end if;
    if v_days is not null and new.payment_terms is null then
      new.payment_terms := case
        when v_days = 0 then 'Due on receipt'
        when v_days = 1 then 'Payment due within 1 day'
        else 'Payment due within ' || v_days::text || ' days'
      end;
    end if;
    return new;
  end if;

  if v_days is not null
     and old.due_date is not distinct from (old.transaction_date + v_days)
     and (new.due_date is not distinct from old.due_date or new.due_date is null)
     and new.transaction_date is distinct from old.transaction_date then
    new.due_date := new.transaction_date + v_days;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_sales_document_defaults() from public, anon, authenticated;

drop trigger if exists transaction_headers_sales_defaults on public.transaction_headers;
create trigger transaction_headers_sales_defaults
  before insert or update on public.transaction_headers
  for each row execute function private.apply_sales_document_defaults();
