-- EN 16931 phase 3: VAT categories and the document VAT breakdown.
-- Line nett and document amounts are rounded to 2 decimal places on new writes.
-- Existing amount columns stay numeric(16,4). Posted headers keep their stored totals.

alter table public.vat_rates
  add column vat_category text,
  add column exemption_code text,
  add column exemption_reason text;

update public.vat_rates
set vat_category = case when rate > 0 then 'S' else 'Z' end
where vat_category is null;

do $$
declare
  v_code text;
  v_any boolean := false;
begin
  for v_code in
    select code from public.vat_rates where rate = 0 order by code
  loop
    v_any := true;
    raise notice 'Zero-rated VAT code to review: %', v_code;
  end loop;
  if not v_any then
    raise notice 'No zero-rated VAT codes.';
  end if;
end;
$$;

alter table public.vat_rates
  alter column vat_category set not null,
  add constraint vat_rates_exemption_reason_check check (
    exemption_reason is null or char_length(exemption_reason) between 1 and 200
  ),
  add constraint vat_rates_vat_category_fkey
    foreign key (vat_category) references public.ref_vat_categories (code),
  add constraint vat_rates_exemption_code_fkey
    foreign key (exemption_code) references public.ref_vatex (code);

comment on column public.vat_rates.vat_category is 'EN 16931 BT-118 VAT category code';
comment on column public.vat_rates.exemption_code is 'EN 16931 BT-121 VAT exemption reason code';
comment on column public.vat_rates.exemption_reason is 'EN 16931 BT-120 VAT exemption reason text';

create or replace function private.enforce_vat_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zero boolean;
  v_reason boolean;
begin
  new.exemption_reason := nullif(btrim(new.exemption_reason), '');
  new.exemption_code := nullif(btrim(new.exemption_code), '');

  select rate_must_be_zero, requires_exemption_reason
    into v_zero, v_reason
  from public.ref_vat_categories
  where code = new.vat_category;

  if v_zero is null then
    raise exception 'Choose a VAT category';
  end if;
  if new.vat_category = 'S' and new.rate <= 0 then
    raise exception 'A standard rate VAT code must be above zero';
  end if;
  if v_zero and new.rate <> 0 then
    raise exception 'This VAT category must have a rate of zero';
  end if;
  if v_reason and new.exemption_code is null and new.exemption_reason is null then
    raise exception 'Enter an exemption code or a reason';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_vat_category() from public, anon, authenticated;

create trigger vat_rates_category
  before insert or update on public.vat_rates
  for each row execute function private.enforce_vat_category();

create or replace function private.guard_posted_vat_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rate is distinct from old.rate
     or new.vat_type is distinct from old.vat_type
     or new.vat_category is distinct from old.vat_category then
    if exists (
      select 1
      from public.transaction_lines as line
      join public.transaction_headers as header on header.id = line.header_id
      where line.vat_rate_id = new.id
        and header.status in ('posted', 'void')
    ) then
      raise exception 'This VAT rate is used on posted documents. Create a new VAT code instead.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_posted_vat_rate() from public, anon, authenticated;

alter table public.transaction_lines
  add column vat_category text not null default 'O',
  add column exemption_code text,
  add column exemption_reason text;

alter table public.transaction_lines disable trigger transaction_lines_scope;
alter table public.transaction_lines disable trigger transaction_lines_refresh_header;
alter table public.transaction_lines disable trigger zz_document_lines;

update public.transaction_lines as line
set
  vat_category = rate.vat_category,
  exemption_code = rate.exemption_code,
  exemption_reason = rate.exemption_reason
from public.vat_rates as rate
where line.vat_rate_id = rate.id;

update public.transaction_lines
set vat_category = 'O', exemption_code = null, exemption_reason = null
where vat_rate_id is null;

alter table public.transaction_lines enable trigger transaction_lines_scope;
alter table public.transaction_lines enable trigger transaction_lines_refresh_header;
alter table public.transaction_lines enable trigger zz_document_lines;

alter table public.transaction_lines
  add constraint transaction_lines_exemption_reason_check check (
    exemption_reason is null or char_length(exemption_reason) between 1 and 200
  ),
  add constraint transaction_lines_vat_category_fkey
    foreign key (vat_category) references public.ref_vat_categories (code),
  add constraint transaction_lines_exemption_code_fkey
    foreign key (exemption_code) references public.ref_vatex (code);

comment on column public.transaction_lines.vat_category is 'EN 16931 BT-151 Invoiced item VAT category code';
comment on column public.transaction_lines.exemption_code is 'EN 16931 BT-121 VAT exemption reason code, copied from the VAT code';
comment on column public.transaction_lines.exemption_reason is 'EN 16931 BT-120 VAT exemption reason text, copied from the VAT code';
comment on column public.transaction_lines.vat_amount is 'Display only. Document VAT is the VAT breakdown, not the sum of this column';

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

    if vat_kind is distinct from 'Expense' then
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

    if vat_kind is distinct from 'Expense' then
      raise exception 'Purchase VAT code must be an Expense rate';
    end if;
  end if;

  new.vat_amount := round(new.nett_amount * new.vat_percentage / 100, 2);
  return new;
end;
$$;

revoke all on function private.enforce_transaction_line() from public, anon, authenticated;

create table public.transaction_vat_breakdown (
  header_id uuid not null,
  organisation_id uuid not null,
  tenant_id uuid not null,
  vat_category text not null,
  vat_percentage numeric(5, 2) not null,
  exemption_code text,
  exemption_reason text,
  taxable_amount numeric(18, 2) not null,
  vat_amount numeric(18, 2) not null,
  primary key (header_id, vat_category, vat_percentage),
  foreign key (organisation_id, header_id) references public.transaction_headers (organisation_id, id) on delete cascade,
  foreign key (vat_category) references public.ref_vat_categories (code),
  foreign key (exemption_code) references public.ref_vatex (code),
  constraint transaction_vat_breakdown_exemption_reason_check check (
    exemption_reason is null or char_length(exemption_reason) between 1 and 200
  )
);

comment on table public.transaction_vat_breakdown is 'EN 16931 BG-23 VAT breakdown. Maintained by the header totals trigger.';
comment on column public.transaction_vat_breakdown.vat_category is 'EN 16931 BT-118 VAT category code';
comment on column public.transaction_vat_breakdown.vat_percentage is 'EN 16931 BT-119 VAT category rate';
comment on column public.transaction_vat_breakdown.exemption_code is 'EN 16931 BT-121 VAT exemption reason code';
comment on column public.transaction_vat_breakdown.exemption_reason is 'EN 16931 BT-120 VAT exemption reason text';
comment on column public.transaction_vat_breakdown.taxable_amount is 'EN 16931 BT-116 VAT category taxable amount';
comment on column public.transaction_vat_breakdown.vat_amount is 'EN 16931 BT-117 VAT category tax amount';

alter table public.transaction_vat_breakdown enable row level security;

create policy transaction_vat_breakdown_select on public.transaction_vat_breakdown
  for select to authenticated
  using ((select private.is_org_member(organisation_id)));

revoke all on table public.transaction_vat_breakdown from public, anon, authenticated;
grant select on table public.transaction_vat_breakdown to authenticated;

create or replace function private.replace_vat_breakdown(p_header_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
begin
  select organisation_id, tenant_id into v_org, v_tenant
  from public.transaction_headers
  where id = p_header_id;

  delete from public.transaction_vat_breakdown where header_id = p_header_id;

  insert into public.transaction_vat_breakdown (
    header_id, organisation_id, tenant_id, vat_category, vat_percentage,
    exemption_code, exemption_reason, taxable_amount, vat_amount
  )
  select
    p_header_id,
    v_org,
    v_tenant,
    line.vat_category,
    line.vat_percentage,
    min(line.exemption_code),
    min(line.exemption_reason),
    round(sum(line.nett_amount), 2),
    round(round(sum(line.nett_amount), 2) * line.vat_percentage / 100, 2)
  from public.transaction_lines as line
  where line.header_id = p_header_id
  group by line.vat_category, line.vat_percentage;
end;
$$;

revoke all on function private.replace_vat_breakdown(uuid) from public, anon, authenticated;

alter table public.transaction_headers
  add column rounding_amount numeric(18, 2) not null default 0,
  add column amount_due numeric(18, 2);

comment on column public.transaction_headers.rounding_amount is 'EN 16931 BT-114 Rounding amount. Editable on drafts only';
comment on column public.transaction_headers.amount_due is 'EN 16931 BT-115 Amount due for payment';

create or replace function private.enforce_document_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_allowed text[] := array[
    'paid_amount',
    'amount_due',
    'created_at', 'created_by', 'updated_at', 'updated_by'
  ];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted and void documents cannot be deleted';
    end if;
    if private.document_period_locked(old.organisation_id, old.transaction_date) then
      raise exception 'This date is in a locked period';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft'
       or new.posted_at is not null
       or new.posted_by is not null
       or new.voided_at is not null
       or new.voided_by is not null
       or new.void_reason is not null then
      raise exception 'Document status can only be changed by posting or voiding';
    end if;
    if private.document_period_locked(new.organisation_id, new.transaction_date) then
      raise exception 'This date is in a locked period';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.posted_at is distinct from old.posted_at
     or new.posted_by is distinct from old.posted_by
     or new.voided_at is distinct from old.voided_at
     or new.voided_by is distinct from old.voided_by
     or new.void_reason is distinct from old.void_reason then
    if current_setting('fintran.status_change', true) is distinct from 'on' then
      raise exception 'Document status can only be changed by posting or voiding';
    end if;
    if not (
      (old.status = 'draft' and new.status = 'posted')
      or (old.status = 'posted' and new.status = 'void')
    ) then
      raise exception 'That status change is not allowed';
    end if;
  elsif old.status = 'posted' then
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      raise exception 'Only the paid amount can be changed on a posted document';
    end if;
  elsif old.status = 'void' then
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      raise exception 'A void document cannot be changed';
    end if;
  end if;

  if private.document_period_locked(new.organisation_id, new.transaction_date)
     or private.document_period_locked(old.organisation_id, old.transaction_date) then
    raise exception 'This date is in a locked period';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_document_status() from public, anon, authenticated;

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

  select type, numbering into type_kind, v_numbering
  from public.transaction_types
  where id = new.transaction_type_id;

  if type_kind is distinct from 'Purchases' then
    raise exception 'Choose a Purchases transaction type';
  end if;
  if new.supplier_id is null then
    raise exception 'Choose a supplier';
  end if;
  if new.customer_id is not null then
    raise exception 'A purchase document cannot have a customer';
  end if;

  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;

  new.supplier_name := btrim(new.supplier_name);
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

  if tg_op = 'INSERT' and v_numbering is distinct from 'on_post' then
    new.reference := private.issue_reference(new.transaction_type_id);
  elsif tg_op = 'INSERT' then
    new.reference := null;
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

create or replace function private.refresh_vat_breakdown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('posted', 'void') then
    return null;
  end if;
  perform private.replace_vat_breakdown(new.id);
  return null;
end;
$$;

revoke all on function private.refresh_vat_breakdown() from public, anon, authenticated;

create trigger zz_refresh_vat_breakdown
  after insert or update on public.transaction_headers
  for each row execute function private.refresh_vat_breakdown();

create or replace function public.save_purchase_invoice(p_document jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_header_id uuid;
  v_header_org uuid;
  v_supplier_name text;
  v_line jsonb;
  v_line_number integer := 0;
  v_status public.document_status;
begin
  select organisation_id, tenant_id into v_org, v_tenant
  from public.transaction_types
  where id = nullif(p_document->>'transactionTypeId', '')::uuid
    and type = 'Purchases';

  if v_org is null then
    raise exception 'Choose a Purchases transaction type';
  end if;

  select name into v_supplier_name
  from public.suppliers
  where id = nullif(p_document->>'supplierId', '')::uuid
    and organisation_id = v_org;

  if v_supplier_name is null then
    raise exception 'Choose a supplier';
  end if;

  if nullif(btrim(p_document->>'supplierName'), '') is not null then
    v_supplier_name := btrim(p_document->>'supplierName');
  end if;

  v_header_id := nullif(p_document->>'id', '')::uuid;

  if v_header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, supplier_name, contact_details, notes,
      currency_id, exchange_rate, order_number, paid_amount, rounding_amount,
      supplier_reference, supply_date,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      v_tenant,
      v_org,
      (p_document->>'transactionTypeId')::uuid,
      0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      (p_document->>'supplierId')::uuid,
      v_supplier_name,
      p_document->>'contactDetails',
      p_document->>'notes',
      (p_document->>'currencyId')::uuid,
      (p_document->>'exchangeRate')::numeric,
      p_document->>'orderNumber',
      coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
      p_document->>'supplierReference',
      nullif(p_document->>'supplyDate', '')::date,
      p_document->>'flex1',
      p_document->>'flex2',
      p_document->>'flex3',
      p_document->>'flex4',
      p_document->>'flex5'
    )
    returning id into v_header_id;
  else
    select organisation_id, status into v_header_org, v_status
    from public.transaction_headers
    where id = v_header_id;

    if v_header_org is null then
      raise exception 'That invoice could not be updated';
    end if;
    if v_status is distinct from 'draft' then
      raise exception 'Only a draft document can be changed';
    end if;
    if v_header_org is distinct from v_org then
      raise exception 'That invoice belongs to another organisation';
    end if;
    if not exists (
      select 1
      from public.organisation_access
      where organisation_id = v_header_org
        and user_id = (select auth.uid())
    ) then
      raise exception 'You are not a member of this organisation';
    end if;

    update public.transaction_headers
    set transaction_date = (p_document->>'transactionDate')::date,
        due_date = nullif(p_document->>'dueDate', '')::date,
        supplier_id = (p_document->>'supplierId')::uuid,
        supplier_name = v_supplier_name,
        contact_details = p_document->>'contactDetails',
        notes = p_document->>'notes',
        currency_id = (p_document->>'currencyId')::uuid,
        exchange_rate = (p_document->>'exchangeRate')::numeric,
        order_number = p_document->>'orderNumber',
        paid_amount = coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
        rounding_amount = coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
        supplier_reference = p_document->>'supplierReference',
        supply_date = nullif(p_document->>'supplyDate', '')::date,
        flex1 = p_document->>'flex1',
        flex2 = p_document->>'flex2',
        flex3 = p_document->>'flex3',
        flex4 = p_document->>'flex4',
        flex5 = p_document->>'flex5'
    where id = v_header_id
      and organisation_id = v_org;

    if not found then
      raise exception 'That invoice could not be updated';
    end if;

    delete from public.transaction_lines
    where header_id = v_header_id;
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_document->'lines', '[]'::jsonb))
  loop
    v_line_number := v_line_number + 1;
    insert into public.transaction_lines (
      tenant_id, organisation_id, header_id, transaction_type_id, reference, line_number,
      product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
      quantity, price, discount_amount, nett_amount, vat_amount
    ) values (
      v_tenant,
      v_org,
      v_header_id,
      (p_document->>'transactionTypeId')::uuid,
      0,
      v_line_number,
      nullif(v_line->>'productId', '')::uuid,
      coalesce(v_line->>'description', ''),
      nullif(v_line->>'glCodeId', '')::uuid,
      nullif(v_line->>'departmentId', '')::uuid,
      nullif(v_line->>'costCentreId', '')::uuid,
      nullif(v_line->>'vatRateId', '')::uuid,
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      coalesce(nullif(v_line->>'price', '')::numeric, 0),
      coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0),
      0,
      0
    );
  end loop;

  return v_header_id;
end;
$$;

revoke all on function public.save_purchase_invoice(jsonb) from public, anon;
grant execute on function public.save_purchase_invoice(jsonb) to authenticated;

update public.transaction_headers
set paid_amount = paid_amount;

alter table public.transaction_headers
  alter column amount_due set not null;

do $$
declare
  v_header uuid;
begin
  for v_header in
    select id from public.transaction_headers where status in ('posted', 'void')
  loop
    perform private.replace_vat_breakdown(v_header);
  end loop;
end;
$$;

do $$
declare
  v_row record;
  v_any boolean := false;
begin
  for v_row in
    select header.id,
           header.foreign_vat_amount as stored_vat,
           coalesce(sum(breakdown.vat_amount), 0) as breakdown_vat
    from public.transaction_headers as header
    left join public.transaction_vat_breakdown as breakdown
      on breakdown.header_id = header.id
    where header.status in ('posted', 'void')
    group by header.id, header.foreign_vat_amount
    having header.foreign_vat_amount is distinct from coalesce(sum(breakdown.vat_amount), 0)
  loop
    v_any := true;
    raise notice 'Posted document % keeps stored VAT %; breakdown VAT is %',
      v_row.id, v_row.stored_vat, v_row.breakdown_vat;
  end loop;
  if not v_any then
    raise notice 'No posted document has a VAT breakdown difference.';
  end if;
end;
$$;
