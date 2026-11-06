import assert from "node:assert/strict";
import test from "node:test";
import { postedEInvoiceError, shouldGenerateEInvoice } from "./posted-einvoice";

test("posting a sales invoice or credit note generates an e-invoice", () => {
  assert.equal(shouldGenerateEInvoice("Sales", "invoice"), true);
  assert.equal(shouldGenerateEInvoice("Sales", "credit_note"), true);
  assert.equal(shouldGenerateEInvoice("Sales", "order"), false);
  assert.equal(shouldGenerateEInvoice("Purchases", "invoice"), false);
});

test("a generation failure leaves a posted document and names the error", () => {
  assert.equal(
    postedEInvoiceError(new Error("schema")),
    "Posted, but the e-invoice was not stored. schema",
  );
});
