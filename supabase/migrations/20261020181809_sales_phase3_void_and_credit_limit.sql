create or replace function public.void_document(p_header_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_direction text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before voiding a document';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a reason for voiding this document';
  end if;

  select header.organisation_id, header.status, header.transaction_date, kind.type
    into v_org, v_status, v_date, v_direction
  from public.transaction_headers as header
  join public.transaction_types as kind on kind.id = header.transaction_type_id
  where header.id = p_header_id
  for update of header;

  if v_org is null then
    raise exception 'That document could not be voided';
  end if;
  if v_direction = 'Sales' then
    raise exception 'A posted sales document cannot be voided. Issue a credit note instead.';
  end if;
  if not (select private.has_org_role(v_org, array['owner', 'admin'])) then
    raise exception 'You need an owner or admin role to void a document';
  end if;
  if v_status is distinct from 'posted' then
    raise exception 'Only a posted document can be voided';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;

  perform set_config('fintran.status_change', 'on', true);
  update public.transaction_headers
  set status = 'void',
      voided_at = now(),
      voided_by = (select auth.uid()),
      void_reason = v_reason
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

revoke all on function public.void_document(uuid, text) from public, anon;
grant execute on function public.void_document(uuid, text) to authenticated;

create or replace function private.enforce_sales_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direction text;
  v_kind text;
  v_invoice_total numeric;
  v_invoice_currency uuid;
  v_credited numeric;
begin
  if tg_op <> 'UPDATE' or old.status is distinct from 'draft' or new.status is distinct from 'posted' then
    return new;
  end if;

  select type, document_kind::text into v_direction, v_kind
  from public.transaction_types
  where id = new.transaction_type_id;

  if v_direction = 'Sales' and new.transaction_date > current_date + 1 then
    raise exception 'The document date cannot be more than one day in the future';
  end if;

  if v_direction = 'Sales' and exists (
    select 1
    from public.transaction_lines as line
    left join public.gl_codes as gl on gl.id = line.gl_code_id
    where line.header_id = new.id
      and (line.gl_code_id is null or gl.account_type is distinct from 'Income')
  ) then
    raise exception 'Each sales line needs an Income GL code';
  end if;

  if v_kind = 'credit_note' and new.preceding_header_id is not null then
    select foreign_total_amount, currency_id
      into v_invoice_total, v_invoice_currency
    from public.transaction_headers
    where id = new.preceding_header_id
      and organisation_id = new.organisation_id
    for update;

    if v_invoice_currency is distinct from new.currency_id then
      raise exception 'The credited document must use the same currency';
    end if;

    select coalesce(sum(credit.foreign_total_amount), 0) into v_credited
    from public.transaction_headers as credit
    join public.transaction_types as kind on kind.id = credit.transaction_type_id
    where credit.preceding_header_id = new.preceding_header_id
      and credit.status = 'posted'
      and credit.id is distinct from new.id
      and kind.document_kind = 'credit_note';

    if v_credited + new.foreign_total_amount > v_invoice_total then
      raise exception 'This credit note would take total credits above the original invoice total.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sales_posting() from public, anon, authenticated;

drop trigger if exists zzz_sales_posting on public.transaction_headers;
create trigger zzz_sales_posting
  before update on public.transaction_headers
  for each row execute function private.enforce_sales_posting();
