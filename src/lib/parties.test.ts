import assert from "node:assert/strict";
import test from "node:test";
import { emptyPostalAddress } from "./address";
import { parseParty } from "./parties";

const currencyId = "11111111-1111-4111-8111-111111111111";

function party(overrides: { code?: string; name?: string }) {
  return parseParty({
    code: overrides.code ?? "NOR001",
    name: overrides.name ?? "Northwind Traders",
    currencyId,
    phone: "",
    email: "",
    website: "",
    address: emptyPostalAddress,
    contactDetails: "",
    notes: "",
    vatNumber: "",
    companyNumber: "",
    peppolScheme: "",
    peppolId: "",
    paymentTermsDays: "",
    defaultBuyerReference: "",
  });
}

test("an empty supplier name is not reported as a bad code", () => {
  const result = party({ name: "" });
  assert.equal("error" in result && result.error, "Enter a name.");
});

test("NOR001 is a valid supplier code", () => {
  const result = party({ code: "NOR001" });
  assert.equal("error" in result, false);
});

function withBank(bank: { iban?: string; bic?: string; bankAccountName?: string }) {
  return parseParty({
    code: "VOD",
    name: "Vodafone",
    currencyId,
    phone: "",
    email: "",
    website: "",
    address: emptyPostalAddress,
    contactDetails: "",
    notes: "",
    vatNumber: "",
    companyNumber: "",
    peppolScheme: "",
    peppolId: "",
    paymentTermsDays: "",
    defaultBuyerReference: "",
    ...bank,
  });
}

test("bank details are optional, trimmed, and left to the database to check", () => {
  const none = withBank({});
  assert.ok(!("error" in none));
  if (!("error" in none)) assert.deepEqual([none.iban, none.bic, none.bankAccountName], [null, null, null]);
  const some = withBank({ iban: " ie29 aibk 9311 5212 3456 78 ", bic: " aibkie2d ", bankAccountName: "  Vodafone  " });
  assert.ok(!("error" in some));
  if (!("error" in some)) assert.deepEqual([some.iban, some.bic, some.bankAccountName], ["ie29 aibk 9311 5212 3456 78", "aibkie2d", "Vodafone"]);
  assert.equal("error" in withBank({ iban: "x".repeat(43) }), true);
  assert.equal("error" in withBank({ bankAccountName: "x".repeat(141) }), true);
});

test("a bank change is described without printing the whole IBAN", async () => {
  const { bankChangeSummary } = await import("./parties");
  const summary = bankChangeSummary({ old_iban: "IE29AIBK93115212345678", new_iban: "GB29NWBK60161331926819", old_bic: null, new_bic: null, old_account_name: "A", new_account_name: "B" });
  assert.equal(summary, "IBAN IE29…5678 to GB29…6819, account name");
});
