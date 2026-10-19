-- Phase 6: purchases keep numbering on entry. Sales, and any type set to on_post, number when posted.

create type public.numbering_rule as enum ('on_insert', 'on_post');

alter table public.transaction_types
  add column numbering public.numbering_rule not null default 'on_insert';

alter table public.transaction_headers drop constraint transaction_headers_reference_check;
alter table public.transaction_headers alter column reference drop not null;
alter table public.transaction_headers
  add constraint transaction_headers_reference_check check (reference is null or reference > 0);
alter table public.transaction_headers
  add constraint transaction_headers_reference_when_posted_check check (status = 'draft' or reference is not null);

alter table public.transaction_lines alter column reference drop not null;

create or replace function private.enforce_transaction_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_tenant uuid;
  v_documents integer;
begin
  if tg_op = 'UPDATE'
     and (new.tenant_id is distinct from old.tenant_id
       or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'A transaction type cannot be moved to another organisation';
  end if;

  select tenant_id into org_tenant
  from public.organisations
  where id = new.organisation_id;

  if org_tenant is null or org_tenant is distinct from new.tenant_id then
    raise exception 'Organisation does not belong to this tenant';
  end if;

  new.code := upper(btrim(new.code));
  new.description := btrim(new.description);
  new.flex1_label := nullif(btrim(new.flex1_label), '');
  new.flex2_label := nullif(btrim(new.flex2_label), '');
  new.flex3_label := nullif(btrim(new.flex3_label), '');
  new.flex4_label := nullif(btrim(new.flex4_label), '');
  new.flex5_label := nullif(btrim(new.flex5_label), '');

  if new.type = 'Sales' then
    new.numbering := 'on_post';
  end if;

  if tg_op = 'UPDATE'
     and (new.numbering is distinct from old.numbering or new.type is distinct from old.type) then
    select count(*) into v_documents
    from public.transaction_headers
    where transaction_type_id = new.id;

    if v_documents > 0 and new.numbering is distinct from old.numbering then
      raise exception 'Numbering cannot change after a document has been entered';
    end if;
    if v_documents > 0 and new.type is distinct from old.type then
      raise exception 'The transaction type cannot change after a document has been entered';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.last_reference := 0;
  elsif new.last_reference is distinct from old.last_reference
    and new.last_reference is distinct from old.last_reference + 1 then
    new.last_reference := old.last_reference;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_type() from public, anon, authenticated;

update public.transaction_types
set numbering = 'on_post'
where type = 'Sales';

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

  if new.exchange_rate is null or new.exchange_rate <= 0 then
    raise exception 'Enter an exchange rate greater than 0';
  end if;

  new.supplier_name := btrim(new.supplier_name);
  new.contact_details := nullif(btrim(new.contact_details), '');
  new.notes := nullif(btrim(new.notes), '');
  new.order_number := nullif(btrim(new.order_number), '');
  new.flex1 := nullif(btrim(new.flex1), '');
  new.flex2 := nullif(btrim(new.flex2), '');
  new.flex3 := nullif(btrim(new.flex3), '');
  new.flex4 := nullif(btrim(new.flex4), '');
  new.flex5 := nullif(btrim(new.flex5), '');

  if tg_op = 'INSERT' and v_numbering is distinct from 'on_post' then
    new.reference := private.issue_reference(new.transaction_type_id);
  elsif tg_op = 'INSERT' then
    new.reference := null;
  end if;

  select coalesce(sum(nett_amount), 0), coalesce(sum(vat_amount), 0)
    into nett, vat
  from public.transaction_lines
  where header_id = new.id;

  new.foreign_nett_amount := nett;
  new.foreign_vat_amount := vat;
  new.foreign_total_amount := nett + vat;
  new.home_nett_amount := round(nett / new.exchange_rate, 4);
  new.home_vat_amount := round(vat / new.exchange_rate, 4);
  new.home_total_amount := round((nett + vat) / new.exchange_rate, 4);

  return new;
end;
$$;

revoke all on function private.enforce_transaction_header() from public, anon, authenticated;

create or replace function public.post_document(p_header_id uuid, p_logo_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status public.document_status;
  v_date date;
  v_supplier uuid;
  v_type uuid;
  v_reference integer;
  v_numbering public.numbering_rule;
  v_lines integer;
  v_issuer jsonb;
  v_party jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date, supplier_id, transaction_type_id, reference
    into v_org, v_status, v_date, v_supplier, v_type, v_reference
  from public.transaction_headers
  where id = p_header_id
  for update;

  if v_org is null then
    raise exception 'That document could not be posted';
  end if;
  if not (select private.is_org_member(v_org)) then
    raise exception 'You are not a member of this organisation';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Only a draft document can be posted';
  end if;
  if private.document_period_locked(v_org, v_date) then
    raise exception 'This date is in a locked period';
  end if;
  if p_logo_path is not null
     and p_logo_path is distinct from v_org::text || '/snapshots/' || p_header_id::text then
    raise exception 'The posted logo path is not valid';
  end if;

  select count(*) into v_lines
  from public.transaction_lines
  where header_id = p_header_id;

  if v_lines < 1 then
    raise exception 'Add a line before posting';
  end if;

  select numbering into v_numbering
  from public.transaction_types
  where id = v_type;

  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  select jsonb_build_object(
    'name', organisation.name,
    'address', defaults.address,
    'contactName', defaults.contact_name,
    'contactEmail', defaults.contact_email,
    'website', defaults.website,
    'phone', defaults.phone,
    'vatNumber', defaults.vat_number,
    'companyNumber', defaults.company_number,
    'bankingDetails', defaults.banking_details,
    'logoPath', p_logo_path
  )
  into v_issuer
  from public.organisations as organisation
  left join public.organisation_defaults as defaults
    on defaults.organisation_id = organisation.id
  where organisation.id = v_org;

  select jsonb_build_object(
    'code', supplier.code,
    'name', supplier.name,
    'address', supplier.address,
    'phone', supplier.phone,
    'email', supplier.email,
    'website', supplier.website,
    'contactDetails', supplier.contact_details,
    'vatNumber', supplier.vat_number
  )
  into v_party
  from public.suppliers as supplier
  where supplier.id = v_supplier;

  perform set_config('fintran.status_change', 'on', true);
  if v_numbering = 'on_post' then
    update public.transaction_headers
    set reference = v_reference
    where id = p_header_id;
    update public.transaction_lines
    set reference = v_reference
    where header_id = p_header_id;
  end if;
  update public.transaction_headers
  set status = 'posted',
      posted_at = now(),
      posted_by = (select auth.uid()),
      issuer_snapshot = v_issuer,
      party_snapshot = v_party,
      reference = v_reference
  where id = p_header_id;
  perform set_config('fintran.status_change', 'off', true);
end;
$$;

revoke all on function public.post_document(uuid, text) from public, anon;
grant execute on function public.post_document(uuid, text) to authenticated;
