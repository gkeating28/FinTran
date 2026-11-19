import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCsv } from "@/lib/export/safe-cell";
import { JOURNAL_COLUMNS, groupJournals, journalCsvRows, journalsOlderThanAYear, parseUpTo, problemLink, type BatchDownloadLine, type JournalLine } from "@/lib/journal";

function line(overrides: Partial<JournalLine>): JournalLine {
  return {
    journalNumber: 1,
    lineNumber: 1,
    journalDate: "2026-11-10",
    accountCode: "6000",
    accountName: "Purchases",
    accountRole: "line",
    description: "Goods",
    debit: "100.00",
    credit: "0.00",
    currencyCode: "EUR",
    amountInCurrency: "100.00",
    departmentCode: null,
    costCentreCode: null,
    sourceKind: "purchase invoice",
    sourceNumber: "PIN-1",
    party: "Vodafone",
    sourceRef: "document",
    sourceId: "a",
    stage: "post",
    ...overrides,
  };
}

test("lines are gathered into journals with their totals", () => {
  const groups = groupJournals([
    line({ journalNumber: 2, lineNumber: 3, debit: "0.00", credit: "30.00" }),
    line({ journalNumber: 1, lineNumber: 1 }),
    line({ journalNumber: 1, lineNumber: 2, accountCode: "2100", debit: "0.00", credit: "100.00" }),
  ]);
  assert.deepEqual(groups.map((group) => group.journalNumber), [1, 2]);
  assert.equal(groups[0].debit, 100);
  assert.equal(groups[0].credit, 100);
  assert.equal(groups[0].lines.length, 2);
});

test("the file has a header row and two decimals, and text that could run as a formula is made safe", () => {
  const download: BatchDownloadLine = {
    journal_number: "JB-0001-0001",
    journal_date: "2026-11-10",
    account_code: "6000",
    account_name: "Purchases",
    description: "=HYPERLINK(1)",
    debit: 100,
    credit: "0",
    currency_code: "EUR",
    amount_in_currency: 100,
    department_code: null,
    cost_centre_code: null,
    source_kind: "purchase invoice",
    source_number: "PIN-1",
    party: "Vodafone",
    batch_number: "JB-0001",
  };
  const csv = buildCsv(JOURNAL_COLUMNS, journalCsvRows([download]));
  const [header, row] = csv.split("\r\n");
  assert.equal(header.split(",").length, 15);
  assert.match(row, /"100\.00","0\.00"/);
  assert.match(row, /"'=HYPERLINK\(1\)"/);
});

test("journals older than a year are counted from the export date", () => {
  const groups = groupJournals([line({ journalNumber: 1, journalDate: "2025-11-09" }), line({ journalNumber: 2, journalDate: "2025-11-11" })]);
  assert.equal(journalsOlderThanAYear(groups, "2026-11-10"), 1);
});

test("a problem links to where it is fixed", () => {
  const base = { sourceRef: "document" as const, sourceId: "a", sourceKind: "purchase invoice", sourceNumber: "PIN-1", party: null };
  assert.equal(problemLink({ ...base, message: "The payables account is not set in the accounting settings" }).href, "/accounting");
  assert.equal(problemLink({ ...base, message: "Bank account EUR1 has no GL code" }).href, "/bank-accounts");
});

test("the date defaults to today when it is missing or not a date", () => {
  assert.equal(parseUpTo(undefined, "2026-11-20"), "2026-11-20");
  assert.equal(parseUpTo("tomorrow", "2026-11-20"), "2026-11-20");
  assert.equal(parseUpTo("2026-12-31", "2026-11-20"), "2026-12-31");
});
