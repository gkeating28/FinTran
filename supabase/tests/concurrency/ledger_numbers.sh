#!/usr/bin/env bash
# Two people post an invoice in the same organisation at the same moment. Each posting makes a ledger entry, and the entries get
# consecutive numbers with no repeat. One waits for the other, and neither deadlocks.
#
# This needs two database sessions, so it cannot be a single rolled-back SQL file like the other tests.
# It COMMITS a small tenant, so run it only against a throwaway database:
#   PSQL="psql -d qula" supabase/tests/concurrency/ledger_numbers.sh
set -euo pipefail
PSQL=${PSQL:-psql}
OWNER=c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3$(printf '%02d' $((RANDOM % 90 + 10)))
CLAIMS="select set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, false); set role authenticated;"

IDS=$($PSQL -qAt -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('$OWNER', 'owner-$OWNER@fintran.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Owner"}'::jsonb);
$CLAIMS
select set_config('test.org', (public.create_tenant('Ledger Numbers $OWNER', 'Ledger Numbers Office $OWNER'))->>'organisation_id', false);
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
insert into public.transaction_types (tenant_id, organisation_id, code, description, last_reference, type, document_kind, numbering)
values (current_setting('test.tenant')::uuid, current_setting('test.org')::uuid, 'PI', 'Purchase invoice', 0, 'Purchases', 'invoice', 'on_insert');
create function pg_temp.draft(p_reference text) returns uuid language sql as \$\$
  select public.save_document(jsonb_build_object(
    'transactionTypeId', (select id from public.transaction_types where organisation_id = current_setting('test.org')::uuid and code = 'PI'),
    'supplierId', (select id from public.suppliers where organisation_id = current_setting('test.org')::uuid),
    'supplierReference', p_reference, 'transactionDate', '2026-11-12', 'exchangeRate', 1,
    'lines', jsonb_build_array(jsonb_build_object('description', 'Goods', 'quantity', 1, 'price', 100,
      'glCodeId', (select id from public.gl_codes where organisation_id = current_setting('test.org')::uuid and code = '6000'),
      'vatRateId', (select id from public.vat_rates where organisation_id = current_setting('test.org')::uuid)))))
\$\$;
select 'IDS ' || current_setting('test.org') || ' ' || pg_temp.draft('SUP-A') || ' ' || pg_temp.draft('SUP-B');
SQL
)
read -r _ ORG INVOICE_A INVOICE_B <<<"$(grep '^IDS ' <<<"$IDS")"

# Each session posts its invoice, then holds its transaction open so the two overlap.
post() {
  $PSQL -qAt -v ON_ERROR_STOP=1 2>&1 <<SQL || true
$CLAIMS
begin;
select public.post_document('$1', null);
select 'POSTED';
select pg_sleep(2);
commit;
SQL
}
post "$INVOICE_A" > /tmp/ledger_numbers_a.out &
sleep 0.5
post "$INVOICE_B" > /tmp/ledger_numbers_b.out &
wait

POSTED=$(cat /tmp/ledger_numbers_a.out /tmp/ledger_numbers_b.out | grep -c '^POSTED' || true)
DEADLOCK=$(cat /tmp/ledger_numbers_a.out /tmp/ledger_numbers_b.out | grep -ci 'deadlock' || true)
NUMBERS=$($PSQL -qAt -c "select string_agg(entry_number::text, ',' order by entry_number) from public.journal_entries where organisation_id = '$ORG'")
BALANCED=$($PSQL -qAt -c "select count(*) from public.journal_entries e where e.organisation_id = '$ORG' and (select sum(debit) - sum(credit) from public.journal_lines l where l.entry_id = e.id) <> 0")
echo "posted: $POSTED, deadlocks: $DEADLOCK, entry numbers: $NUMBERS, unbalanced: $BALANCED"
if [ "$POSTED" = 2 ] && [ "$DEADLOCK" = 0 ] && [ "$NUMBERS" = "1,2" ] && [ "$BALANCED" = 0 ]; then
  echo "ledger numbers ok"
else
  echo "ledger numbers FAILED"; cat /tmp/ledger_numbers_a.out /tmp/ledger_numbers_b.out; exit 1
fi
