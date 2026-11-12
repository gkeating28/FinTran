#!/usr/bin/env bash
# Runs every SQL test in supabase/tests against a database built from supabase/migrations.
# Each test raises an error when a rule is broken and rolls back, so a database can be reused.
#
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres scripts/run-sql-tests.sh
set -uo pipefail
DATABASE_URL=${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}

# Tests written for an earlier shape of the schema. They fail for that reason and not because a rule is broken.
# Each needs rewriting or removing. They are listed here so the gap stays visible.
STALE="en16931_phase4.sql phase3.sql"

failed=0
for file in supabase/tests/*.sql; do
  name=$(basename "$file")
  output=$(psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$file" 2>&1)
  if grep -q "ERROR" <<<"$output"; then
    if grep -qw "$name" <<<"$STALE"; then
      echo "stale  $name"
    else
      echo "FAIL   $name"
      grep -m1 -A3 "ERROR" <<<"$output" | sed 's/^/         /'
      failed=1
    fi
  else
    if grep -qw "$name" <<<"$STALE"; then
      echo "FAIL   $name is listed as stale but passes. Take it off the list in scripts/run-sql-tests.sh."
      failed=1
    else
      echo "ok     $name"
    fi
  fi
done

# Two people invoicing the last unit of an order line at once. It needs two sessions and commits a small tenant.
if PSQL="psql $DATABASE_URL" bash supabase/tests/concurrency/last_unit.sh >/tmp/last_unit.log 2>&1; then
  echo "ok     concurrency/last_unit.sh"
else
  echo "FAIL   concurrency/last_unit.sh"
  sed 's/^/         /' /tmp/last_unit.log
  failed=1
fi
exit $failed
