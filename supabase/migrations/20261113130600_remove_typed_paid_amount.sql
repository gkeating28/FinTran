-- Payments release B, phase 5: the typed paid amount goes (QULAPLUS_PAYMENTS_SPEC.md, decision K8 and phase 5).
--
-- Every posted document with a typed paid amount gets a migrated payment and an allocation, so its paid amount and
-- amount due come out as they were. Drafts cannot hold a payment, so their typed amount is cleared. Void documents are
-- left as they are. Everything the migration decides is written to its output as a notice, one line per document.
-- After this, save_document refuses a paid amount and nothing but settlement writes one.
--
-- The data part is one block, so it is one transaction however the file is run. It does nothing on a second run: a
-- document with an allocation is already settled.

do $migration$
declare
  v_row record;
  v_kind text;
  v_code text;
  v_type uuid;
  v_type_kind text;
  v_type_direction text;
  v_payment uuid;
  v_reference integer;
  v_cap numeric;
  v_amount numeric;
  v_converted integer := 0;
  v_before jsonb;
begin
  perform set_config('fintran.migration', 'on', true);

  -- What every posted document shows now, to compare with what it shows afterwards.
  select coalesce(jsonb_object_agg(id::text, jsonb_build_object('paid', paid_amount, 'due', amount_due, 'atPosting', paid_at_posting)), '{}'::jsonb)
    into v_before
  from public.transaction_headers
  where status = 'posted';

  for v_row in
    select header.id, coalesce(header.document_number, header.reference::text, header.id::text) as label,
           header.paid_amount, organisation.name as organisation
    from public.transaction_headers as header
    join public.organisations as organisation on organisation.id = header.organisation_id
    where header.status = 'void' and header.paid_amount > 0
    order by organisation.name, header.id
  loop
    raise notice 'Void document % in % has a typed paid amount of %. Left unchanged: no migrated payment.', v_row.label, v_row.organisation, v_row.paid_amount;
  end loop;

  -- Drafts cannot hold a payment. The typed figure is cleared and listed.
  for v_row in
    select header.id, coalesce(header.document_number, header.reference::text, header.id::text) as label,
           header.paid_amount, organisation.name as organisation
    from public.transaction_headers as header
    join public.organisations as organisation on organisation.id = header.organisation_id
    where header.status = 'draft' and header.paid_amount > 0
    order by organisation.name, header.id
  loop
    raise notice 'Draft % in % had a typed paid amount of %. Set to 0.', v_row.label, v_row.organisation, v_row.paid_amount;
  end loop;
  alter table public.transaction_headers disable trigger user;
  update public.transaction_headers
  set paid_amount = 0, amount_due = round(foreign_total_amount + rounding_amount, 2)
  where status = 'draft' and paid_amount > 0;
  alter table public.transaction_headers enable trigger user;

  -- Posted documents become a migrated payment and one allocation each.
  for v_row in
    select header.*, kind.document_kind::text as kind, kind.type as direction,
           coalesce(header.document_number, header.reference::text, header.id::text) as label,
           organisation.name as organisation
    from public.transaction_headers as header
    join public.transaction_types as kind on kind.id = header.transaction_type_id
    join public.organisations as organisation on organisation.id = header.organisation_id
    where header.status = 'posted' and header.paid_amount > 0 and kind.document_kind::text in ('invoice', 'credit_note')
      -- A typed figure has no allocation. One with an allocation is already settled, so a second run does nothing.
      and not exists (
        select 1 from public.allocations as allocation
        where allocation.target_header_id = header.id or allocation.source_header_id = header.id
      )
    order by header.organisation_id, header.transaction_date, header.id
  loop
    -- A payment is the money going the other way to what the document is: a customer receipt pays a sales invoice,
    -- a supplier payment pays a purchase invoice, a customer refund settles a sales credit note, a supplier refund
    -- settles a purchase credit note.
    if v_row.kind = 'invoice' and v_row.direction = 'Sales' then v_kind := 'receipt'; v_code := 'MIGREC';
    elsif v_row.kind = 'invoice' then v_kind := 'payment'; v_code := 'MIGPAY';
    elsif v_row.direction = 'Sales' then v_kind := 'payment'; v_code := 'MIGCREF';
    else v_kind := 'receipt'; v_code := 'MIGSREF';
    end if;

    select id, document_kind::text, type into v_type, v_type_kind, v_type_direction
    from public.transaction_types where organisation_id = v_row.organisation_id and code = v_code;
    if v_type is null then
      insert into public.transaction_types (
        tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering,
        reference_prefix, reference_padding, is_system
      ) values (
        v_row.tenant_id, v_row.organisation_id, v_code,
        case v_code when 'MIGREC' then 'Migrated customer receipt' when 'MIGPAY' then 'Migrated supplier payment'
          when 'MIGCREF' then 'Migrated customer refund' else 'Migrated supplier refund' end,
        0, v_row.direction, v_kind::public.document_kind, 'on_insert', 'MIG-', 4, true
      ) returning id into v_type;
    elsif v_type_kind is distinct from v_kind or v_type_direction is distinct from v_row.direction then
      raise exception 'The transaction type code % is already used in % for something else. Rename it, then run this migration again.', v_code, v_row.organisation;
    end if;

    v_reference := private.issue_reference(v_type);
    insert into public.payments (
      tenant_id, organisation_id, transaction_type_id, reference, status, source, payment_date,
      customer_id, supplier_id, party_name, currency_id, exchange_rate, amount, notes, posted_at
    ) values (
      v_row.tenant_id, v_row.organisation_id, v_type, v_reference, 'posted', 'migrated', v_row.transaction_date,
      v_row.customer_id, v_row.supplier_id, v_row.party_name, v_row.currency_id, v_row.exchange_rate, v_row.paid_amount,
      'Migrated from the typed paid amount', now()
    ) returning id into v_payment;

    v_cap := v_row.foreign_total_amount + v_row.rounding_amount;
    v_amount := least(v_row.paid_amount, v_cap);
    if v_amount > 0 then
      insert into public.allocations (tenant_id, organisation_id, source_payment_id, target_header_id, amount, allocation_date)
      values (v_row.tenant_id, v_row.organisation_id, v_payment, v_row.id, v_amount, v_row.transaction_date);
    end if;
    if v_amount < v_row.paid_amount then
      raise notice 'Overpaid: % in % was typed as paid % against a total of %. % was allocated and % is left on the migrated payment. Its amount due is now 0 instead of %.',
        v_row.label, v_row.organisation, v_row.paid_amount, v_cap, v_amount, v_row.paid_amount - v_amount, v_row.amount_due;
    end if;
    if exists (
      select 1 from public.e_documents as e
      where e.header_id = v_row.id and e.direction = 'inbound'
        and nullif(e.semantic #>> '{BG-22,BT-113}', '')::numeric = v_row.paid_amount
    ) then
      raise notice 'Check: % in % came from a received e-invoice whose BT-113 equals the amount migrated as paid. The figure may come from the supplier''s file and not from a payment.', v_row.label, v_row.organisation;
    end if;
    v_converted := v_converted + 1;
  end loop;
  raise notice 'Migrated % posted documents to migrated payments.', v_converted;

  -- Every posted document must show what it showed before, except an overpaid document, whose negative amount due is 0.
  for v_row in
    select header.id, header.paid_amount, header.amount_due, header.paid_at_posting,
           header.foreign_total_amount + header.rounding_amount as cap,
           (v_before -> header.id::text ->> 'paid')::numeric as old_paid,
           (v_before -> header.id::text ->> 'due')::numeric as old_due,
           (v_before -> header.id::text ->> 'atPosting')::numeric as old_at_posting
    from public.transaction_headers as header
    where header.id::text in (select jsonb_object_keys(v_before))
  loop
    if (v_row.paid_amount, v_row.amount_due) is distinct from (v_row.old_paid, v_row.old_due)
       or v_row.paid_at_posting is distinct from v_row.old_at_posting then
      if not (v_row.old_paid > v_row.cap and v_row.paid_amount = v_row.cap and v_row.amount_due = 0) then
        raise exception 'Migration check failed for document %: paid % and due % became paid % and due %.',
          v_row.id, v_row.old_paid, v_row.old_due, v_row.paid_amount, v_row.amount_due;
      end if;
    end if;
  end loop;

  perform set_config('fintran.migration', 'off', true);
end;
$migration$;

-- A draft cannot hold a paid amount.
alter table public.transaction_headers
  add constraint transaction_headers_draft_unpaid check (status <> 'draft' or paid_amount = 0);

-- save_document refuses a typed paid amount, and writes none.
CREATE OR REPLACE FUNCTION public.save_document(p_document jsonb) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
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
  if nullif(p_document->>'paidAmount', '') is not null then
    raise exception 'The paid amount is calculated from payments and cannot be typed.';
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
      currency_id, exchange_rate, order_number, sales_order_reference, rounding_amount,
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

-- Nobody types the paid amount on a posted document either: only settlement may write it.
CREATE OR REPLACE FUNCTION private.enforce_document_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_old jsonb;
  v_new jsonb;
  v_allowed text[] := array[
    'paid_amount',
    'amount_due',
    'home_amount_due',
    'created_at', 'created_by', 'updated_at', 'updated_by'
  ];
  v_kind text;
  v_order boolean;
begin
  select document_kind::text into v_kind
  from public.transaction_types
  where id = case when tg_op = 'DELETE' then old.transaction_type_id else new.transaction_type_id end;
  v_order := coalesce(v_kind in ('order', 'requisition'), false);

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      if v_order then
        raise exception 'Only a draft order can be deleted. Cancel it instead.';
      end if;
      raise exception 'Posted and void documents cannot be deleted';
    end if;
    if not v_order and private.document_period_locked(old.organisation_id, old.transaction_date) then
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
    if not v_order and private.document_period_locked(new.organisation_id, new.transaction_date) then
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
      if v_order then
        raise exception 'An order status is changed with Activate, Close, Reopen or Cancel';
      end if;
      raise exception 'Document status can only be changed by posting or voiding';
    end if;
    if v_order then
      if new.status in ('posted', 'void') then
        raise exception 'An order is activated and closed. It is not posted.';
      end if;
      if new.posted_at is not null or new.posted_by is not null
         or new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then
        raise exception 'That status change is not allowed';
      end if;
      if not (
        (old.status = 'draft' and new.status = 'open')
        or (old.status = 'open' and new.status in ('closed', 'cancelled'))
        or (old.status = 'closed' and new.status = 'open')
      ) then
        raise exception 'That status change is not allowed';
      end if;
    elsif not (
      (old.status = 'draft' and new.status = 'posted')
      or (old.status = 'posted' and new.status = 'void')
    ) then
      if new.status in ('open', 'closed', 'cancelled') then
        raise exception 'Only an order or a requisition can be activated and closed';
      end if;
      raise exception 'That status change is not allowed';
    end if;
  elsif old.status = 'posted' then
    -- What payment settles is written by the settlement function and nothing else. Nobody types it.
    if not coalesce(current_setting('fintran.settlement', true) = 'on', false) then
      v_allowed := array['created_at', 'created_by', 'updated_at', 'updated_by'];
    end if;
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      raise exception 'A posted document cannot be changed. Its paid amount is worked out from payments.';
    end if;
  elsif old.status = 'void' then
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      raise exception 'A void document cannot be changed';
    end if;
  elsif old.status in ('closed', 'cancelled') then
    v_old := to_jsonb(old) - v_allowed;
    v_new := to_jsonb(new) - v_allowed;
    if v_old is distinct from v_new then
      if old.status = 'closed' then
        raise exception 'A closed order cannot be changed. Reopen it first.';
      end if;
      raise exception 'A cancelled order cannot be changed';
    end if;
  end if;

  -- A payment made after the lock date can settle a document dated before it. The allocation trigger applies the lock
  -- date to the allocation, so settlement does not need the document date checked again.
  if not v_order and not coalesce(current_setting('fintran.settlement', true) = 'on', false) and (
    private.document_period_locked(new.organisation_id, new.transaction_date)
    or private.document_period_locked(old.organisation_id, old.transaction_date)
  ) then
    raise exception 'This date is in a locked period';
  end if;

  return new;
end;
$$;
