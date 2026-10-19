-- EN 16931 phase 3. VAT breakdown is per category and rate. Posted totals stay put.
begin;
create temp table phase3_users (id uuid primary key);
insert into phase3_users values ('a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3');
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'owner-phase3@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb
from phase3_users;
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from phase3_users), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('test.org', (public.create_tenant('Phase Three Books', 'Phase Three Office'))->>'organisation_id', true);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), true);

insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1);
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id
from public.currencies where organisation_id = current_setting('test.org')::uuid;
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category, exemption_reason)
values
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'P23', 'Standard', 23, 'Expense', 'S', null),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'E1', 'Exempt one', 0, 'Expense', 'E', 'Exempt one'),
  (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'E2', 'Exempt two', 0, 'Expense', 'E', 'Exempt two');

select set_config('test.type', (select id::text from public.transaction_types where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.currency', (select id::text from public.currencies where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.supplier', (select id::text from public.suppliers where organisation_id = current_setting('test.org')::uuid), true);
select set_config('test.p23', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'P23'), true);
select set_config('test.e1', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'E1'), true);
select set_config('test.e2', (select id::text from public.vat_rates where organisation_id = current_setting('test.org')::uuid and code = 'E2'), true);

do $$
declare
  v_header uuid;
  v_vat numeric;
  v_line_vat numeric;
  v_due numeric;
  v_stored numeric;
begin
  begin
    insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
    values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'S0', 'Zero standard', 0, 'Expense', 'S');
    raise exception 'phase 3: a standard rate of zero was saved';
  exception
    when others then
      if sqlerrm not like '%above zero%' then
        raise exception 'phase 3: standard rate error was %', sqlerrm;
      end if;
  end;

  begin
    insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
    values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EX', 'Bare exempt', 0, 'Expense', 'E');
    raise exception 'phase 3: an exempt rate without a reason was saved';
  exception
    when others then
      if sqlerrm not like '%exemption%' then
        raise exception 'phase 3: exemption error was %', sqlerrm;
      end if;
  end;

  v_header := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-19',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'roundingAmount', 0.05,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'A', 'quantity', 1, 'price', 0.05, 'vatRateId', current_setting('test.p23')),
      jsonb_build_object('description', 'B', 'quantity', 1, 'price', 0.05, 'vatRateId', current_setting('test.p23')),
      jsonb_build_object('description', 'C', 'quantity', 1, 'price', 0.05, 'vatRateId', current_setting('test.p23'))
    )
  ));

  select foreign_vat_amount, amount_due into v_vat, v_due
  from public.transaction_headers where id = v_header;
  if v_vat <> 0.03 or v_due <> 0.23 then
    raise exception 'phase 3: three 0.05 lines gave VAT % and amount due %', v_vat, v_due;
  end if;
  if not exists (
    select 1 from public.transaction_vat_breakdown
    where header_id = v_header and vat_category = 'S' and vat_percentage = 23
      and taxable_amount = 0.15 and vat_amount = 0.03
  ) then
    raise exception 'phase 3: breakdown was not 0.15 at 23 percent';
  end if;
  if (select foreign_nett_amount + foreign_vat_amount from public.transaction_headers where id = v_header)
     <> (select foreign_total_amount from public.transaction_headers where id = v_header) then
    raise exception 'phase 3: header total is not nett plus VAT';
  end if;

  perform public.post_document(v_header, null);
  select foreign_vat_amount into v_stored from public.transaction_headers where id = v_header;
  update public.transaction_headers set paid_amount = 0.10 where id = v_header;
  select foreign_vat_amount, amount_due into v_vat, v_due from public.transaction_headers where id = v_header;
  if v_vat <> v_stored or v_due <> 0.13 then
    raise exception 'phase 3: paying changed VAT to % or amount due to %', v_vat, v_due;
  end if;

  update public.transaction_headers set rounding_amount = 1 where id = v_header;
  if (select rounding_amount from public.transaction_headers where id = v_header) <> 0.05 then
    raise exception 'phase 3: rounding changed on a posted document';
  end if;

  begin
    update public.vat_rates set vat_category = 'L' where id = current_setting('test.p23')::uuid;
    raise exception 'phase 3: a posted VAT category was changed';
  exception
    when others then
      if sqlerrm not like '%posted documents%' then
        raise exception 'phase 3: category guard error was %', sqlerrm;
      end if;
  end;

  v_header := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-20',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'D', 'quantity', 1, 'price', 0.01, 'vatRateId', current_setting('test.p23')),
      jsonb_build_object('description', 'E', 'quantity', 1, 'price', 0.01, 'vatRateId', current_setting('test.p23')),
      jsonb_build_object('description', 'F', 'quantity', 1, 'price', 0.01, 'vatRateId', current_setting('test.p23'))
    )
  ));
  select foreign_vat_amount, coalesce(sum(line.vat_amount), 0)
    into v_vat, v_line_vat
  from public.transaction_headers as header
  join public.transaction_lines as line on line.header_id = header.id
  where header.id = v_header
  group by header.foreign_vat_amount;
  if v_vat <> 0.01 or v_line_vat <> 0 then
    raise exception 'phase 3: penny lines gave breakdown VAT % and line VAT %', v_vat, v_line_vat;
  end if;

  v_header := public.save_purchase_invoice(jsonb_build_object(
    'transactionTypeId', current_setting('test.type'),
    'supplierId', current_setting('test.supplier'),
    'transactionDate', '2026-10-21',
    'currencyId', current_setting('test.currency'),
    'exchangeRate', 1,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'G', 'quantity', 1, 'price', 10, 'vatRateId', current_setting('test.e1')),
      jsonb_build_object('description', 'H', 'quantity', 1, 'price', 10, 'vatRateId', current_setting('test.e2'))
    )
  ));
  begin
    perform public.post_document(v_header, null);
    raise exception 'phase 3: mixed exemptions were posted';
  exception
    when others then
      if sqlerrm not like '%same exemption%' then
        raise exception 'phase 3: exemption post error was %', sqlerrm;
      end if;
  end;
end;
$$;

reset role;
rollback;
select 'en16931 phase 3 ok' as result;
