-- Order lifecycle, part 3. A requisition becomes a purchase order, and an order becomes one or more invoices.
-- Each new line records the line it came from. An order line cannot be invoiced for more than its quantity.
-- Draft and posted invoices count. A void invoice gives its quantity back. A requisition does not limit its orders.

alter table public.transaction_lines add column source_line_id uuid;

comment on column public.transaction_lines.source_line_id is
  'The order line an invoice line came from, or the requisition line an order line came from.';

-- Saving a document replaces its lines and keeps their ids, so the link is checked at the end of the save.
alter table public.transaction_lines
  add constraint transaction_lines_source_line_id_fkey
  foreign key (source_line_id) references public.transaction_lines (id)
  deferrable initially deferred;

create index transaction_lines_source_line_idx
  on public.transaction_lines (source_line_id)
  where source_line_id is not null;

create or replace function private.plain_quantity(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(regexp_replace(p_value::text, '(\.\d*?)0+$', '\1'), '\.$', '');
$$;

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
      select coalesce(sum(drawn.quantity), 0) into v_used
      from public.transaction_lines as drawn
      join public.transaction_headers as header on header.id = drawn.header_id
      where drawn.source_line_id = new.id
        and header.status <> 'void';
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
    raise exception 'The order must be open before it is invoiced';
  end if;

  if v_source.kind = 'order' then
    if v_source.party is distinct from v_party then
      raise exception 'The invoice must be for the same supplier or customer as the order';
    end if;
    select coalesce(sum(drawn.quantity), 0) into v_used
    from public.transaction_lines as drawn
    join public.transaction_headers as header on header.id = drawn.header_id
    where drawn.source_line_id = new.source_line_id
      and drawn.id is distinct from new.id
      and header.status <> 'void';
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

create trigger transaction_lines_source
before insert or update on public.transaction_lines
for each row execute function private.enforce_source_line();

-- save_document keeps the id of a line it replaces, stores where the line came from, and checks the links before it returns.
do $$
declare
  v_definition text := pg_get_functiondef('public.save_document(jsonb)'::regprocedure);
  v_step text;
begin
  v_step := replace(
    v_definition,
    $old$      tenant_id, organisation_id, header_id, transaction_type_id, line_number,$old$,
    $new$      id, source_line_id, tenant_id, organisation_id, header_id, transaction_type_id, line_number,$new$
  );
  if v_step = v_definition then raise exception 'save_document does not have the expected line columns'; end if;
  v_definition := v_step;

  v_step := replace(
    v_definition,
    $old$      v_tenant, v_org, v_header_id, (p_document->>'transactionTypeId')::uuid, v_line_number,$old$,
    $new$      coalesce(nullif(v_line->>'id', '')::uuid, gen_random_uuid()), nullif(v_line->>'sourceLineId', '')::uuid,
      v_tenant, v_org, v_header_id, (p_document->>'transactionTypeId')::uuid, v_line_number,$new$
  );
  if v_step = v_definition then raise exception 'save_document does not have the expected line values'; end if;
  v_definition := v_step;

  v_step := replace(
    v_definition,
    $old$  return v_header_id;$old$,
    $new$  -- A line that another document draws on cannot be removed.
  set constraints public.transaction_lines_source_line_id_fkey immediate;
  set constraints public.transaction_lines_source_line_id_fkey deferred;
  return v_header_id;$new$
  );
  if v_step = v_definition then raise exception 'save_document does not have the expected return'; end if;
  execute v_step;
end
$$;

-- Starts a draft from an open order or requisition, with what is left on each line.
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
    raise exception 'Open it first. Only an open order or requisition can be turned into another document.';
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
      'sellerItemId', line.seller_item_id
    )
    order by line.line_number
  ) into v_lines
  from public.transaction_lines as line
  cross join lateral (
    select case
      when v_source.kind = 'order' then line.quantity - coalesce((
        select sum(drawn.quantity)
        from public.transaction_lines as drawn
        join public.transaction_headers as header on header.id = drawn.header_id
        where drawn.source_line_id = line.id and header.status <> 'void'
      ), 0)
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
    'orderNumber', case when v_source.kind = 'order' then v_source.document_number else v_source.order_number end,
    'buyerReference', v_source.buyer_reference,
    'contractReference', v_source.contract_reference,
    'paymentTerms', v_source.payment_terms,
    'lines', v_lines
  ));
end;
$$;

revoke all on function public.create_from_order(uuid, uuid) from public, anon;
grant execute on function public.create_from_order(uuid, uuid) to authenticated;

-- An order with invoices against it is closed, not cancelled.
do $$
declare
  v_definition text := pg_get_functiondef('public.set_order_status(uuid, text)'::regprocedure);
  v_changed text;
begin
  v_changed := replace(
    v_definition,
    $old$    v_next := 'cancelled';$old$,
    $new$    if exists (
      select 1
      from public.transaction_lines as line
      join public.transaction_lines as drawn on drawn.source_line_id = line.id
      join public.transaction_headers as header on header.id = drawn.header_id
      where line.header_id = p_header_id and header.status <> 'void'
    ) then
      raise exception 'Another document has been created from this one, so it cannot be cancelled. Close it instead.';
    end if;
    v_next := 'cancelled';$new$
  );
  if v_changed = v_definition then raise exception 'set_order_status does not have the expected cancel step'; end if;
  execute v_changed;
end
$$;
