import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPaymentLayout,
  parsePaymentLayout,
  paymentHeaderFieldLabel,
  paymentLineColumnLabel,
  paymentTitle,
  settlesInvoices,
  withRequiredPaymentFields,
} from "./payment-form-layout";

test("the standard layout is a remittance advice for money out and a receipt for money in", () => {
  assert.equal(defaultPaymentLayout("payment").title, "Remittance advice");
  assert.equal(defaultPaymentLayout("receipt").title, "Receipt");
  assert.equal(paymentTitle("receipt"), "Receipt");
  assert.deepEqual(defaultPaymentLayout("payment").lineColumns, ["document", "date", "total", "applied"]);
});

test("a saved layout is read back in its own order, without fields a payment cannot show", () => {
  const layout = parsePaymentLayout(
    {
      version: 1,
      title: "  Paid  ",
      pageSize: "A5",
      showLogo: false,
      organisationFields: ["name", "vatNumber", "nonsense", "name"],
      partyFields: ["name", "phone"],
      headerFields: ["transactionDate", "documentNumber", "dueDate"],
      lineColumns: ["applied", "document", "quantity"],
    },
    "payment",
  );
  assert.equal(layout.title, "Paid");
  assert.equal(layout.pageSize, "A5");
  assert.equal(layout.showLogo, false);
  assert.deepEqual(layout.organisationFields, ["name", "vatNumber"]);
  assert.deepEqual(layout.partyFields, ["name"]);
  assert.deepEqual(layout.headerFields, ["transactionDate", "documentNumber"]);
  assert.deepEqual(layout.lineColumns, ["applied", "document"]);
});

test("nothing saved, or something unreadable, gives the standard layout", () => {
  assert.deepEqual(parsePaymentLayout(null, "receipt"), defaultPaymentLayout("receipt"));
  assert.deepEqual(parsePaymentLayout("text", "payment"), defaultPaymentLayout("payment"));
  const partial = parsePaymentLayout({ title: "" }, "payment");
  assert.equal(partial.title, "Remittance advice");
  assert.deepEqual(partial.headerFields, defaultPaymentLayout("payment").headerFields);
});

test("what the database requires is put back before a layout is saved", () => {
  const stripped = withRequiredPaymentFields({
    ...defaultPaymentLayout("payment"),
    organisationFields: ["address"],
    partyFields: ["address"],
    headerFields: ["currency"],
    lineColumns: ["date"],
  });
  assert.deepEqual(stripped.organisationFields, ["address", "name"]);
  assert.deepEqual(stripped.partyFields, ["address", "name"]);
  assert.deepEqual(stripped.headerFields, ["currency", "documentNumber", "transactionDate"]);
  assert.deepEqual(stripped.lineColumns, ["date", "document", "applied"]);
});

test("labels say which way the money moved and what the payment settled", () => {
  assert.equal(paymentHeaderFieldLabel("bankAccount", "payment"), "Paid from");
  assert.equal(paymentHeaderFieldLabel("bankAccount", "receipt"), "Paid into");
  assert.equal(paymentLineColumnLabel("document", "invoices"), "Invoice");
  assert.equal(paymentLineColumnLabel("document", "credit notes"), "Credit note");
  assert.equal(settlesInvoices("payment", "Purchases"), true);
  assert.equal(settlesInvoices("receipt", "Sales"), true);
  assert.equal(settlesInvoices("payment", "Sales"), false);
  assert.equal(settlesInvoices("receipt", "Purchases"), false);
});
