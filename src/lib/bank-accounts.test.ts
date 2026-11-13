import assert from "node:assert/strict";
import test from "node:test";
import { formatIban, parseBankAccountForm } from "./bank-accounts";

const ID = "11111111-1111-4111-8111-111111111111";
const good = {
  code: " main ",
  name: " Main account ",
  iban: "ie29 aibk 9311 5212 3456 78",
  bic: "aibk ie2d",
  currencyId: ID,
  glCodeId: "",
  active: true,
  isDefault: true,
};

test("a bank account form is trimmed, uppercased and stripped of spaces", () => {
  const parsed = parseBankAccountForm(good);
  assert.ok("fields" in parsed);
  assert.equal(parsed.fields.code, "MAIN");
  assert.equal(parsed.fields.name, "Main account");
  assert.equal(parsed.fields.iban, "IE29AIBK93115212345678");
  assert.equal(parsed.fields.bic, "AIBKIE2D");
  assert.equal(parsed.fields.gl_code_id, null);
});

test("a BIC is optional, an IBAN is not", () => {
  const noBic = parseBankAccountForm({ ...good, bic: "" });
  assert.ok("fields" in noBic);
  assert.equal(noBic.fields.bic, null);
  assert.deepEqual(parseBankAccountForm({ ...good, iban: "" }), { error: "Enter a valid IBAN." });
  assert.deepEqual(parseBankAccountForm({ ...good, bic: "ABC123" }), { error: "Enter a BIC of 8 or 11 characters." });
});

test("a code, a name and a currency are required", () => {
  assert.ok("error" in parseBankAccountForm({ ...good, code: "" }));
  assert.ok("error" in parseBankAccountForm({ ...good, name: "x".repeat(101) }));
  assert.deepEqual(parseBankAccountForm({ ...good, currencyId: "" }), { error: "Choose a currency." });
});

test("an inactive account cannot be the default", () => {
  assert.deepEqual(parseBankAccountForm({ ...good, active: false, isDefault: true }), {
    error: "An inactive account cannot be the default.",
  });
  assert.ok("fields" in parseBankAccountForm({ ...good, active: false, isDefault: false }));
});

test("an IBAN is shown in groups of four", () => {
  assert.equal(formatIban("IE29AIBK93115212345678"), "IE29 AIBK 9311 5212 3456 78");
});
