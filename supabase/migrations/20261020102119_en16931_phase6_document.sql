create or replace function public.en16931_document(p_header_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_source jsonb;
  v_seller jsonb;
  v_buyer jsonb;
  v_line jsonb;
  v_row jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_number text;
  v_seller_address jsonb;
  v_buyer_address jsonb;
  v_seller_contact jsonb;
  v_buyer_contact jsonb;
  v_payment jsonb;
  v_seller_party jsonb;
  v_buyer_party jsonb;
  v_allowance jsonb;
  v_item text;
begin
  v_source := public.en16931_source(p_header_id);
  if v_source is null then
    return null;
  end if;
  if v_source->>'kind' = 'order' then
    raise exception 'An order is not exported';
  end if;

  v_seller := v_source->'seller';
  v_buyer := v_source->'buyer';
  v_number := nullif(v_source->>'invoiceNumber', '');

  v_seller_address := jsonb_strip_nulls(jsonb_build_object(
    'BT-35', nullif(v_seller->>'line1', ''),
    'BT-36', nullif(v_seller->>'line2', ''),
    'BT-162', nullif(v_seller->>'line3', ''),
    'BT-37', nullif(v_seller->>'city', ''),
    'BT-38', nullif(v_seller->>'postCode', ''),
    'BT-39', nullif(v_seller->>'county', ''),
    'BT-40', nullif(v_seller->>'country', '')
  ));
  v_buyer_address := jsonb_strip_nulls(jsonb_build_object(
    'BT-35', nullif(v_buyer->>'line1', ''),
    'BT-36', nullif(v_buyer->>'line2', ''),
    'BT-162', nullif(v_buyer->>'line3', ''),
    'BT-37', nullif(v_buyer->>'city', ''),
    'BT-38', nullif(v_buyer->>'postCode', ''),
    'BT-39', nullif(v_buyer->>'county', ''),
    'BT-40', nullif(v_buyer->>'country', '')
  ));
  if v_seller_address = '{}'::jsonb then v_seller_address := null; end if;
  if v_buyer_address = '{}'::jsonb then v_buyer_address := null; end if;
  v_seller_contact := jsonb_strip_nulls(jsonb_build_object(
    'BT-41', nullif(v_seller->>'contact', ''),
    'BT-42', nullif(v_seller->>'phone', ''),
    'BT-43', nullif(v_seller->>'email', '')
  ));
  v_buyer_contact := jsonb_strip_nulls(jsonb_build_object(
    'BT-56', nullif(v_buyer->>'contact', ''),
    'BT-57', nullif(v_buyer->>'phone', ''),
    'BT-58', nullif(v_buyer->>'email', '')
  ));
  if v_seller_contact = '{}'::jsonb then v_seller_contact := null; end if;
  if v_buyer_contact = '{}'::jsonb then v_buyer_contact := null; end if;
  v_seller_party := jsonb_strip_nulls(jsonb_build_object(
    'BT-27', nullif(v_seller->>'name', ''),
    'BT-29', case when v_source->>'direction' = 'Purchases' then nullif(v_seller->>'code', '') end,
    'BT-30', nullif(v_seller->>'company', ''),
    'BT-31', nullif(v_seller->>'vat', ''),
    'BT-34', case
      when nullif(v_seller->>'peppolScheme', '') is not null and nullif(v_seller->>'peppolId', '') is not null
        then jsonb_build_object('scheme', v_seller->>'peppolScheme', 'value', v_seller->>'peppolId')
    end,
    'BG-5', v_seller_address,
    'BG-6', v_seller_contact
  ));
  v_buyer_party := jsonb_strip_nulls(jsonb_build_object(
    'BT-44', nullif(v_buyer->>'name', ''),
    'BT-46', case when v_source->>'direction' = 'Sales' then nullif(v_buyer->>'code', '') end,
    'BT-47', nullif(v_buyer->>'company', ''),
    'BT-48', nullif(v_buyer->>'vat', ''),
    'BT-49', case
      when nullif(v_buyer->>'peppolScheme', '') is not null and nullif(v_buyer->>'peppolId', '') is not null
        then jsonb_build_object('scheme', v_buyer->>'peppolScheme', 'value', v_buyer->>'peppolId')
    end,
    'BG-8', v_buyer_address,
    'BG-9', v_buyer_contact
  ));
  if v_seller_party = '{}'::jsonb then v_seller_party := null; end if;
  if v_buyer_party = '{}'::jsonb then v_buyer_party := null; end if;
  v_payment := jsonb_strip_nulls(jsonb_build_object(
    'BT-81', nullif(v_source->>'paymentMeans', ''),
    'BT-83', v_number,
    'BG-17', case
      when nullif(v_seller->>'iban', '') is not null then jsonb_strip_nulls(jsonb_build_object(
        'BT-84', v_seller->>'iban',
        'BT-85', nullif(v_seller->>'accountName', ''),
        'BT-86', nullif(v_seller->>'bic', '')
      ))
    end
  ));
  if v_payment = '{}'::jsonb then v_payment := null; end if;

  for v_line in select value from jsonb_array_elements(v_source->'lines')
  loop
    v_allowance := null;
    if coalesce((v_line->>'discount')::numeric, 0) <> 0 then
      v_allowance := jsonb_build_array(jsonb_build_object(
        'BT-136', public.en16931_amount((v_line->>'discount')::numeric),
        'BT-140', '95'
      ));
    end if;
    v_item := nullif(v_line->>'sellerItem', '');
    if v_source->>'direction' = 'Sales' then
      v_item := nullif(v_line->>'productCode', '');
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'BT-126', v_line->>'line',
      'BT-127', nullif(v_line->>'note', ''),
      'BT-129', regexp_replace(regexp_replace(to_char((v_line->>'quantity')::numeric, 'FM999999999990.9999'), '0+$', ''), '\.$', ''),
      'BT-130', nullif(v_line->>'unit', ''),
      'BT-131', public.en16931_amount((v_line->>'nett')::numeric),
      'BG-27', v_allowance,
      'BG-29', jsonb_build_object('BT-146', public.en16931_price((v_line->>'price')::numeric)),
      'BG-30', jsonb_strip_nulls(jsonb_build_object(
        'BT-151', nullif(v_line->>'category', ''),
        'BT-152', public.en16931_amount((v_line->>'rate')::numeric)
      )),
      'BG-31', jsonb_strip_nulls(jsonb_build_object(
        'BT-153', nullif(v_line->>'description', ''),
        'BT-155', v_item
      ))
    )));
  end loop;

  for v_row in select value from jsonb_array_elements(v_source->'breakdown')
  loop
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'BT-116', public.en16931_amount((v_row->>'taxable')::numeric),
      'BT-117', public.en16931_amount((v_row->>'vat')::numeric),
      'BT-118', v_row->>'category',
      'BT-119', public.en16931_amount((v_row->>'rate')::numeric),
      'BT-120', nullif(v_row->>'exemptionReason', ''),
      'BT-121', nullif(v_row->>'exemptionCode', '')
    )));
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'BT-1', v_number,
    'BT-2', to_char((v_source->>'issueDate')::date, 'YYYY-MM-DD'),
    'BT-3', case v_source->>'kind' when 'credit_note' then '381' else '380' end,
    'BT-5', v_source->>'currency',
    'BT-6', case
      when v_source->>'homeCurrency' is not null and v_source->>'homeCurrency' is distinct from v_source->>'currency'
        then v_source->>'homeCurrency'
    end,
    'BT-9', case when v_source->>'dueDate' is not null then to_char((v_source->>'dueDate')::date, 'YYYY-MM-DD') end,
    'BT-10', nullif(v_source->>'buyerReference', ''),
    'BT-12', nullif(v_source->>'contractReference', ''),
    'BT-13', nullif(v_source->>'orderNumber', ''),
    'BT-20', nullif(v_source->>'paymentTerms', ''),
    'BT-22', nullif(v_source->>'notes', ''),
    'BT-23', 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    'BT-24', 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    'BT-72', case when v_source->>'supplyDate' is not null then to_char((v_source->>'supplyDate')::date, 'YYYY-MM-DD') end,
    'BG-3', case
      when nullif(v_source->>'precedingReference', '') is not null then jsonb_strip_nulls(jsonb_build_object(
        'BT-25', v_source->>'precedingReference',
        'BT-26', case when v_source->>'precedingDate' is not null then to_char((v_source->>'precedingDate')::date, 'YYYY-MM-DD') end
      ))
    end,
    'BG-4', v_seller_party,
    'BG-7', v_buyer_party,
    'BG-14', case
      when v_source->>'periodStart' is not null and v_source->>'periodEnd' is not null then jsonb_build_object(
        'BT-73', to_char((v_source->>'periodStart')::date, 'YYYY-MM-DD'),
        'BT-74', to_char((v_source->>'periodEnd')::date, 'YYYY-MM-DD')
      )
    end,
    'BG-16', v_payment,
    'BG-22', jsonb_strip_nulls(jsonb_build_object(
      'BT-106', public.en16931_amount((v_source->>'lineNettSum')::numeric),
      'BT-109', public.en16931_amount((v_source->>'nett')::numeric),
      'BT-110', public.en16931_amount((v_source->>'vat')::numeric),
      'BT-111', case
        when v_source->>'homeCurrency' is not null and v_source->>'homeCurrency' is distinct from v_source->>'currency'
          then public.en16931_amount((v_source->>'homeVat')::numeric)
      end,
      'BT-112', public.en16931_amount((v_source->>'total')::numeric),
      'BT-113', case when coalesce((v_source->>'paid')::numeric, 0) <> 0 then public.en16931_amount((v_source->>'paid')::numeric) end,
      'BT-114', case when coalesce((v_source->>'rounding')::numeric, 0) <> 0 then public.en16931_amount((v_source->>'rounding')::numeric) end,
      'BT-115', public.en16931_amount((v_source->>'due')::numeric)
    )),
    'BG-23', case when v_breakdown = '[]'::jsonb then null else v_breakdown end,
    'BG-25', case when v_lines = '[]'::jsonb then null else v_lines end
  ));
end;
$$;

revoke all on function public.en16931_document(uuid) from public, anon;
grant execute on function public.en16931_document(uuid) to authenticated;

comment on function public.en16931_document(uuid) is
  'EN 16931 semantic invoice as JSON. Orders raise. A document the caller cannot see returns null.';

