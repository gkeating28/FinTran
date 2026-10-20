create or replace function public.en16931_readiness(p_header_id uuid)
returns table (rule_id text, severity text, business_term text, message text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_source jsonb;
  v_severity text;
  v_seller jsonb;
  v_buyer jsonb;
  v_line jsonb;
  v_row jsonb;
  v_vat text;
  v_prefix text;
begin
  v_source := public.en16931_source(p_header_id);
  if v_source is null then
    return;
  end if;

  v_severity := case when v_source->>'direction' = 'Sales' then 'error' else 'warning' end;
  v_seller := v_source->'seller';
  v_buyer := v_source->'buyer';

  if nullif(v_seller->>'name', '') is null then
    rule_id := 'BR-06';
    severity := v_severity;
    business_term := 'BT-27';
    message := 'The seller name is missing.';
    return next;
  end if;
  if nullif(v_buyer->>'name', '') is null then
    rule_id := 'BR-07';
    severity := v_severity;
    business_term := 'BT-44';
    message := 'The buyer name is missing.';
    return next;
  end if;
  if nullif(v_seller->>'line1', '') is null or nullif(v_seller->>'city', '') is null or nullif(v_seller->>'country', '') is null then
    rule_id := 'BR-08';
    severity := v_severity;
    business_term := 'BG-5';
    message := 'The seller postal address needs a street, a city, and a country.';
    return next;
  end if;
  if nullif(v_seller->>'country', '') is null then
    rule_id := 'BR-09';
    severity := v_severity;
    business_term := 'BT-40';
    message := 'The seller postal address needs a country code.';
    return next;
  end if;
  if nullif(v_buyer->>'line1', '') is null or nullif(v_buyer->>'city', '') is null or nullif(v_buyer->>'country', '') is null then
    rule_id := 'BR-10';
    severity := v_severity;
    business_term := 'BG-8';
    message := 'The buyer postal address needs a street, a city, and a country.';
    return next;
  end if;
  if nullif(v_buyer->>'country', '') is null then
    rule_id := 'BR-11';
    severity := v_severity;
    business_term := 'BT-55';
    message := 'The buyer postal address needs a country code.';
    return next;
  end if;

  v_vat := nullif(v_seller->>'vat', '');
  if v_vat is null and exists (
    select 1 from jsonb_array_elements(v_source->'lines') as line
    where line->>'category' = 'S'
  ) then
    rule_id := 'BR-S-02';
    severity := v_severity;
    business_term := 'BT-31';
    message := 'A standard-rated line needs the seller VAT identifier.';
    return next;
  end if;
  if v_vat is not null then
    v_prefix := upper(substring(v_vat from 1 for 2));
    if char_length(v_vat) < 4
       or substring(v_vat from 3) !~ '^[A-Z0-9]{2,13}$'
       or not (
         exists (
           select 1 from public.ref_countries
           where code = v_prefix and vat_prefix_only is false
         ) or v_prefix = 'EL'
       ) then
      rule_id := 'BR-CO-09';
      severity := v_severity;
      business_term := 'BT-31';
      message := 'The seller VAT identifier needs a country prefix, such as IE or EL.';
      return next;
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_source->'lines') as line
    where line->>'category' = 'K'
  ) and nullif(v_buyer->>'vat', '') is null then
    rule_id := 'BR-IC-02';
    severity := v_severity;
    business_term := 'BT-48';
    message := 'An intra-Community line needs the buyer VAT identifier.';
    return next;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_source->'lines') as line
    where line->>'category' = 'AE'
  ) and nullif(v_buyer->>'vat', '') is null and nullif(v_buyer->>'company', '') is null then
    rule_id := 'BR-AE-02';
    severity := v_severity;
    business_term := 'BT-48';
    message := 'A reverse-charge line needs the buyer VAT identifier or company number.';
    return next;
  end if;

  if nullif(v_seller->>'peppolScheme', '') is null or nullif(v_seller->>'peppolId', '') is null then
    rule_id := 'PEPPOL-EN16931-R020';
    severity := v_severity;
    business_term := 'BT-34';
    message := 'The seller electronic address is missing.';
    return next;
  end if;
  if nullif(v_buyer->>'peppolScheme', '') is null or nullif(v_buyer->>'peppolId', '') is null then
    rule_id := 'PEPPOL-EN16931-R010';
    severity := v_severity;
    business_term := 'BT-49';
    message := 'The buyer electronic address is missing.';
    return next;
  end if;
  if nullif(v_source->>'buyerReference', '') is null and nullif(v_source->>'orderNumber', '') is null then
    rule_id := 'PEPPOL-EN16931-R003';
    severity := v_severity;
    business_term := 'BT-10';
    message := 'A buyer reference or purchase order reference is required.';
    return next;
  end if;
  if coalesce((v_source->>'due')::numeric, 0) > 0
     and v_source->>'dueDate' is null
     and nullif(v_source->>'paymentTerms', '') is null then
    rule_id := 'BR-CO-25';
    severity := v_severity;
    business_term := 'BT-9';
    message := 'When an amount is due, enter a due date or payment terms.';
    return next;
  end if;
  if v_source->>'direction' = 'Purchases' and nullif(v_source->>'invoiceNumber', '') is null then
    rule_id := 'FINTRAN-BT-1';
    severity := 'warning';
    business_term := 'BT-1';
    message := 'This purchase has no supplier invoice number, so the invoice number is left out of the export.';
    return next;
  end if;
  if v_source->>'direction' = 'Sales' and nullif(v_source->>'invoiceNumber', '') is null and v_source->>'status' = 'posted' then
    rule_id := 'BT-1';
    severity := 'error';
    business_term := 'BT-1';
    message := 'The sales invoice has no document number.';
    return next;
  end if;

  if round(coalesce((v_source->>'lineNettSum')::numeric, 0), 2) is distinct from round(coalesce((v_source->>'nett')::numeric, 0), 2) then
    rule_id := 'BR-CO-10';
    severity := v_severity;
    business_term := 'BT-106';
    message := 'The sum of the line nett amounts does not match the document nett.';
    return next;
  end if;
  if round(coalesce((v_source->>'nett')::numeric, 0), 2) is distinct from round(coalesce((v_source->>'nett')::numeric, 0), 2) then
    rule_id := 'BR-CO-13';
    severity := v_severity;
    business_term := 'BT-109';
    message := 'The total without VAT does not match the line nett amounts.';
    return next;
  end if;
  if round(coalesce((v_source->>'breakdownVatSum')::numeric, 0), 2) is distinct from round(coalesce((v_source->>'vat')::numeric, 0), 2) then
    rule_id := 'BR-CO-14';
    severity := v_severity;
    business_term := 'BT-110';
    message := 'The document VAT does not match the VAT breakdown.';
    return next;
  end if;
  if round(coalesce((v_source->>'nett')::numeric, 0) + coalesce((v_source->>'vat')::numeric, 0), 2)
     is distinct from round(coalesce((v_source->>'total')::numeric, 0), 2) then
    rule_id := 'BR-CO-15';
    severity := v_severity;
    business_term := 'BT-112';
    message := 'The total with VAT does not equal the nett plus the VAT.';
    return next;
  end if;
  if round(
       coalesce((v_source->>'total')::numeric, 0)
       - coalesce((v_source->>'paid')::numeric, 0)
       + coalesce((v_source->>'rounding')::numeric, 0),
       2
     ) is distinct from round(coalesce((v_source->>'due')::numeric, 0), 2) then
    rule_id := 'BR-CO-16';
    severity := v_severity;
    business_term := 'BT-115';
    message := 'The amount due does not equal the total, minus paid, plus rounding.';
    return next;
  end if;

  for v_row in select value from jsonb_array_elements(v_source->'breakdown')
  loop
    if round(coalesce((v_row->>'vat')::numeric, 0), 2)
       is distinct from round(coalesce((v_row->>'taxable')::numeric, 0) * coalesce((v_row->>'rate')::numeric, 0) / 100, 2) then
      rule_id := 'BR-CO-17';
      severity := v_severity;
      business_term := 'BT-117';
      message := 'A VAT breakdown amount does not match its taxable amount times the rate.';
      return next;
    end if;
    if v_row->>'category' in ('E', 'AE', 'G', 'K', 'O')
       and nullif(v_row->>'exemptionCode', '') is null
       and nullif(v_row->>'exemptionReason', '') is null then
      rule_id := case v_row->>'category'
        when 'E' then 'BR-E-10'
        when 'AE' then 'BR-AE-10'
        when 'G' then 'BR-G-10'
        when 'K' then 'BR-IC-10'
        else 'BR-O-10'
      end;
      severity := v_severity;
      business_term := 'BT-120';
      message := 'This VAT category needs an exemption reason.';
      return next;
    end if;
    if v_row->>'category' = 'Z'
       and (nullif(v_row->>'exemptionCode', '') is not null or nullif(v_row->>'exemptionReason', '') is not null) then
      rule_id := 'BR-Z-10';
      severity := v_severity;
      business_term := 'BT-120';
      message := 'A zero-rated VAT breakdown must not carry an exemption reason.';
      return next;
    end if;
  end loop;

  if jsonb_array_length(v_source->'lines') < 1 then
    rule_id := 'BR-16';
    severity := v_severity;
    business_term := 'BG-25';
    message := 'The document needs at least one line.';
    return next;
  end if;
  for v_line in select value from jsonb_array_elements(v_source->'lines')
  loop
    if nullif(v_line->>'unit', '') is null then
      rule_id := 'BR-23';
      severity := v_severity;
      business_term := 'BT-130';
      message := 'Each line needs a unit.';
      return next;
    end if;
    if nullif(v_line->>'category', '') is null then
      rule_id := 'BR-CO-04';
      severity := v_severity;
      business_term := 'BT-151';
      message := 'Each line needs a VAT category.';
      return next;
    end if;
  end loop;

  if v_source->>'kind' = 'credit_note' and nullif(v_source->>'precedingReference', '') is null then
    rule_id := 'FINTRAN-CREDIT';
    severity := v_severity;
    business_term := 'BT-25';
    message := 'A credit note needs the invoice it applies to.';
    return next;
  end if;

  if v_source->>'paymentMeans' in ('30', '58') and nullif(v_seller->>'iban', '') is null then
    rule_id := 'BR-61';
    severity := v_severity;
    business_term := 'BT-84';
    message := 'A credit transfer needs the seller IBAN.';
    return next;
  end if;

  if coalesce((v_seller->>'needsReview')::boolean, false) or coalesce((v_buyer->>'needsReview')::boolean, false) then
    rule_id := 'FINTRAN-ADDRESS-REVIEW';
    severity := 'warning';
    business_term := 'BG-5';
    message := 'An address was split from older text and still needs review.';
    return next;
  end if;
end;
$$;

revoke all on function public.en16931_readiness(uuid) from public, anon;
grant execute on function public.en16931_readiness(uuid) to authenticated;

comment on function public.en16931_readiness(uuid) is
  'EN 16931 readiness. Sales gaps are errors. Purchase gaps are warnings, except where posting already has its own rule.';

