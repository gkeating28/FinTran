#!/usr/bin/env bash
# Two people allocate the last 100.00 of an invoice at the same moment, from two different payments. One succeeds and
# one is refused, and neither waits forever (no deadlock).
#
# This needs two database sessions, so it cannot be a single rolled-back SQL file like the other tests.
# It COMMITS a small tenant, so run it only against a throwaway database:
#   PSQL="psql -d qula" supabase/tests/concurrency/last_amount.sh
set -euo pipefail
PSQL=${PSQL:-psql}
OWNER=c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1$(printf '%02d' $((RANDOM % 90 + 10)))
CLAIMS="select set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, false); set role authenticated;"

IDS=$($PSQL -qAt -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('$OWNER', 'owner-$OWNER@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
$CLAIMS
select set_config('test.org', (public.create_tenant('Last Amount $OWNER', 'Last Amount Office $OWNER'))->>'organisation_id', false);
select set_config('test.tenant', (select tenant_id::text from public.organisations where id = current_setting('test.org')::uuid), false);
insert into public.currencies (tenant_id, organisation_id, code, name, rate)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR', 'Euro', 1) on conflict (organisation_id, code) do nothing;
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '6000', 'Purchases', 'Expense');
insert into public.vat_rates (tenant_id, organisation_id, code, description, rate, vat_type, vat_category)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PZ', 'Zero', 0, 'Expense', 'Z');
insert into public.suppliers (tenant_id, organisation_id, code, name, currency_id, address_line1, city)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'VOD', 'Vodafone', id, 'Quay 4', 'Dublin'
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.bank_accounts (tenant_id, organisation_id, code, name, iban, currency_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'EUR1', 'Euro', 'IE29AIBK93115212345678', id
from public.currencies where organisation_id = current_setting('test.org')::uuid and code = 'EUR';
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', 'on_insert'),
       (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PAY', 'Supplier payment', 0, 'Purchases', 'payment', 'on_insert');
select set_config('test.invoice', public.save_document(jsonb_build_object(
  'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'),
  'supplierId', (select id from public.suppliers where organisation_id = current_setting('test.org')::uuid),
  'supplierReference', 'SUP-LAST', 'transactionDate', '2026-11-12', 'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Last 100', 'quantity', 1, 'price', 100,
    'glCodeId', (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid),
    'vatRateId', (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid)))
))::text, false);
select public.post_document(current_setting('test.invoice')::uuid, null);
-- Two posted payments of 100.00 each. The posting function comes later, so they are posted the way it will.
insert into public.payments (tenant_id, organisation_id, transaction_type_id, payment_date, supplier_id, bank_account_id, currency_id, exchange_rate, amount, party_name)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, type.id, '2026-11-12', supplier.id, bank.id, bank.currency_id, 1, 100, 'x'
from public.transaction_types as type, public.suppliers as supplier, public.bank_accounts as bank, generate_series(1, 2)
where type.organisation_id = current_setting('test.org')::uuid and type.code = 'PAY'
  and supplier.organisation_id = current_setting('test.org')::uuid and bank.organisation_id = current_setting('test.org')::uuid;
reset role;
select set_config('fintran.status_change', 'on', false);
update public.payments set status = 'posted', posted_at = now(), posted_by = '$OWNER' where organisation_id = current_setting('test.org')::uuid;
select 'IDS ' || (select string_agg(id::text, ' ' order by id) from public.payments where organisation_id = current_setting('test.org')::uuid)
  || ' ' || current_setting('test.invoice');
SQL
)
read -r _ PAY1 PAY2 INVOICE <<<"$(grep '^IDS ' <<<"$IDS")"

# Each session takes the whole 100.00, then holds its transaction open so the two overlap.
allocate() {
  $PSQL -qAt -v ON_ERROR_STOP=1 2>&1 <<SQL || true
$CLAIMS
begin;
select 'ALLOCATED ' || public.allocate('{"paymentId": "$1"}'::jsonb, '$INVOICE', 100, null);
select pg_sleep(2);
commit;
SQL
}
allocate "$PAY1" > /tmp/last_amount_a.out &
sleep 0.5
allocate "$PAY2" > /tmp/last_amount_b.out &
wait

ALLOCATED=$(cat /tmp/last_amount_a.out /tmp/last_amount_b.out | grep -c '^ALLOCATED ' || true)
REFUSED=$(cat /tmp/last_amount_a.out /tmp/last_amount_b.out | grep -c 'still due' || true)
DEADLOCK=$(cat /tmp/last_amount_a.out /tmp/last_amount_b.out | grep -ci 'deadlock' || true)
SETTLED=$($PSQL -qAt -c "select coalesce(sum(amount), 0) from public.allocations where target_header_id = '$INVOICE' and removed_at is null and not pending")
DUE=$($PSQL -qAt -c "select amount_due from public.transaction_headers where id = '$INVOICE'")
echo "allocated: $ALLOCATED, refused: $REFUSED, deadlocks: $DEADLOCK, allocated in total: $SETTLED, amount due: $DUE"
if [ "$ALLOCATED" = 1 ] && [ "$REFUSED" = 1 ] && [ "$DEADLOCK" = 0 ] && [ "$SETTLED" = "100.00" ] && [ "$DUE" = "0.00" ]; then
  echo "last amount ok"
else
  echo "last amount FAILED"; cat /tmp/last_amount_a.out /tmp/last_amount_b.out; exit 1
fi
