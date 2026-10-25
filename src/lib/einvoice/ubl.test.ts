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
