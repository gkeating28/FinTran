import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateUbl, ORDER_PLACEHOLDER, parseUbl } from "./ubl";
import { validateXml } from "./validate";

/**
 * Order references in Peppol BIS Billing 3.0, one golden file per case. Each case was checked against the Peppol syntax
 * guide and the 3.0.21 Schematron in `einvoice/rules`:
 *
 * - cac:OrderReference/cbc:ID is BT-13 and is mandatory inside cac:OrderReference.
 * - cbc:SalesOrderID is BT-14. With BT-14 and no BT-13 the guide says to set cbc:ID to "NA".
 * - cac:OrderLineReference/cbc:LineID is BT-132. No document-level order reference is needed with it, except for a
 *   supplier in the Netherlands (NL-R-009).
 */
const cases: { name: string; what: string; expected: RegExp; absent?: RegExp }[] = [
  { name: "order-buyer-only", what: "a buyer order number only (BT-13)", expected: /<cac:OrderReference><cbc:ID>PO-7781<\/cbc:ID><\/cac:OrderReference>/, absent: /SalesOrderID/ },
  { name: "order-sales-only", what: "a sales order number only (BT-14)", expected: /<cac:OrderReference><cbc:ID>NA<\/cbc:ID><cbc:SalesOrderID>SO-0042<\/cbc:SalesOrderID><\/cac:OrderReference>/ },
  { name: "order-both", what: "both order numbers", expected: /<cac:OrderReference><cbc:ID>PO-7781<\/cbc:ID><cbc:SalesOrderID>SO-0042<\/cbc:SalesOrderID><\/cac:OrderReference>/ },
  { name: "order-line-reference", what: "a line order reference (BT-132)", expected: /<cac:OrderLineReference><cbc:LineID>10<\/cbc:LineID><\/cac:OrderLineReference>/, absent: /<cac:OrderReference>/ },
];

function semanticOf(name: string) {
  return JSON.parse(readFileSync(`supabase/tests/fixtures/en16931/${name}.json`, "utf8")) as Record<string, unknown>;
}

for (const item of cases) {
  test(`${item.what} matches its golden UBL and passes XSD, EN 16931 and Peppol validation`, async () => {
    const semantic = semanticOf(item.name);
    const golden = readFileSync(`einvoice/fixtures/${item.name}.xml`, "utf8");
    const xml = generateUbl(semantic as never);
    assert.equal(xml, golden);
    assert.match(xml, item.expected);
    if (item.absent) assert.doesNotMatch(xml, item.absent);
    assert.deepEqual(parseUbl(xml), semantic);

    const result = await validateXml(golden);
    // Not one finding from any layer, warnings included.
    assert.deepEqual(result.results.map((finding) => `${finding.layer} ${finding.ruleId ?? ""} ${finding.message}`), []);
  });
}

test("a sales invoice from a sales order with no customer order number validates, and reads back with no buyer order number", async () => {
  const semantic = semanticOf("order-sales-only");
  assert.equal(semantic["BT-13"], undefined);
  assert.equal(semantic["BT-14"], "SO-0042");
  const xml = generateUbl(semantic as never);
  assert.equal((await validateXml(xml)).results.filter((finding) => finding.severity === "fatal").length, 0);
  const parsed = parseUbl(xml);
  assert.equal(parsed["BT-13"] ?? null, null, "the placeholder is read as no buyer order number");
  assert.equal(parsed["BT-14"], "SO-0042");
});

test("an inbound file with the placeholder gives a null buyer order number, and a real number is kept", () => {
  assert.equal(ORDER_PLACEHOLDER, "NA");
  const golden = readFileSync("einvoice/fixtures/order-sales-only.xml", "utf8");
  assert.equal(parseUbl(golden)["BT-13"] ?? null, null);
  // The placeholder alone, with no sales order number, is still no buyer order number.
  const alone = golden.replace("<cbc:SalesOrderID>SO-0042</cbc:SalesOrderID>", "");
  assert.equal(parseUbl(alone)["BT-13"] ?? null, null);
  assert.equal(parseUbl(alone)["BT-14"] ?? null, null);
  assert.equal(parseUbl(golden.replace("<cbc:ID>NA</cbc:ID><cbc:SalesOrderID>", "<cbc:ID>NA-17</cbc:ID><cbc:SalesOrderID>"))["BT-13"], "NA-17");
});

test("a supplier in the Netherlands gets a document-level order reference with a line order reference (NL-R-009)", async () => {
  const semantic = semanticOf("order-line-reference") as Record<string, Record<string, Record<string, unknown>>>;
  semantic["BG-4"]["BG-5"]["BT-40"] = "NL";
  const xml = generateUbl(semantic as never);
  assert.match(xml, /<cac:OrderReference><cbc:ID>NA<\/cbc:ID><\/cac:OrderReference>/);
  const rules = (text: string) => validateXml(text).then((result) => result.results.map((finding) => finding.ruleId));
  assert.ok(!(await rules(xml)).includes("NL-R-009"));
  // Without it the same file breaks the rule, which shows the reference is what satisfies it.
  assert.ok((await rules(xml.replace("<cac:OrderReference><cbc:ID>NA</cbc:ID></cac:OrderReference>", ""))).includes("NL-R-009"));
  // With a real order number that number is used, and elsewhere no reference is added.
  semantic["BT-13"] = "PO-7781" as never;
  assert.match(generateUbl(semantic as never), /<cac:OrderReference><cbc:ID>PO-7781<\/cbc:ID><\/cac:OrderReference>/);
});

test("the validator reports a Schematron failure, so a clean result means something", async () => {
  // Without a buyer reference or an order reference, Peppol rule R003 fails. A validator that could not see that
  // would pass every file, and the golden files above would prove nothing.
  const golden = readFileSync("einvoice/fixtures/sales-invoice.xml", "utf8");
  const broken = golden.replace("<cbc:BuyerReference>PO-44</cbc:BuyerReference>", "");
  assert.notEqual(broken, golden);
  const findings = (await validateXml(broken)).results;
  assert.deepEqual(findings.map((finding) => `${finding.layer} ${finding.ruleId} ${finding.severity}`), ["peppol PEPPOL-EN16931-R003 fatal"]);
  // The same file with only the placeholder order reference satisfies the rule.
  const placeholder = broken.replace("<cac:AccountingSupplierParty>", "<cac:OrderReference><cbc:ID>NA</cbc:ID></cac:OrderReference><cac:AccountingSupplierParty>");
  assert.deepEqual((await validateXml(placeholder)).results, []);

  // An EN 16931 rule is reported too: an amount due that does not add up breaks BR-CO-16.
  const wrongTotal = golden.replace('<cbc:PayableAmount currencyID="EUR">279.10</cbc:PayableAmount>', '<cbc:PayableAmount currencyID="EUR">1.00</cbc:PayableAmount>');
  assert.notEqual(wrongTotal, golden);
  const layers = (await validateXml(wrongTotal)).results.map((finding) => `${finding.layer} ${finding.ruleId}`);
  assert.ok(layers.includes("en16931 BR-CO-16"), layers.join(", "));
});

for (const name of ["sales-invoice", "sales-credit-note", "sales-reverse-charge"]) {
  test(`the golden ${name} passes EN 16931 and Peppol validation with no findings`, async () => {
    const result = await validateXml(readFileSync(`einvoice/fixtures/${name}.xml`, "utf8"));
    assert.deepEqual(result.results.map((finding) => `${finding.layer} ${finding.ruleId} ${finding.message}`), []);
  });
}
