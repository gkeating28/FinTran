-- Payments release B, phase 4: saving, posting, voiding and deleting payments (QULAPLUS_PAYMENTS_SPEC.md, phase 4).
--
-- save_payment runs with the caller's rights, so row level security decides. The rest check membership themselves,
-- because they change status, which only they may do, and write allocations, which nobody writes directly.

-- Replaces the planned (pending) allocations of a draft payment. Called by save_payment, which runs with the caller's
-- rights and so cannot reach the private schema, so this is in public. It checks membership and that the payment is a
-- draft itself, and does only what saving the payment does.
create function public.replace_pending_allocations(p_payment_id uuid, p_lines jsonb) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_tenant uuid;
  v_status public.document_status;
  v_line record;
begin
  select organisation_id, tenant_id, status into v_org, v_tenant, v_status
  from public.payments where id = p_payment_id for update;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That payment could not be found';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft payment can be changed';
  end if;

  delete from public.allocations where source_payment_id = p_payment_id and pending;

  for v_line in
    select (item->>'targetHeaderId')::uuid as target_id, (item->>'amount')::numeric as amount
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as item
    where coalesce((item->>'amount')::numeric, 0) <> 0
    order by (item->>'targetHeaderId')::uuid
  loop
    if v_line.amount < 0 or v_line.amount <> round(v_line.amount, 2) then
      raise exception 'Enter an amount to allocate that is greater than 0, with at most 2 decimal places';
    end if;
    insert into public.allocations (tenant_id, organisation_id, source_payment_id, target_header_id, amount)
    values (v_tenant, v_org, p_payment_id, v_line.target_id, v_line.amount);
  end loop;
end;
$$;

revoke all on function public.replace_pending_allocations(uuid, jsonb) from public, anon;
grant execute on function public.replace_pending_allocations(uuid, jsonb) to authenticated;

-- Inserts or replaces a draft payment and its planned allocations. Fills party name, currency and the default rate.
create function public.save_payment(p_payment jsonb) returns uuid
  language plpgsql
  set search_path to ''
as $$
declare
  v_id uuid := nullif(p_payment->>'id', '')::uuid;
  v_type uuid := nullif(p_payment->>'transactionTypeId', '')::uuid;
  v_org uuid;
  v_tenant uuid;
  v_direction text;
  v_status public.document_status;
  v_customer uuid;
  v_supplier uuid;
  v_currency uuid;
  v_amount numeric := nullif(p_payment->>'amount', '')::numeric;
  v_rate numeric := nullif(p_payment->>'exchangeRate', '')::numeric;
  v_means text := coalesce(nullif(btrim(p_payment->>'paymentMeansCode'), ''), '58');
begin
  select organisation_id, tenant_id, type into v_org, v_tenant, v_direction
  from public.transaction_types where id = v_type;
  if v_org is null then
    raise exception 'Choose a transaction type';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception 'Enter an amount greater than 0, with at most 2 decimal places';
  end if;
  if nullif(p_payment->>'paymentDate', '') is null then
    raise exception 'Enter the payment date';
  end if;

  if v_direction = 'Sales' then
    v_customer := nullif(p_payment->>'customerId', '')::uuid;
    select currency_id into v_currency from public.customers where id = v_customer and organisation_id = v_org;
  else
    v_supplier := nullif(p_payment->>'supplierId', '')::uuid;
    select currency_id into v_currency from public.suppliers where id = v_supplier and organisation_id = v_org;
  end if;
  if v_currency is null then
    raise exception 'Choose a % from this organisation', case when v_direction = 'Sales' then 'customer' else 'supplier' end;
  end if;

  if v_id is null then
    insert into public.payments (
      tenant_id, organisation_id, transaction_type_id, payment_date, customer_id, supplier_id, bank_account_id,
      currency_id, exchange_rate, amount, payment_means_code, bank_reference, notes, party_name
    ) values (
      v_tenant, v_org, v_type, (p_payment->>'paymentDate')::date, v_customer, v_supplier,
      nullif(p_payment->>'bankAccountId', '')::uuid, v_currency, v_rate, v_amount, v_means,
      p_payment->>'bankReference', p_payment->>'notes', 'Party'
    ) returning id into v_id;
  else
    select status into v_status from public.payments where id = v_id and organisation_id = v_org for update;
    if v_status is null then
      raise exception 'That payment could not be found';
    end if;
    if v_status is distinct from 'draft' then
      raise exception 'Only a draft payment can be saved';
    end if;
    update public.payments
    set payment_date = (p_payment->>'paymentDate')::date,
        customer_id = v_customer,
        supplier_id = v_supplier,
        bank_account_id = nullif(p_payment->>'bankAccountId', '')::uuid,
        currency_id = v_currency,
        exchange_rate = v_rate,
        amount = v_amount,
        payment_means_code = v_means,
        bank_reference = p_payment->>'bankReference',
        notes = p_payment->>'notes'
    where id = v_id and status = 'draft';
  end if;

  perform public.replace_pending_allocations(v_id, p_payment->'allocations');
  return v_id;
end;
$$;

-- Posts a draft payment. Every planned allocation is checked against what is open now, and the post fails with the list
-- of documents that no longer have enough open. Nothing is numbered unless everything passes.
create function public.post_payment(p_payment_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_type uuid;
  v_reference integer;
  v_numbering public.numbering_rule;
  v_short text;
  v_allocation record;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a payment';
  end if;

  select organisation_id, status, payment_date, transaction_type_id, reference
    into v_org, v_status, v_date, v_type, v_reference
  from public.payments where id = p_payment_id for update;
  if v_org is null then
    raise exception 'That payment could not be posted';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft payment can be posted';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;

  -- Lock every target in id order, then compare what each planned allocation wants with what is open now.
  perform 1
  from public.transaction_headers
  where id in (select target_header_id from public.allocations where source_payment_id = p_payment_id and pending)
  order by id
  for update;

  select string_agg(format('%s (%s wanted, %s open)', coalesce(header.document_number, header.reference::text, 'a document'),
                           trim(to_char(planned.amount, 'FM999G999G999G990D00')),
                           trim(to_char(greatest(open.amount, 0), 'FM999G999G999G990D00'))), ', ' order by header.id)
    into v_short
  from (
    select target_header_id, sum(amount) as amount
    from public.allocations where source_payment_id = p_payment_id and pending
    group by target_header_id
  ) as planned
  join public.transaction_headers as header on header.id = planned.target_header_id
  cross join lateral (
    select header.foreign_total_amount + header.rounding_amount - private.header_settled(header.id, null) as amount
  ) as open
  where header.status is distinct from 'posted' or planned.amount > open.amount;
  if v_short is not null then
    raise exception 'These documents no longer have enough open: %', v_short;
  end if;

  select numbering into v_numbering from public.transaction_types where id = v_type;
  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  perform set_config('fintran.status_change', 'on', true);
  update public.payments
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      reference = v_reference
  where id = p_payment_id;
  perform set_config('fintran.status_change', 'off', true);

  -- The planned allocations take effect, targets in id order. The allocation trigger sets their dates and home
  -- amounts, checks the lock date and checks every amount again.
  for v_allocation in
    select id from public.allocations where source_payment_id = p_payment_id and pending order by target_header_id, id
  loop
    update public.allocations set pending = false where id = v_allocation.id;
  end loop;
end;
$$;

-- Voids a posted payment. Every effective allocation is removed with the void reason first, so each invoice is open again.
create function public.void_payment(p_payment_id uuid, p_reason text) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_reason text := nullif(btrim(p_reason), '');
  v_allocation record;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before voiding a payment';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a reason for voiding this payment';
  end if;

  select organisation_id, status, payment_date into v_org, v_status, v_date
  from public.payments where id = p_payment_id for update;
  if v_org is null then
    raise exception 'That payment could not be voided';
  end if;
  if not (select private.has_org_role(v_org, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to void a payment';
  end if;
  if v_status is distinct from 'posted' then
    raise exception 'Only a posted payment can be voided';
  end if;
  if private.document_period_locked(v_org, v_date)
     or exists (
       select 1 from public.allocations
       where source_payment_id = p_payment_id and removed_at is null and not pending
         and private.document_period_locked(v_org, allocation_date)
     ) then
    raise exception 'This date is in a locked period';
  end if;

  for v_allocation in
    select id from public.allocations
    where source_payment_id = p_payment_id and removed_at is null and not pending
    order by target_header_id, id
  loop
    update public.allocations set removed_at = now(), removal_reason = v_reason where id = v_allocation.id;
  end loop;

  perform set_config('fintran.status_change', 'on', true);
  update public.payments
  set status = 'void', voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
  where id = p_payment_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

-- Deletes a draft payment and its planned allocations.
create function public.delete_payment(p_payment_id uuid) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before deleting a payment';
  end if;
  select organisation_id, status into v_org, v_status from public.payments where id = p_payment_id for update;
  if v_org is null or not private.is_org_member(v_org) then
    raise exception 'That payment could not be deleted';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft payment can be deleted';
  end if;
  delete from public.allocations where source_payment_id = p_payment_id and pending;
  delete from public.payments where id = p_payment_id;
end;
$$;

revoke all on function public.save_payment(jsonb) from public, anon;
revoke all on function public.post_payment(uuid) from public, anon;
revoke all on function public.void_payment(uuid, text) from public, anon;
revoke all on function public.delete_payment(uuid) from public, anon;
grant execute on function public.save_payment(jsonb) to authenticated;
grant execute on function public.post_payment(uuid) to authenticated;
grant execute on function public.void_payment(uuid, text) to authenticated;
grant execute on function public.delete_payment(uuid) to authenticated;
