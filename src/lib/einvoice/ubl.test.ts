import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateUbl, parseUbl } from "./ubl";

const fixtures = ["sales-invoice", "sales-credit-note", "sales-reverse-charge", "purchase-invoice"];

for (const name of fixtures) {
  test(`${name} survives a UBL round trip`, () => {
    const semantic = JSON.parse(readFileSync(`supabase/tests/fixtures/en16931/${name}.json`, "utf8"));
    const xml = generateUbl(semantic);
    assert.equal(xml, readFileSync(`einvoice/fixtures/${name}.xml`, "utf8"));
    assert.deepEqual(parseUbl(xml), semantic);
  });
}

test("a document-level charge is named and blocks import", () => {
  const semantic = parseUbl(`<?xml version="1.0"?>
    <Invoice xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
      <cbc:ID>1</cbc:ID>
      <cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:Amount>2.00</cbc:Amount></cac:AllowanceCharge>
    </Invoice>`);
  assert.deepEqual(semantic._unsupported, ["document charge"]);
});
