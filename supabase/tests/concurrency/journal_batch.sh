#!/usr/bin/env bash
# Two people create a journal batch at the same moment. One makes the batch and the other, which waits for the first to
# finish, finds nothing left to export. Nothing is exported twice and neither deadlocks.
#
# This needs two database sessions, so it cannot be a single rolled-back SQL file like the other tests.
# It COMMITS a small tenant, so run it only against a throwaway database:
#   PSQL="psql -d qula" supabase/tests/concurrency/journal_batch.sh
set -euo pipefail
PSQL=${PSQL:-psql}
OWNER=c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2$(printf '%02d' $((RANDOM % 90 + 10)))
CLAIMS="select set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, false); set role authenticated;"

IDS=$($PSQL -qAt -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('$OWNER', 'owner-$OWNER@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
$CLAIMS
select set_config('test.org', (public.create_tenant('Journal Batch $OWNER', 'Journal Batch Office $OWNER'))->>'organisation_id', false);
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
  'supplierReference', 'SUP-JOURNAL', 'transactionDate', '2026-11-12', 'exchangeRate', 1,
  'lines', jsonb_build_array(jsonb_build_object('description', 'Last 100', 'quantity', 1, 'price', 100,
    'glCodeId', (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid),
    'vatRateId', (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid)))
))::text, false);
select public.post_document(current_setting('test.invoice')::uuid, null);
-- The accounts the journal needs, and a GL code on the bank account.
insert into public.gl_codes (tenant_id, organisation_id, code, description, account_type)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, '2100', 'Trade creditors', 'Current Liability');
insert into public.accounting_settings (tenant_id, organisation_id, payables_gl_code_id)
select current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, id from public.gl_codes
where organisation_id = current_setting('test.org')::uuid and code = '2100';
reset role;
select 'IDS ' || current_setting('test.org') || ' ' || current_setting('test.invoice');
SQL
)
read -r _ ORG INVOICE <<<"$(grep '^IDS ' <<<"$IDS")"

# Each session makes the batch, then holds its transaction open so the two overlap.
batch() {
  $PSQL -qAt -v ON_ERROR_STOP=1 2>&1 <<SQL || true
$CLAIMS
begin;
select 'MADE ' || public.create_journal_batch('$ORG', '2026-12-31');
select pg_sleep(2);
commit;
SQL
}
batch > /tmp/journal_batch_a.out &
sleep 0.5
batch > /tmp/journal_batch_b.out &
wait

MADE=$(cat /tmp/journal_batch_a.out /tmp/journal_batch_b.out | grep -c '^MADE ' || true)
EMPTY=$(cat /tmp/journal_batch_a.out /tmp/journal_batch_b.out | grep -c 'nothing to export' || true)
DEADLOCK=$(cat /tmp/journal_batch_a.out /tmp/journal_batch_b.out | grep -ci 'deadlock' || true)
BATCHES=$($PSQL -qAt -c "select count(*) from public.journal_batches where organisation_id = '$ORG'")
EXPORTS=$($PSQL -qAt -c "select count(*) from public.journal_exports where source_id = '$INVOICE'")
echo "made: $MADE, found nothing: $EMPTY, deadlocks: $DEADLOCK, batches: $BATCHES, times the invoice was exported: $EXPORTS"
if [ "$MADE" = 1 ] && [ "$EMPTY" = 1 ] && [ "$DEADLOCK" = 0 ] && [ "$BATCHES" = 1 ] && [ "$EXPORTS" = 1 ]; then
  echo "journal batch ok"
else
  echo "journal batch FAILED"; cat /tmp/journal_batch_a.out /tmp/journal_batch_b.out; exit 1
fi
