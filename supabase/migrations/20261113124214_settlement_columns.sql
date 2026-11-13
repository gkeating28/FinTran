-- Payments release B, phase 3: what a document needs to know about payment (QULAPLUS_PAYMENTS_SPEC.md, 3.3 and 3.6).
--
-- Adds the calculated home amount due, the paid figure fixed at posting (for e-invoices) and the paid figure a
-- supplier stated on an imported e-invoice. Teaches the shared audit and status functions about settlement, so a
-- change that only follows from an allocation does not touch updated_at or fill the audit log. Makes every
-- e-invoice read the paid figure fixed at posting.

alter table public.transaction_headers
  add column home_amount_due numeric(18, 2) not null default 0,
  add column paid_at_posting numeric(18, 2),
  add column supplier_stated_paid_amount numeric(18, 2),
  add constraint transaction_headers_paid_at_posting_check check (paid_at_posting is null or paid_at_posting >= 0),
  add constraint transaction_headers_supplier_stated_paid_check check (supplier_stated_paid_amount is null or supplier_stated_paid_amount >= 0);

comment on column public.transaction_headers.home_amount_due is 'Home total less the home amount of every effective allocation to this document. Written by private.refresh_settlement.';
comment on column public.transaction_headers.paid_at_posting is 'The paid amount when the document was posted. Every e-invoice reads this, so a generated e-invoice never changes (EN 16931 BT-113 and BT-115).';
comment on column public.transaction_headers.supplier_stated_paid_amount is 'BT-113 on an imported e-invoice: what the supplier says is paid. Information only. It is never allocated or counted.';

-- Backfill, before anything else changes: the figures e-invoices have used so far become the figures fixed at posting.
-- The posted-document guard is switched off for this one statement block, since it only allows the paid amount to change.
alter table public.transaction_headers disable trigger user;
update public.transaction_headers set paid_at_posting = paid_amount where status in ('posted', 'void');
update public.transaction_headers set home_amount_due = home_total_amount;
update public.transaction_headers as header
set supplier_stated_paid_amount = nullif(e.semantic #>> '{BG-22,BT-113}', '')::numeric
from public.e_documents as e
where e.header_id = header.id
  and e.direction = 'inbound'
  and coalesce(nullif(e.semantic #>> '{BG-22,BT-113}', '')::numeric, 0) > 0;
alter table public.transaction_headers enable trigger user;

-- A draft owes its whole total. Posting fixes the figure, and settlement takes it from there.
create function private.set_home_amount_due() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if new.status = 'draft' or (tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'posted') then
    new.home_amount_due := new.home_total_amount;
  end if;
  return new;
end;
$$;

revoke all on function private.set_home_amount_due() from public, anon, authenticated, service_role;

create trigger transaction_headers_zh_home_due before insert or update on public.transaction_headers
  for each row execute function private.set_home_amount_due();

-- Settlement leaves the audit columns alone.
CREATE OR REPLACE FUNCTION private.set_audit_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if tg_op is null then
    raise exception 'Audit columns are set by a trigger';
  end if;

  -- A change that only follows from an allocation is not somebody editing the row.
  if tg_op = 'UPDATE' and coalesce(current_setting('fintran.settlement', true) = 'on', false) then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.updated_at := now();
    new.updated_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

-- ...and keeps header figures that only follow from allocations out of the audit log.
CREATE OR REPLACE FUNCTION private.write_audit_log() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

  -- What an allocation works out is recorded on the allocation, so the figures it moves are not logged again.
  if coalesce(current_setting('fintran.settlement', true) = 'on', false) then
    v_ignore := v_ignore || array[
      'paid_amount', 'amount_due', 'home_amount_due',
      'allocated_amount', 'unallocated_amount', 'home_unallocated_amount'
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

-- ...and may change the home amount due on a posted document.
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

  if not v_order and (
    private.document_period_locked(new.organisation_id, new.transaction_date)
    or private.document_period_locked(old.organisation_id, old.transaction_date)
  ) then
    raise exception 'This date is in a locked period';
  end if;

  return new;
end;
$$;

-- Every e-invoice reads the paid amount fixed at posting.
CREATE OR REPLACE FUNCTION public.en16931_source(p_header_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_header public.transaction_headers%rowtype;
  v_direction text;
  v_kind text;
  v_currency text;
  v_home text;
  v_seller jsonb;
  v_buyer jsonb;
  v_org jsonb;
  v_counterparty jsonb;
  v_lines jsonb;
  v_breakdown jsonb;
  v_line_nett numeric;
  v_breakdown_vat numeric;
begin
  select * into v_header
  from public.transaction_headers
  where id = p_header_id;

  if v_header.id is null then
    return null;
  end if;

  select type, document_kind::text into v_direction, v_kind
  from public.transaction_types
  where id = v_header.transaction_type_id;

  select iso_code into v_currency
  from public.currencies
  where id = v_header.currency_id
    and organisation_id = v_header.organisation_id;

  select currencies.iso_code into v_home
  from public.organisation_defaults as defaults
  join public.currencies as currencies
    on currencies.id = defaults.home_currency_id
   and currencies.organisation_id = defaults.organisation_id
  where defaults.organisation_id = v_header.organisation_id;

  select coalesce(sum(nett_amount), 0), coalesce(jsonb_agg(jsonb_build_object(
    'line', line_number,
    'note', line_note,
    'quantity', quantity,
    'unit', unit_code,
    'nett', nett_amount,
    'price', price,
    'discount', discount_amount,
    'category', vat_category,
    'rate', vat_percentage,
    'description', description,
    'sellerItem', seller_item_id,
    'orderLine', order_line_reference,
    'productCode', (select code from public.products where id = transaction_lines.product_id)
  ) order by line_number), '[]'::jsonb)
    into v_line_nett, v_lines
  from public.transaction_lines
  where header_id = v_header.id;

  select coalesce(sum(vat_amount), 0), coalesce(jsonb_agg(jsonb_build_object(
    'category', vat_category,
    'rate', vat_percentage,
    'taxable', taxable_amount,
    'vat', vat_amount,
    'exemptionCode', exemption_code,
    'exemptionReason', exemption_reason
  ) order by vat_category, vat_percentage), '[]'::jsonb)
    into v_breakdown_vat, v_breakdown
  from public.transaction_vat_breakdown
  where header_id = v_header.id;

  if v_header.status in ('posted', 'void') then
    v_org := jsonb_strip_nulls(jsonb_build_object(
      'name', v_header.issuer_snapshot->>'name',
      'line1', v_header.issuer_snapshot->>'addressLine1',
      'line2', v_header.issuer_snapshot->>'addressLine2',
      'line3', v_header.issuer_snapshot->>'addressLine3',
      'city', v_header.issuer_snapshot->>'city',
      'postCode', v_header.issuer_snapshot->>'postCode',
      'county', v_header.issuer_snapshot->>'county',
      'country', v_header.issuer_snapshot->>'countryCode',
      'vat', v_header.issuer_snapshot->>'vatNumber',
      'company', v_header.issuer_snapshot->>'companyNumber',
      'peppolScheme', v_header.issuer_snapshot->>'peppolScheme',
      'peppolId', v_header.issuer_snapshot->>'peppolId',
      'phone', v_header.issuer_snapshot->>'phone',
      'email', v_header.issuer_snapshot->>'contactEmail',
      'contact', v_header.issuer_snapshot->>'contactName',
      'iban', v_header.issuer_snapshot->>'iban',
      'bic', v_header.issuer_snapshot->>'bic',
      'accountName', v_header.issuer_snapshot->>'bankAccountName'
    ));
    v_counterparty := jsonb_strip_nulls(jsonb_build_object(
      'name', v_header.party_snapshot->>'name',
      'code', v_header.party_snapshot->>'code',
      'line1', v_header.party_snapshot->>'addressLine1',
      'line2', v_header.party_snapshot->>'addressLine2',
      'line3', v_header.party_snapshot->>'addressLine3',
      'city', v_header.party_snapshot->>'city',
      'postCode', v_header.party_snapshot->>'postCode',
      'county', v_header.party_snapshot->>'county',
      'country', v_header.party_snapshot->>'countryCode',
      'vat', v_header.party_snapshot->>'vatNumber',
      'company', v_header.party_snapshot->>'companyNumber',
      'peppolScheme', v_header.party_snapshot->>'peppolScheme',
      'peppolId', v_header.party_snapshot->>'peppolId',
      'phone', v_header.party_snapshot->>'phone',
      'email', v_header.party_snapshot->>'email',
      'contact', v_header.party_snapshot->>'contactDetails'
    ));
  else
    select jsonb_strip_nulls(jsonb_build_object(
      'name', organisation.name,
      'line1', defaults.address_line1,
      'line2', defaults.address_line2,
      'line3', defaults.address_line3,
      'city', defaults.city,
      'postCode', defaults.post_code,
      'county', defaults.county,
      'country', defaults.country_code,
      'vat', defaults.vat_number,
      'company', defaults.company_number,
      'peppolScheme', defaults.peppol_scheme,
      'peppolId', defaults.peppol_id,
      'phone', defaults.phone,
      'email', defaults.contact_email,
      'contact', defaults.contact_name,
      'iban', defaults.iban,
      'bic', defaults.bic,
      'accountName', defaults.bank_account_name,
      'needsReview', defaults.address_needs_review
    )) into v_org
    from public.organisations as organisation
    join public.organisation_defaults as defaults
      on defaults.organisation_id = organisation.id
    where organisation.id = v_header.organisation_id;

    if v_direction = 'Sales' then
      select jsonb_strip_nulls(jsonb_build_object(
        'name', customers.name,
        'code', customers.code,
        'line1', customers.address_line1,
        'line2', customers.address_line2,
        'line3', customers.address_line3,
        'city', customers.city,
        'postCode', customers.post_code,
        'county', customers.county,
        'country', customers.country_code,
        'vat', customers.vat_number,
        'company', customers.company_number,
        'peppolScheme', customers.peppol_scheme,
        'peppolId', customers.peppol_id,
        'phone', customers.phone,
        'email', customers.email,
        'contact', customers.contact_details,
        'needsReview', customers.address_needs_review
      )) into v_counterparty
      from public.customers
      where id = v_header.customer_id
        and organisation_id = v_header.organisation_id;
    else
      select jsonb_strip_nulls(jsonb_build_object(
        'name', suppliers.name,
        'code', suppliers.code,
        'line1', suppliers.address_line1,
        'line2', suppliers.address_line2,
        'line3', suppliers.address_line3,
        'city', suppliers.city,
        'postCode', suppliers.post_code,
        'county', suppliers.county,
        'country', suppliers.country_code,
        'vat', suppliers.vat_number,
        'company', suppliers.company_number,
        'peppolScheme', suppliers.peppol_scheme,
        'peppolId', suppliers.peppol_id,
        'phone', suppliers.phone,
        'email', suppliers.email,
        'contact', suppliers.contact_details,
        'needsReview', suppliers.address_needs_review
      )) into v_counterparty
      from public.suppliers
      where id = v_header.supplier_id
        and organisation_id = v_header.organisation_id;
    end if;
  end if;

  if v_direction = 'Sales' then
    v_seller := v_org;
    v_buyer := v_counterparty;
  else
    v_seller := v_counterparty;
    v_buyer := v_org;
  end if;

  return jsonb_build_object(
    'direction', v_direction,
    'kind', v_kind,
    'status', v_header.status,
    'invoiceNumber', case
      when v_direction = 'Sales' then nullif(btrim(v_header.document_number), '')
      else nullif(btrim(v_header.supplier_reference), '')
    end,
    'issueDate', v_header.transaction_date,
    'currency', v_currency,
    'homeCurrency', v_home,
    'dueDate', v_header.due_date,
    'buyerReference', nullif(btrim(v_header.buyer_reference), ''),
    'contractReference', nullif(btrim(v_header.contract_reference), ''),
    'orderNumber', nullif(btrim(v_header.order_number), ''),
    'salesOrderReference', nullif(btrim(v_header.sales_order_reference), ''),
    'paymentTerms', nullif(btrim(v_header.payment_terms), ''),
    'notes', nullif(btrim(v_header.notes), ''),
    'supplyDate', v_header.supply_date,
    'periodStart', v_header.invoice_period_start,
    'periodEnd', v_header.invoice_period_end,
    'precedingReference', nullif(btrim(v_header.preceding_reference), ''),
    'precedingDate', v_header.preceding_date,
    'paymentMeans', nullif(btrim(v_header.payment_means_code), ''),
    'nett', v_header.foreign_nett_amount,
    'vat', v_header.foreign_vat_amount,
    'total', v_header.foreign_total_amount,
    'homeVat', v_header.home_vat_amount,
    -- A posted or void document states what was paid when it was posted, so its e-invoice never changes.
    'paid', case when v_header.status in ('posted', 'void') then coalesce(v_header.paid_at_posting, v_header.paid_amount) else v_header.paid_amount end,
    'rounding', v_header.rounding_amount,
    'due', case when v_header.status in ('posted', 'void')
      then round(v_header.foreign_total_amount - coalesce(v_header.paid_at_posting, v_header.paid_amount) + v_header.rounding_amount, 2)
      else v_header.amount_due end,
    'lineNettSum', v_line_nett,
    'breakdownVatSum', v_breakdown_vat,
    'seller', coalesce(v_seller, '{}'::jsonb),
    'buyer', coalesce(v_buyer, '{}'::jsonb),
    'lines', v_lines,
    'breakdown', v_breakdown
  );
end;
$$;
