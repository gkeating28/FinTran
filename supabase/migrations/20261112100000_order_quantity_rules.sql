-- Order quantity rules (hardening spec phase 4, decisions J5, J6 and J7).
--
-- used on an order line = quantity on invoice lines drawing on it that are not void (draft and posted)
--                       - quantity on POSTED credit note lines marked Return to order whose credited line draws on it
--
-- An order the system closed reopens by itself when a void or a returning credit note leaves something to invoice.
-- An order a person closed stays closed.

-- 1. Who closed the order.
alter table public.transaction_headers
  add column closed_by_system boolean not null default false;

comment on column public.transaction_headers.closed_by_system is
  'True while an order is closed because posted invoices covered every line. Closing by hand, or reopening, sets it to false.';

-- 2. Credit note lines can point at the invoice line they credit.
alter table public.transaction_lines
  add constraint transaction_lines_organisation_id_id_key unique (organisation_id, id);

alter table public.transaction_lines
  add column credited_line_id uuid,
  add column returns_to_order boolean not null default false,
  add constraint transaction_lines_credited_line_id_fkey
    foreign key (organisation_id, credited_line_id) references public.transaction_lines (organisation_id, id) on delete restrict,
  add constraint transaction_lines_returns_needs_credited check (not returns_to_order or credited_line_id is not null);

create index transaction_lines_credited_line_id_idx on public.transaction_lines (credited_line_id) where credited_line_id is not null;

comment on column public.transaction_lines.credited_line_id is
  'On a credit note line, the line on the credit note''s preceding invoice that it credits. Same organisation.';
comment on column public.transaction_lines.returns_to_order is
  'True when crediting this line gives its quantity back to the order the invoice line came from. It counts only once the credit note is posted.';

-- 3. The one calculation of how much of an order line is used.
create or replace function private.order_line_used(p_line_id uuid, p_except_line_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(drawn.quantity)
      from public.transaction_lines as drawn
      join public.transaction_headers as header on header.id = drawn.header_id
      where drawn.source_line_id = p_line_id
        and drawn.id is distinct from p_except_line_id
        and header.status <> 'void'
    ), 0)
    - coalesce((
      select sum(credit.quantity)
      from public.transaction_lines as credit
      join public.transaction_headers as header on header.id = credit.header_id
      join public.transaction_lines as credited on credited.id = credit.credited_line_id
      where credited.source_line_id = p_line_id
        and credit.returns_to_order
        and header.status = 'posted'
    ), 0);
$$;

revoke all on function private.order_line_used(uuid, uuid) from public, anon, authenticated;

-- What each order line shows: Invoiced, Reserved and Left.
create view public.order_line_usage
with (security_invoker = true)
as
select
  line.id as line_id,
  line.header_id,
  line.organisation_id,
  line.quantity,
  coalesce(drawn.posted, 0) - coalesce(returned.quantity, 0) as invoiced,
  coalesce(drawn.draft, 0) as reserved,
  line.quantity - (coalesce(drawn.posted, 0) - coalesce(returned.quantity, 0)) - coalesce(drawn.draft, 0) as remaining
from public.transaction_lines as line
join public.transaction_headers as header on header.id = line.header_id
join public.transaction_types as kind on kind.id = header.transaction_type_id
left join lateral (
  select
    sum(taken.quantity) filter (where taken_header.status = 'posted') as posted,
    sum(taken.quantity) filter (where taken_header.status = 'draft') as draft
  from public.transaction_lines as taken
  join public.transaction_headers as taken_header on taken_header.id = taken.header_id
  where taken.source_line_id = line.id
) as drawn on true
left join lateral (
  select sum(credit.quantity) as quantity
  from public.transaction_lines as credit
  join public.transaction_headers as credit_header on credit_header.id = credit.header_id
  join public.transaction_lines as credited on credited.id = credit.credited_line_id
  where credited.source_line_id = line.id
    and credit.returns_to_order
    and credit_header.status = 'posted'
) as returned on true
where kind.document_kind = 'order';

comment on view public.order_line_usage is
  'For each order line: invoiced is posted invoice quantity less returned credit quantity, reserved is draft invoice quantity, and remaining is quantity - invoiced - reserved.';

revoke all on public.order_line_usage from public, anon;
grant select on public.order_line_usage to authenticated;

-- 4. Rules for a credit note line that points at an invoice line.
create or replace function private.enforce_credited_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_preceding uuid;
  v_credited record;
  v_already numeric;
begin
  if new.credited_line_id is null then
    if new.returns_to_order then
      raise exception 'Return to order needs the invoice line being credited';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.credited_line_id is not distinct from old.credited_line_id
     and new.returns_to_order is not distinct from old.returns_to_order
     and new.quantity is not distinct from old.quantity then
    return new;
  end if;

  select kind.document_kind::text, header.preceding_header_id into v_kind, v_preceding
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = new.header_id;
  if v_kind is distinct from 'credit_note' then
    raise exception 'Only a credit note line can credit an invoice line';
  end if;

  -- The invoice line is locked so two credit notes cannot both take the last of it.
  perform 1 from public.transaction_lines where id = new.credited_line_id for update;
  select line.quantity, line.line_number, line.header_id, line.organisation_id, line.source_line_id,
         kind.document_kind::text as kind
    into v_credited
  from public.transaction_lines as line
  join public.transaction_headers as header on header.id = line.header_id
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where line.id = new.credited_line_id;

  if v_credited.header_id is null or v_credited.organisation_id is distinct from new.organisation_id then
    raise exception 'The invoice line being credited was not found';
  end if;
  if v_credited.kind <> 'invoice' or v_preceding is null or v_credited.header_id is distinct from v_preceding then
    raise exception 'A credit note line can only credit a line on the invoice the credit note applies to';
  end if;
  if new.returns_to_order then
    if v_credited.source_line_id is null then
      raise exception 'Return to order is only for a line whose invoice line came from an order';
    end if;
    if coalesce(new.quantity, 0) <= 0 then
      raise exception 'A line marked Return to order needs a quantity';
    end if;
  end if;

  select coalesce(sum(credit.quantity), 0) into v_already
  from public.transaction_lines as credit
  join public.transaction_headers as header on header.id = credit.header_id
  where credit.credited_line_id = new.credited_line_id
    and credit.id is distinct from new.id
    and header.status in ('draft', 'posted');
  if v_already + coalesce(new.quantity, 0) > v_credited.quantity then
    raise exception 'This would credit more than was invoiced on line %. Invoiced %, already credited %, so % is left.',
      v_credited.line_number,
      private.plain_quantity(v_credited.quantity),
      private.plain_quantity(v_already),
      private.plain_quantity(greatest(v_credited.quantity - v_already, 0));
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_credited_line() from public, anon, authenticated;

create trigger transaction_lines_credited
  before insert or update on public.transaction_lines
  for each row execute function private.enforce_credited_line();

-- 5. save_document stores the two new line fields. Everything else is as before.
create or replace function public.save_document(p_document jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_direction text;
  v_header_id uuid;
  v_header_org uuid;
  v_party_name text;
  v_party_currency uuid;
  v_currency uuid;
  v_line jsonb;
  v_line_number integer := 0;
  v_status public.document_status;
  v_product_id uuid;
  v_purchase_price numeric;
  v_sales_price numeric;
  v_purchase_gl uuid;
  v_sales_gl uuid;
  v_purchase_vat uuid;
  v_sales_vat uuid;
  v_unit text;
  v_price numeric;
  v_gl uuid;
  v_vat uuid;
  v_line_unit text;
begin
  select organisation_id, tenant_id, type
    into v_org, v_tenant, v_direction
  from public.transaction_types
  where id = nullif(p_document->>'transactionTypeId', '')::uuid;
  if v_org is null or v_direction not in ('Sales', 'Purchases') then
    raise exception 'Choose a transaction type';
  end if;
  if v_direction = 'Sales' and nullif(p_document->>'supplierId', '') is not null then
    raise exception 'A sales document cannot have a supplier';
  end if;
  if v_direction = 'Purchases' and nullif(p_document->>'customerId', '') is not null then
    raise exception 'A purchase document cannot have a customer';
  end if;
  if v_direction = 'Sales' then
    select name, currency_id into v_party_name, v_party_currency
    from public.customers
    where id = nullif(p_document->>'customerId', '')::uuid
      and organisation_id = v_org;
    if v_party_name is null then
      raise exception 'Choose a customer';
    end if;
  else
    select name, currency_id into v_party_name, v_party_currency
    from public.suppliers
    where id = nullif(p_document->>'supplierId', '')::uuid
      and organisation_id = v_org;
    if v_party_name is null then
      raise exception 'Choose a supplier';
    end if;
  end if;
  if nullif(btrim(p_document->>'partyName'), '') is not null then
    v_party_name := btrim(p_document->>'partyName');
  elsif nullif(btrim(p_document->>'supplierName'), '') is not null then
    v_party_name := btrim(p_document->>'supplierName');
  end if;
  if coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0)
       is distinct from round(coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0), 2) then
    raise exception 'Amounts can have at most 2 decimal places.';
  end if;
  v_currency := nullif(p_document->>'currencyId', '')::uuid;
  if v_currency is null then
    v_currency := v_party_currency;
  end if;
  v_header_id := nullif(p_document->>'id', '')::uuid;
  if v_header_id is null then
    insert into public.transaction_headers (
      tenant_id, organisation_id, transaction_type_id, reference,
      transaction_date, due_date, supplier_id, customer_id, party_name, contact_details, notes,
      currency_id, exchange_rate, order_number, sales_order_reference, paid_amount, rounding_amount,
      supplier_reference, supply_date,
      preceding_header_id, preceding_reference, preceding_date,
      buyer_reference, contract_reference, payment_terms,
      invoice_period_start, invoice_period_end, payment_means_code,
      flex1, flex2, flex3, flex4, flex5
    ) values (
      v_tenant, v_org, (p_document->>'transactionTypeId')::uuid, 0,
      (p_document->>'transactionDate')::date,
      nullif(p_document->>'dueDate', '')::date,
      nullif(p_document->>'supplierId', '')::uuid,
      nullif(p_document->>'customerId', '')::uuid,
      v_party_name, p_document->>'contactDetails', p_document->>'notes', v_currency,
      (p_document->>'exchangeRate')::numeric, p_document->>'orderNumber', nullif(btrim(p_document->>'salesOrderReference'), ''),
      coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
      p_document->>'supplierReference', nullif(p_document->>'supplyDate', '')::date,
      nullif(p_document->>'precedingHeaderId', '')::uuid,
      nullif(p_document->>'precedingReference', ''),
      nullif(p_document->>'precedingDate', '')::date,
      nullif(p_document->>'buyerReference', ''),
      nullif(p_document->>'contractReference', ''),
      nullif(p_document->>'paymentTerms', ''),
      nullif(p_document->>'invoicePeriodStart', '')::date,
      nullif(p_document->>'invoicePeriodEnd', '')::date,
      nullif(p_document->>'paymentMeansCode', ''),
      p_document->>'flex1', p_document->>'flex2', p_document->>'flex3', p_document->>'flex4', p_document->>'flex5'
    ) returning id into v_header_id;
  else
    select organisation_id, status into v_header_org, v_status
    from public.transaction_headers where id = v_header_id;
    if v_header_org is null then raise exception 'That invoice could not be updated'; end if;
    if v_status::text not in ('draft', 'open') then raise exception 'Only a draft document or an active order can be changed'; end if;
    if v_header_org is distinct from v_org then raise exception 'That invoice belongs to another organisation'; end if;
    if not exists (select 1 from public.organisation_access where organisation_id = v_header_org and user_id = (select auth.uid())) then
      raise exception 'You are not a member of this organisation';
    end if;
    update public.transaction_headers set
      transaction_date = (p_document->>'transactionDate')::date,
      due_date = nullif(p_document->>'dueDate', '')::date,
      supplier_id = nullif(p_document->>'supplierId', '')::uuid,
      customer_id = nullif(p_document->>'customerId', '')::uuid,
      party_name = v_party_name,
      contact_details = p_document->>'contactDetails',
      notes = p_document->>'notes',
      currency_id = v_currency,
      exchange_rate = (p_document->>'exchangeRate')::numeric,
      order_number = p_document->>'orderNumber',
      sales_order_reference = nullif(btrim(p_document->>'salesOrderReference'), ''),
      paid_amount = coalesce(nullif(p_document->>'paidAmount', '')::numeric, 0),
      rounding_amount = coalesce(nullif(p_document->>'roundingAmount', '')::numeric, 0),
      supplier_reference = p_document->>'supplierReference',
      supply_date = nullif(p_document->>'supplyDate', '')::date,
      preceding_header_id = nullif(p_document->>'precedingHeaderId', '')::uuid,
      preceding_reference = nullif(p_document->>'precedingReference', ''),
      preceding_date = nullif(p_document->>'precedingDate', '')::date,
      buyer_reference = nullif(p_document->>'buyerReference', ''),
      contract_reference = nullif(p_document->>'contractReference', ''),
      payment_terms = nullif(p_document->>'paymentTerms', ''),
      invoice_period_start = nullif(p_document->>'invoicePeriodStart', '')::date,
      invoice_period_end = nullif(p_document->>'invoicePeriodEnd', '')::date,
      payment_means_code = nullif(p_document->>'paymentMeansCode', ''),
      flex1 = p_document->>'flex1', flex2 = p_document->>'flex2', flex3 = p_document->>'flex3',
      flex4 = p_document->>'flex4', flex5 = p_document->>'flex5'
    where id = v_header_id and organisation_id = v_org;
    if not found then raise exception 'That invoice could not be updated'; end if;
    delete from public.transaction_lines where header_id = v_header_id;
  end if;
  for v_line in select value from jsonb_array_elements(coalesce(p_document->'lines', '[]'::jsonb))
  loop
    v_line_number := v_line_number + 1;
    if coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0)
         is distinct from round(coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0), 2) then
      raise exception 'Amounts can have at most 2 decimal places.';
    end if;
    v_product_id := nullif(v_line->>'productId', '')::uuid;
    v_price := nullif(v_line->>'price', '')::numeric;
    v_gl := nullif(v_line->>'glCodeId', '')::uuid;
    v_vat := nullif(v_line->>'vatRateId', '')::uuid;
    v_line_unit := nullif(v_line->>'unitCode', '');
    if v_product_id is not null then
      select purchase_price, sales_price, purchase_gl_code_id, sales_gl_code_id,
             purchase_vat_code_id, sales_vat_code_id, unit_code
        into v_purchase_price, v_sales_price, v_purchase_gl, v_sales_gl,
             v_purchase_vat, v_sales_vat, v_unit
      from public.products where id = v_product_id and organisation_id = v_org;
      if not found then raise exception 'Choose a product from this organisation'; end if;
      if v_direction = 'Sales' then
        if v_price is null then v_price := v_sales_price; end if;
        if v_gl is null then v_gl := v_sales_gl; end if;
        if v_vat is null then v_vat := v_sales_vat; end if;
      else
        if v_price is null then v_price := v_purchase_price; end if;
        if v_gl is null then v_gl := v_purchase_gl; end if;
        if v_vat is null then v_vat := v_purchase_vat; end if;
      end if;
      if v_line_unit is null then v_line_unit := v_unit; end if;
    end if;
    insert into public.transaction_lines (
      id, source_line_id, tenant_id, organisation_id, header_id, transaction_type_id, line_number,
      product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
      quantity, price, discount_amount, nett_amount, vat_amount,
      unit_code, line_note, seller_item_id, order_line_reference,
      credited_line_id, returns_to_order
    ) values (
      coalesce(nullif(v_line->>'id', '')::uuid, gen_random_uuid()), nullif(v_line->>'sourceLineId', '')::uuid,
      v_tenant, v_org, v_header_id, (p_document->>'transactionTypeId')::uuid, v_line_number,
      v_product_id, coalesce(v_line->>'description', ''), v_gl,
      nullif(v_line->>'departmentId', '')::uuid, nullif(v_line->>'costCentreId', '')::uuid, v_vat,
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0), coalesce(v_price, 0),
      coalesce(nullif(v_line->>'discountAmount', '')::numeric, 0), 0, 0,
      v_line_unit, nullif(v_line->>'lineNote', ''), nullif(v_line->>'sellerItemId', ''),
      nullif(btrim(v_line->>'orderLineReference'), ''),
      nullif(v_line->>'creditedLineId', '')::uuid, coalesce(nullif(v_line->>'returnsToOrder', '')::boolean, false)
    );
  end loop;
  -- A line that another document draws on cannot be removed.
  set constraints public.transaction_lines_source_line_id_fkey immediate;
  set constraints public.transaction_lines_source_line_id_fkey deferred;
  return v_header_id;
end;
$$;

-- 6. The over-invoicing check, and the check that an order line cannot drop below what is used, use the new calculation.
create or replace function private.enforce_source_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_direction text;
  v_party uuid;
  v_organisation uuid;
  v_used numeric;
  v_source record;
begin
  -- This line as a source: an order line cannot drop below what is already invoiced from it.
  if exists (select 1 from public.transaction_lines as drawn where drawn.source_line_id = new.id) then
    select kind.document_kind::text into v_kind
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    where header.id = new.header_id;
    if v_kind = 'order' then
      v_used := private.order_line_used(new.id, null);
      if v_used > new.quantity then
        raise exception 'Line % already has % invoiced. Its quantity cannot be less than that.',
          new.line_number, private.plain_quantity(v_used);
      end if;
    end if;
  end if;

  -- This line as a target.
  if new.source_line_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.source_line_id is not distinct from old.source_line_id
     and new.quantity is not distinct from old.quantity then
    return new;
  end if;
  if new.source_line_id = new.id then
    raise exception 'A line cannot come from itself';
  end if;

  select header.organisation_id, kind.document_kind::text, kind.type, coalesce(header.supplier_id, header.customer_id)
    into v_organisation, v_kind, v_direction, v_party
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = new.header_id;

  -- The source line is locked so two invoices cannot both take the last of it.
  perform 1 from public.transaction_lines where id = new.source_line_id for update;
  select line.quantity, line.organisation_id, header.status::text as status, kind.document_kind::text as kind,
         kind.type as direction, coalesce(header.supplier_id, header.customer_id) as party, header.document_number
    into v_source
  from public.transaction_lines as line
  join public.transaction_headers as header on header.id = line.header_id
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where line.id = new.source_line_id;

  if v_source.quantity is null or v_source.organisation_id is distinct from v_organisation then
    raise exception 'The order line this came from was not found';
  end if;
  if not ((v_source.kind = 'order' and v_kind = 'invoice') or (v_source.kind = 'requisition' and v_kind = 'order')) then
    raise exception 'An invoice line comes from an order, and an order line comes from a requisition';
  end if;
  if v_source.direction is distinct from v_direction then
    raise exception 'The two documents must both be purchases or both be sales';
  end if;
  if v_source.status not in ('open', 'closed') then
    raise exception 'The order must be active before it is invoiced';
  end if;

  if v_source.kind = 'order' then
    if v_source.party is distinct from v_party then
      raise exception 'The invoice must be for the same supplier or customer as the order';
    end if;
    v_used := private.order_line_used(new.source_line_id, new.id);
    if v_used + new.quantity > v_source.quantity then
      raise exception 'This would invoice more than was ordered on %. Ordered %, already invoiced %, so % is left.',
        coalesce(v_source.document_number, 'the order'),
        private.plain_quantity(v_source.quantity),
        private.plain_quantity(v_used),
        private.plain_quantity(greatest(v_source.quantity - v_used, 0));
    end if;
  end if;

  return new;
end;
$$;

-- 7. Create invoice starts with what is left by the new calculation.
create or replace function public.create_from_order(p_header_id uuid, p_type_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source record;
  v_target_kind text;
  v_target_direction text;
  v_target_org uuid;
  v_lines jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Sign in before creating a document'; end if;
  select header.*, kind.document_kind::text as kind, kind.type as direction
    into v_source
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = p_header_id
  for update of header;
  if v_source.id is null then raise exception 'That order was not found'; end if;
  if not (select private.is_org_member(v_source.organisation_id)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_source.kind not in ('order', 'requisition') then
    raise exception 'Only an order or a requisition can be turned into another document';
  end if;
  if v_source.status::text <> 'open' then
    raise exception 'Activate it first. Only an active order or requisition can be turned into another document.';
  end if;

  select document_kind::text, type, organisation_id into v_target_kind, v_target_direction, v_target_org
  from public.transaction_types where id = p_type_id;
  if v_target_org is distinct from v_source.organisation_id
     or v_target_direction is distinct from v_source.direction
     or not ((v_source.kind = 'order' and v_target_kind = 'invoice') or (v_source.kind = 'requisition' and v_target_kind = 'order')) then
    raise exception 'Choose an invoice type for an order, or an order type for a requisition';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'sourceLineId', line.id,
      'productId', line.product_id,
      'description', line.description,
      'glCodeId', line.gl_code_id,
      'departmentId', line.department_id,
      'costCentreId', line.cost_centre_id,
      'vatRateId', line.vat_rate_id,
      'quantity', remaining.quantity,
      'price', line.price,
      'discountAmount', case when line.quantity = 0 then 0 else round(line.discount_amount * remaining.quantity / line.quantity, 2) end,
      'unitCode', line.unit_code,
      'lineNote', line.line_note,
      'sellerItemId', line.seller_item_id,
      'orderLineReference', line.order_line_reference
    )
    order by line.line_number
  ) into v_lines
  from public.transaction_lines as line
  cross join lateral (
    select case
      when v_source.kind = 'order' then line.quantity - private.order_line_used(line.id, null)
      else line.quantity
    end as quantity
  ) as remaining
  where line.header_id = p_header_id and remaining.quantity > 0;

  if v_lines is null then
    raise exception 'Everything on this order has already been invoiced';
  end if;

  return public.save_document(jsonb_build_object(
    'transactionTypeId', p_type_id,
    'transactionDate', current_date,
    'supplierId', v_source.supplier_id,
    'customerId', v_source.customer_id,
    'partyName', v_source.party_name,
    'contactDetails', v_source.contact_details,
    'currencyId', v_source.currency_id,
    'exchangeRate', v_source.exchange_rate,
    'orderNumber', case when v_source.kind = 'order' and v_source.direction = 'Purchases' then v_source.document_number else v_source.order_number end,
    'salesOrderReference', case when v_source.kind = 'order' and v_source.direction = 'Sales' then v_source.document_number end,
    'buyerReference', v_source.buyer_reference,
    'contractReference', v_source.contract_reference,
    'paymentTerms', v_source.payment_terms,
    'lines', v_lines
  ));
end;
$$;

-- 8. Closing or reopening by hand is never a system close.
create or replace function public.set_order_status(p_header_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_type uuid;
  v_reference integer;
  v_kind text;
  v_numbering public.numbering_rule;
  v_lines integer;
  v_next public.document_status;
begin
  if (select auth.uid()) is null then raise exception 'Sign in before changing an order'; end if;
  select organisation_id, status::text, transaction_type_id, reference
    into v_org, v_status, v_type, v_reference
  from public.transaction_headers where id = p_header_id for update;
  if v_org is null then raise exception 'That order was not found'; end if;
  if not (select private.is_org_member(v_org)) then raise exception 'You are not a member of this organisation'; end if;
  select document_kind::text, numbering into v_kind, v_numbering from public.transaction_types where id = v_type;
  if v_kind is null or v_kind not in ('order', 'requisition') then
    raise exception 'Only an order or a requisition can be activated and closed';
  end if;

  if p_action = 'open' then
    if v_status <> 'draft' then raise exception 'Only a draft order can be activated'; end if;
    select count(*) into v_lines from public.transaction_lines where header_id = p_header_id;
    if v_lines < 1 then raise exception 'Add a line before activating'; end if;
    if v_numbering = 'on_post' and v_reference is null then v_reference := private.issue_reference(v_type); end if;
    v_next := 'open';
  elsif p_action = 'close' then
    if v_status <> 'open' then raise exception 'Only an active order can be closed'; end if;
    v_next := 'closed';
  elsif p_action = 'reopen' then
    if v_status <> 'closed' then raise exception 'Only a closed order can be reopened'; end if;
    v_next := 'open';
  elsif p_action = 'cancel' then
    if v_status <> 'open' then raise exception 'Only an active order can be cancelled'; end if;
    if exists (
      select 1
      from public.transaction_lines as line
      join public.transaction_lines as drawn on drawn.source_line_id = line.id
      join public.transaction_headers as header on header.id = drawn.header_id
      where line.header_id = p_header_id and header.status <> 'void'
    ) then
      raise exception 'Another document has been created from this one, so it cannot be cancelled. Close it instead.';
    end if;
    v_next := 'cancelled';
  else
    raise exception 'That order action is not recognised';
  end if;

  perform set_config('fintran.status_change', 'on', true);
  -- A change made by a person is never a system close, so a later void leaves a hand-closed order closed.
  update public.transaction_headers set status = v_next, reference = v_reference, closed_by_system = false where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

-- 9. The audit log carries the reason for a change the system made by itself.
create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_diff_old jsonb := '{}'::jsonb;
  v_diff_new jsonb := '{}'::jsonb;
  v_key text;
  v_ignore text[] := array['created_at', 'created_by', 'updated_at', 'updated_by'];
  v_row_id text;
  v_tenant uuid;
  v_organisation uuid;
  v_reason text := nullif(current_setting('fintran.audit_reason', true), '');
begin
  if tg_op is null then
    raise exception 'The audit log is written by a trigger';
  end if;

  if tg_table_name = 'transaction_headers' then
    v_ignore := v_ignore || array[
      'foreign_nett_amount',
      'foreign_vat_amount',
      'foreign_total_amount',
      'home_nett_amount',
      'home_vat_amount',
      'home_total_amount'
    ];
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  v_row_id := coalesce(v_row ->> 'id', v_row ->> 'organisation_id');
  v_tenant := (v_row ->> 'tenant_id')::uuid;
  v_organisation := nullif(v_row ->> 'organisation_id', '')::uuid;

  if tg_op = 'INSERT' then
    insert into public.audit_log (
      tenant_id, organisation_id, table_name, row_id, action, changed_by, new_values
    )
    values (
      v_tenant, v_organisation, tg_table_name, v_row_id, 'INSERT', auth.uid(), to_jsonb(new) - v_ignore
    );
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (
      tenant_id, organisation_id, table_name, row_id, action, changed_by, old_values
    )
    values (
      v_tenant, v_organisation, tg_table_name, v_row_id, 'DELETE', auth.uid(), to_jsonb(old) - v_ignore
    );
  else
    v_old := to_jsonb(old) - v_ignore;
    v_new := to_jsonb(new) - v_ignore;
    for v_key in
      select key
      from (
        select jsonb_object_keys(v_old) as key
        union
        select jsonb_object_keys(v_new)
      ) keys
    loop
      if v_old -> v_key is distinct from v_new -> v_key then
        v_diff_old := v_diff_old || jsonb_build_object(v_key, v_old -> v_key);
        v_diff_new := v_diff_new || jsonb_build_object(v_key, v_new -> v_key);
      end if;
    end loop;

    if v_diff_old = '{}'::jsonb then
      return null;
    end if;

    -- A change the system made by itself says why, in the change details.
    if v_reason is not null and tg_table_name = 'transaction_headers' then
      v_diff_new := v_diff_new || jsonb_build_object('reason', v_reason);
    end if;

    insert into public.audit_log (
      tenant_id, organisation_id, table_name, row_id, action, changed_by, old_values, new_values
    )
    values (
      v_tenant, v_organisation, tg_table_name, v_row_id, 'UPDATE', auth.uid(), v_diff_old, v_diff_new
    );
  end if;

  return null;
end;
$$;

-- 10. Close and reopen. An order closes when Invoiced covers every line, and an order the system closed reopens when
-- that stops being true. Both are written to the audit log with the reason.
create or replace function private.sync_order_closure(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_by_system boolean;
  v_covered boolean;
  v_flag text;
begin
  select header.status::text, header.closed_by_system into v_status, v_by_system
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = p_order_id and kind.document_kind = 'order'
  for update of header;
  if v_status is null or v_status not in ('open', 'closed') then
    return;
  end if;

  -- Covered means posted invoices, less returning credit notes, cover every line that has a quantity.
  select not exists (
    select 1 from public.order_line_usage as usage
    where usage.header_id = p_order_id and usage.quantity > 0 and usage.invoiced < usage.quantity
  ) and exists (
    select 1 from public.transaction_lines as line where line.header_id = p_order_id and line.quantity > 0
  ) into v_covered;

  if v_status = 'open' and v_covered then
    null;
  elsif v_status = 'closed' and v_by_system and not v_covered then
    null;
  else
    return;
  end if;

  v_flag := current_setting('fintran.status_change', true);
  perform set_config('fintran.status_change', 'on', true);
  perform set_config('fintran.audit_reason', p_reason, true);
  if v_status = 'open' then
    update public.transaction_headers set status = 'closed', closed_by_system = true where id = p_order_id;
  else
    update public.transaction_headers set status = 'open', closed_by_system = false where id = p_order_id;
  end if;
  perform set_config('fintran.audit_reason', '', true);
  perform set_config('fintran.status_change', coalesce(nullif(v_flag, ''), 'off'), true);
end;
$$;

revoke all on function private.sync_order_closure(uuid, text) from public, anon, authenticated;

-- Runs when an invoice or a credit note is posted or voided.
create or replace function private.sync_orders_after_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_number text := coalesce(nullif(new.document_number, ''), 'a document');
  v_order record;
  v_over record;
  v_reason text;
begin
  select document_kind::text into v_kind from public.transaction_types where id = new.transaction_type_id;

  if v_kind = 'invoice' then
    v_reason := case when new.status = 'posted'
      then format('Posted invoices cover every line, after %s was posted.', v_number)
      else format('%s was voided, which left quantity to invoice.', v_number) end;
    for v_order in
      select distinct source.header_id
      from public.transaction_lines as line
      join public.transaction_lines as source on source.id = line.source_line_id
      where line.header_id = new.id
    loop
      perform private.sync_order_closure(v_order.header_id, v_reason);
    end loop;

  elsif v_kind = 'credit_note' then
    if new.status = 'void' then
      -- Voiding a credit note that returned quantity takes that quantity back. Refuse if it has since been invoiced.
      for v_over in
        select source.id, source.line_number, source.quantity, order_header.document_number
        from public.transaction_lines as credit
        join public.transaction_lines as credited on credited.id = credit.credited_line_id
        join public.transaction_lines as source on source.id = credited.source_line_id
        join public.transaction_headers as order_header on order_header.id = source.header_id
        where credit.header_id = new.id and credit.returns_to_order
        order by source.id
        for update of source
      loop
        if private.order_line_used(v_over.id, null) > v_over.quantity then
          raise exception 'This credit note gave quantity back to %, and that quantity has since been invoiced again. It cannot be voided.',
            coalesce(nullif(v_over.document_number, ''), 'an order');
        end if;
      end loop;
    end if;
    v_reason := case when new.status = 'posted'
      then format('Credit note %s returned quantity to the order.', v_number)
      else format('Credit note %s was voided, so posted invoices cover every line again.', v_number) end;
    for v_order in
      select distinct source.header_id
      from public.transaction_lines as credit
      join public.transaction_lines as credited on credited.id = credit.credited_line_id
      join public.transaction_lines as source on source.id = credited.source_line_id
      where credit.header_id = new.id and credit.returns_to_order
    loop
      perform private.sync_order_closure(v_order.header_id, v_reason);
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_orders_after_status() from public, anon, authenticated;

drop trigger zzzz_close_invoiced_orders on public.transaction_headers;
drop function private.close_invoiced_orders();

create trigger zzzz_sync_orders_after_status
  after update on public.transaction_headers
  for each row
  when (old.status is distinct from new.status and new.status in ('posted', 'void'))
  execute function private.sync_orders_after_status();
