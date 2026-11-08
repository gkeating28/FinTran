import assert from "node:assert/strict";
import test from "node:test";
import { explainIssue } from "./rule-help";

test("a known readiness rule says what to change and where", () => {
  const help = explainIssue({ ruleId: "PEPPOL-EN16931-R020", businessTerm: "BT-34", direction: "Sales" });
  assert.equal(help?.href, "/organisations");
  assert.match(help?.fix ?? "", /Peppol/);
  assert.equal(explainIssue({ ruleId: "PEPPOL-EN16931-R010", businessTerm: "BT-49", direction: "Sales" })?.href, "/customers");
  assert.equal(explainIssue({ ruleId: "BR-S-02", businessTerm: "BT-31", direction: "Purchases" })?.href, "/suppliers");
});

test("rules that are not listed fall back to their family, and unknown ones give nothing", () => {
  assert.match(explainIssue({ ruleId: "BR-CL-23", direction: "Purchases" })?.title ?? "", /allowed list/);
  assert.match(explainIssue({ ruleId: "BR-CO-99", direction: "Purchases" })?.title ?? "", /add up/);
  assert.equal(explainIssue({ ruleId: "BR-E-10", direction: "Sales" })?.href, "/vat-rates");
  assert.match(explainIssue({ ruleId: "SCHEMATRON", layer: "xsd", direction: "Purchases" })?.title ?? "", /not a valid/);
  assert.equal(explainIssue({ ruleId: "SOMETHING-ELSE", direction: "Sales" }), null);
});
