-- Schema fixes phase 4. Store document amounts at 2 decimal places.

do $$
declare
  v_rows text;
begin
  select string_agg(id::text, ', ')
    into v_rows
  from (
    select id
    from public.transaction_headers
    where status in ('posted', 'void')
      and (
        foreign_nett_amount is distinct from round(foreign_nett_amount, 2)
        or foreign_vat_amount is distinct from round(foreign_vat_amount, 2)
        or foreign_total_amount is distinct from round(foreign_total_amount, 2)
        or home_nett_amount is distinct from round(home_nett_amount, 2)
        or home_vat_amount is distinct from round(home_vat_amount, 2)
        or home_total_amount is distinct from round(home_total_amount, 2)
        or paid_amount is distinct from round(paid_amount, 2)
      )
    union
    select header_id
    from public.transaction_lines as line
    join public.transaction_headers as header on header.id = line.header_id
    where header.status in ('posted', 'void')
      and (
        line.nett_amount is distinct from round(line.nett_amount, 2)
        or line.vat_amount is distinct from round(line.vat_amount, 2)
        or line.discount_amount is distinct from round(line.discount_amount, 2)
      )
  ) as blocked;
  if v_rows is not null then
    raise exception 'Posted or void documents have amounts with more than 2 decimal places: %', v_rows;
  end if;
end;
$$;

alter table public.transaction_headers
  alter column foreign_nett_amount type numeric(18,2),
  alter column foreign_vat_amount type numeric(18,2),
  alter column foreign_total_amount type numeric(18,2),
  alter column home_nett_amount type numeric(18,2),
  alter column home_vat_amount type numeric(18,2),
  alter column home_total_amount type numeric(18,2),
  alter column paid_amount type numeric(18,2);

alter table public.transaction_lines
  alter column nett_amount type numeric(18,2),
  alter column vat_amount type numeric(18,2),
  alter column discount_amount type numeric(18,2);

update public.transaction_lines as line
set description = line.description
from public.transaction_headers as header
where header.id = line.header_id
  and header.status = 'draft';
