import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateXml } from "./validate";

test("a UBL invoice with elements in the wrong order is an XSD failure only", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:IssueDate>2026-11-06</cbc:IssueDate>
  <cbc:ID>1</cbc:ID>
</Invoice>`;
  const result = await validateXml(xml);
  assert.ok(result.results.some((item) => item.layer === "xsd" && item.severity === "fatal"));
  assert.equal(result.results.some((item) => item.layer !== "xsd"), false);
});

for (const name of ["sales-invoice", "sales-credit-note", "sales-reverse-charge"]) {
  test(`${name} passes XSD`, async () => {
    const xml = readFileSync(`einvoice/fixtures/${name}.xml`, "utf8");
    const result = await validateXml(xml);
    assert.equal(
      result.results.filter((item) => item.layer === "xsd").map((item) => item.message).join("\n"),
      "",
    );
  });
}
