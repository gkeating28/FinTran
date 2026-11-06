import assert from "node:assert/strict";
import test from "node:test";
import { ibanChanged, paymentTermsDays, suggestSupplierCode } from "./supplier-from-invoice";

test("suggests a supplier code and adds a suffix when it is taken", () => {
  assert.equal(suggestSupplierCode("Northwind Traders", []), "NORTHWINDT");
  assert.equal(suggestSupplierCode("Northwind Traders", ["NORTHWINDT"]), "NORTHWIND2");
});

test("counts payment terms from the issue date to the due date", () => {
  assert.equal(paymentTermsDays("2026-11-01", "2026-12-01"), "30");
  assert.equal(paymentTermsDays("", "2026-12-01"), "");
});

test("warns when the seller IBAN differs from the last imported file", () => {
  assert.equal(ibanChanged("IE29 AIBK 9311 5212 3456 78", "IE29AIBK93115212345678"), false);
  assert.equal(ibanChanged("IE29AIBK93115212345678", "IE64IRCE92050112345678"), true);
  assert.equal(ibanChanged(null, "IE64IRCE92050112345678"), false);
});
