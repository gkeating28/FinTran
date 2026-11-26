import assert from "node:assert/strict";
import test from "node:test";
import { menuItemFor, previousPage } from "./previous-page";

// Where Back goes when there is no record of where the person came from, as when a page is opened by its address. Each screen
// goes to the screen that leads to it. When there is a record, Back goes where the person came from (src/lib/nav-history.ts).
const PARENTS: [string, string | null][] = [
  ["/", null],
  ["/transactions", "/"],
  ["/transactions/PIN", "/transactions"],
  ["/payment-runs", "/transactions"],
  ["/customers", "/"],
  ["/suppliers", "/"],
  ["/e-documents", "/"],
  ["/e-documents/6f1c", "/e-documents"],
  ["/reports", "/"],
  ["/reports/aged-debtors", "/reports"],
  ["/reports/aged-creditors", "/reports"],
  ["/reports/general-ledger", "/reports"],
  ["/reports/trial-balance", "/reports"],
  ["/reports/trial-balance/abc", "/reports/trial-balance"],
  ["/transactions/journals", "/transactions"],
  ["/admin", "/"],
  ["/gl-codes", "/admin"],
  ["/departments", "/admin"],
  ["/cost-centres", "/admin"],
  ["/vat-rates", "/admin"],
  ["/currencies", "/admin"],
  ["/bank-accounts", "/admin"],
  ["/approval-rules", "/admin"],
  ["/transaction-types", "/admin"],
  ["/products", "/admin"],
  ["/organisations", "/admin"],
  ["/access", "/admin"],
  ["/history", "/admin"],
  ["/journal-export", "/admin"],
  ["/forms", "/admin"],
  ["/forms/PIN", "/forms"],
];

for (const [path, parent] of PARENTS) {
  test(`with no record, Back from ${path} goes to ${parent ?? "nowhere"}`, () => {
    assert.equal(previousPage(path), parent);
  });
}

// The menu item each screen sits under, so the menu shows where the person is.
const MENU: [string, string][] = [
  ["/", "/"],
  ["/transactions", "/transactions"],
  ["/transactions/PIN", "/transactions"],
  ["/payment-runs", "/transactions"],
  ["/customers", "/customers"],
  ["/suppliers", "/suppliers"],
  ["/e-documents", "/e-documents"],
  ["/e-documents/6f1c", "/e-documents"],
  ["/reports", "/reports"],
  ["/reports/aged-debtors", "/reports"],
  ["/admin", "/admin"],
  ["/gl-codes", "/admin"],
  ["/journal-export", "/admin"],
  ["/forms", "/admin"],
  ["/forms/PIN", "/admin"],
  ["/history", "/admin"],
];

for (const [path, item] of MENU) {
  test(`${path} sits under ${item} in the menu`, () => {
    assert.equal(menuItemFor(path), item);
  });
}
