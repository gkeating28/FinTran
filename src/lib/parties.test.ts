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
