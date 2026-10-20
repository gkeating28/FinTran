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
  v_direction text;
  v_lines integer;
  v_issuer jsonb;
  v_party jsonb;
  v_iban text;
  v_customer uuid;
  v_errors text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before posting a document';
  end if;

  select organisation_id, status, transaction_date, supplier_id, customer_id, transaction_type_id, reference
    into v_org, v_status, v_date, v_supplier, v_customer, v_type, v_reference
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

  select numbering, type into v_numbering, v_direction
  from public.transaction_types
  where id = v_type;

  if v_numbering = 'on_post' and v_reference is null then
    v_reference := private.issue_reference(v_type);
  end if;

  select defaults.iban into v_iban
  from public.organisation_defaults as defaults
  where defaults.organisation_id = v_org;

  if v_direction = 'Sales' and v_iban is not null then
    update public.transaction_headers
    set payment_means_code = '58'
    where id = p_header_id
      and payment_means_code is null;
  end if;

  perform set_config('fintran.status_change', 'on', true);
  if v_numbering = 'on_post' then
    update public.transaction_headers
    set reference = v_reference
    where id = p_header_id;
    update public.transaction_lines
    set reference = v_reference
    where header_id = p_header_id;
  end if;

  if v_direction = 'Sales' then
    select string_agg(format('%s: %s', ready.rule_id, ready.message), ' ' order by ready.rule_id)
      into v_errors
    from public.en16931_readiness(p_header_id) as ready
    where ready.severity = 'error';
    if v_errors is not null then
      raise exception 'This sales document is not ready to post. %', v_errors;
    end if;
  end if;

  select jsonb_build_object(
    'name', organisation.name,
    'address', private.postal_address_text(
      defaults.address_line1, defaults.address_line2, defaults.address_line3,
      defaults.city, defaults.post_code, defaults.county, seller_country.name
    ),
    'addressLine1', defaults.address_line1,
    'addressLine2', defaults.address_line2,
    'addressLine3', defaults.address_line3,
    'city', defaults.city,
    'postCode', defaults.post_code,
    'county', defaults.county,
    'countryCode', defaults.country_code,
    'countryName', seller_country.name,
    'contactName', defaults.contact_name,
    'contactEmail', defaults.contact_email,
    'website', defaults.website,
    'phone', defaults.phone,
    'vatNumber', defaults.vat_number,
    'companyNumber', defaults.company_number,
    'peppolScheme', defaults.peppol_scheme,
    'peppolId', defaults.peppol_id,
    'iban', defaults.iban,
    'bic', defaults.bic,
    'bankAccountName', defaults.bank_account_name,
    'bankingDetails', defaults.banking_details,
    'logoPath', p_logo_path
  )
  into v_issuer
  from public.organisations as organisation
  left join public.organisation_defaults as defaults
    on defaults.organisation_id = organisation.id
  left join public.ref_countries as seller_country
    on seller_country.code = defaults.country_code
  where organisation.id = v_org;

  if v_direction = 'Sales' then
    select jsonb_build_object(
      'code', customers.code,
      'name', customers.name,
      'address', private.postal_address_text(
        customers.address_line1, customers.address_line2, customers.address_line3,
        customers.city, customers.post_code, customers.county, party_country.name
      ),
      'addressLine1', customers.address_line1,
      'addressLine2', customers.address_line2,
      'addressLine3', customers.address_line3,
      'city', customers.city,
      'postCode', customers.post_code,
      'county', customers.county,
      'countryCode', customers.country_code,
      'countryName', party_country.name,
      'phone', customers.phone,
      'email', customers.email,
      'website', customers.website,
      'contactDetails', customers.contact_details,
      'vatNumber', customers.vat_number,
      'companyNumber', customers.company_number,
      'peppolScheme', customers.peppol_scheme,
      'peppolId', customers.peppol_id
    )
    into v_party
    from public.customers as customers
    left join public.ref_countries as party_country
      on party_country.code = customers.country_code
    where customers.id = v_customer;
  else
  select jsonb_build_object(
    'code', supplier.code,
    'name', supplier.name,
    'address', private.postal_address_text(
      supplier.address_line1, supplier.address_line2, supplier.address_line3,
      supplier.city, supplier.post_code, supplier.county, party_country.name
    ),
    'addressLine1', supplier.address_line1,
    'addressLine2', supplier.address_line2,
    'addressLine3', supplier.address_line3,
    'city', supplier.city,
    'postCode', supplier.post_code,
    'county', supplier.county,
    'countryCode', supplier.country_code,
    'countryName', party_country.name,
    'phone', supplier.phone,
    'email', supplier.email,
    'website', supplier.website,
    'contactDetails', supplier.contact_details,
    'vatNumber', supplier.vat_number,
    'companyNumber', supplier.company_number,
    'peppolScheme', supplier.peppol_scheme,
    'peppolId', supplier.peppol_id
  )
  into v_party
  from public.suppliers as supplier
  left join public.ref_countries as party_country
    on party_country.code = supplier.country_code
  where supplier.id = v_supplier;
  end if;

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
