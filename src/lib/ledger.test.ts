import assert from "node:assert/strict";
import { test } from "node:test";
import { cents, drCr, emptyDraft, fromCents, groupTrialBalance, journalTotals, postingProblem, sourceHref, trialBalanceAgrees, yearToDate, type TrialRow } from "./ledger";

test("typed amounts become whole cents, and anything else is nothing", () => {
  assert.equal(cents("1,234.50"), 123450);
  assert.equal(cents("0.1"), 10);
  assert.equal(cents(""), 0);
  assert.equal(cents("abc"), 0);
  assert.equal(cents(12.345), 1235);
  assert.equal(fromCents(123450), "1234.50");
});

test("the live totals add debits and credits and show the difference", () => {
  const totals = journalTotals([{ debit: "80.00", credit: "" }, { debit: "20", credit: "" }, { debit: "", credit: "100.00" }]);
  assert.deepEqual(totals, { debit: 10000, credit: 10000, difference: 0 });
  assert.equal(journalTotals([{ debit: "0.10", credit: "" }, { debit: "", credit: "0.20" }]).difference, -10);
});

test("a draft says what stops it posting, in the order a person fixes it", () => {
  const draft = emptyDraft("2026-10-31");
  assert.equal(postingProblem({ ...draft, date: "" }), "Enter the date of the journal.");
  assert.equal(postingProblem(draft), "Enter a description.");
  assert.equal(postingProblem({ ...draft, description: "Accrual" }), "A journal needs at least two lines.");
  const lines = [
    { glCodeId: "a", debit: "10", credit: "", departmentId: "", costCentreId: "", description: "" },
    { glCodeId: "b", debit: "", credit: "9", departmentId: "", costCentreId: "", description: "" },
  ];
  assert.equal(postingProblem({ ...draft, description: "Accrual", lines }), "The journal is out by 1.00.");
  assert.equal(postingProblem({ ...draft, description: "Accrual", lines: [lines[0], { ...lines[1], glCodeId: "" }] }), "Line 2: choose a GL code.");
  assert.equal(postingProblem({ ...draft, description: "Accrual", lines: [lines[0], { ...lines[1], debit: "5", credit: "5" }] }), "Line 2: enter either a debit or a credit.");
  assert.equal(postingProblem({ ...draft, description: "Accrual", lines: [lines[0], { ...lines[1], credit: "10" }] }), null);
});

test("a source opens its document or payment, and a manual journal has none", () => {
  assert.equal(sourceHref({ typeCode: "SI", openId: "abc" }), "/transactions/SI?open=abc");
  assert.equal(sourceHref({ typeCode: null, openId: null }), null);
});

const row = (code: string, accountType: string, opening: number, debit: number, credit: number): TrialRow => ({
  glCodeId: code, code, description: code, accountType, opening, debit, credit, closing: opening + debit - credit,
});

test("the trial balance is grouped by report section with totals that agree", () => {
  const { sections, totals } = groupTrialBalance([
    row("1100", "Current Asset", 0, 123, 0),
    row("2200", "Current Liability", 0, 0, 23),
    row("4000", "Income", 0, 0, 100),
    row("6000", "Expense", 0, 0, 0),
  ]);
  assert.deepEqual(sections.map((section) => section.title), ["Assets", "Liabilities", "Income", "Cost of sales and expenses"]);
  assert.deepEqual(totals, { opening: 0, debit: 12300, credit: 12300, closing: 0 });
  assert.equal(trialBalanceAgrees(totals), true);
  assert.equal(trialBalanceAgrees({ debit: 100, credit: 99, closing: 1 }), false);
});

test("cents do not drift when many rows are added", () => {
  const rows = Array.from({ length: 10 }, (_, index) => row(`R${index}`, "Expense", 0, 0.1, 0));
  assert.equal(groupTrialBalance(rows).totals.debit, 100);
});

test("a balance is read as debit or credit", () => {
  assert.equal(drCr(12345), "123.45 Dr");
  assert.equal(drCr(-5), "0.05 Cr");
  assert.equal(drCr(0), "0.00");
});

test("the trial balance opens on this year so far", () => {
  assert.deepEqual(yearToDate("2026-11-26"), { from: "2026-01-01", to: "2026-11-26" });
});
