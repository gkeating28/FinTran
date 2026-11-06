import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { validateXml } from "./validate";
import { MAX_XML_BYTES } from "./xml";

test("a UBL invoice with elements in the wrong order is an XSD failure only", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:IssueDate>2026-11-06</cbc:IssueDate>
  <cbc:ID>1</cbc:ID>
</Invoice>`;
  const result = await validateXml(xml);
  const failure = result.results.find((item) => item.layer === "xsd" && item.severity === "fatal");
  assert.ok(failure);
  assert.match(failure.location ?? "", /line \d+, column \d+/);
  assert.equal(result.results.some((item) => item.layer !== "xsd"), false);
});

test("a 4 MB invoice passes full validation within the function limit", async () => {
  const source = readFileSync("einvoice/fixtures/sales-invoice.xml", "utf8");
  const marker = "</Invoice>";
  const room = MAX_XML_BYTES - Buffer.byteLength(source, "utf8") - Buffer.byteLength("<!--  -->", "utf8");
  const xml = source.replace(marker, `<!-- ${"x".repeat(room)} -->${marker}`);
  assert.ok(Buffer.byteLength(xml, "utf8") <= MAX_XML_BYTES);
  assert.ok(Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES - 16);
  const started = Date.now();
  const result = await validateXml(xml);
  const elapsed = Date.now() - started;
  assert.equal(result.results.filter((item) => item.layer === "xsd").map((item) => item.message).join("\n"), "");
  assert.ok(elapsed < 30_000, `validation took ${elapsed} ms`);
  console.log(`4 MB validation ${elapsed} ms`);
});

for (const name of readdirSync("einvoice/examples").filter((file) => file.endsWith(".xml"))) {
  test(`${name} passes XSD`, async () => {
    const xml = readFileSync(`einvoice/examples/${name}`, "utf8");
    const result = await validateXml(xml);
    assert.equal(result.results.filter((item) => item.layer === "xsd").map((item) => item.message).join("\n"), "");
  });
}

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
