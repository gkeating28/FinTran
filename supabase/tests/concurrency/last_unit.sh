#!/usr/bin/env bash
# Two people invoice the last unit of an order line at the same moment. One succeeds and one is refused.
#
# This needs two database sessions, so it cannot be a single rolled-back SQL file like the other tests.
# It COMMITS a small tenant, so run it only against a throwaway database:
#   PSQL="psql -d qula" supabase/tests/concurrency/last_unit.sh
set -euo pipefail
PSQL=${PSQL:-psql}
OWNER=c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0$(printf '%02d' $((RANDOM % 90 + 10)))
CLAIMS="select set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, false); set role authenticated;"

IDS=$($PSQL -qAt -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('$OWNER', 'owner-$OWNER@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
$CLAIMS
select set_config('test.org', (public.create_tenant('Last Unit $OWNER', 'Last Unit Office $OWNER'))->>'organisation_id', false);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), false);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1) on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, reference_prefix, reference_padding)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PO', 'Purchase order', 0, 'Purchases', 'order', 'PO-', 4),
       (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', null, 0);
select set_config('test.order', public.save_document(jsonb_build_object(
  'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PO'),
  'supplierId', (select id from public.suppliers where organisation_id = current_setting('test.org')::uuid),
  'transactionDate', '2026-11-12', 'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Last unit', 'quantity', 1, 'price', 10,
    'glCodeId', (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid)))
))::text, false);
select public.set_order_status(current_setting('test.order')::uuid, 'open');
select 'IDS ' || (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI')
  || ' ' || (select id from public.suppliers where organisation_id = current_setting('test.org')::uuid)
  || ' ' || (select id from public.transaction_lines where header_id = current_setting('test.order')::uuid)
  || ' ' || (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid);
SQL
)
read -r _ TYPE SUPPLIER LINE GL <<<"$(grep '^IDS ' <<<"$IDS")"

# Each session takes the whole unit, then holds its transaction open so the two overlap.
invoice() {
  $PSQL -qAt -v ON_ERROR_STOP=1 2>&1 <<SQL || true
$CLAIMS
begin;
select 'SAVED ' || public.save_document(jsonb_build_object(
  'transactionTypeId', '$TYPE', 'supplierId', '$SUPPLIER', 'supplierReference', 'SUP-$1',
  'transactionDate', '2026-11-12', 'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Last unit', 'quantity', 1, 'price', 10, 'glCodeId', '$GL', 'sourceLineId', '$LINE'))
));
select pg_sleep(2);
commit;
SQL
}
invoice A > /tmp/last_unit_a.out &
sleep 0.5
invoice B > /tmp/last_unit_b.out &
wait

SAVED=$(cat /tmp/last_unit_a.out /tmp/last_unit_b.out | grep -c '^SAVED ' || true)
REFUSED=$(cat /tmp/last_unit_a.out /tmp/last_unit_b.out | grep -c 'invoice more than was ordered' || true)
DRAWN=$($PSQL -qAt -c "select coalesce(sum(quantity), 0) from public.transaction_lines where source_line_id = '$LINE'")
echo "saved: $SAVED, refused: $REFUSED, quantity drawn on the line: $DRAWN"
if [ "$SAVED" = 1 ] && [ "$REFUSED" = 1 ] && [ "$DRAWN" = "1.0000" -o "$DRAWN" = "1" ]; then
  echo "last unit ok"
else
  echo "last unit FAILED"; cat /tmp/last_unit_a.out /tmp/last_unit_b.out; exit 1
fi
