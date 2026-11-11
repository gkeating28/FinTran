import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { buildXlsx, columnName, excelDate } from "./xlsx";

test("column names count past Z", () => {
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(26), "AA");
});

test("dates become Excel serial numbers", () => {
  assert.equal(excelDate("2026-01-01"), 46023);
  assert.equal(excelDate("nonsense"), null);
});

test("a workbook holds the header, typed cells and an autofilter", () => {
  const bytes = buildXlsx({
    sheet: "a/b:c",
    columns: [
      { label: "Name", type: "text" },
      { label: "Amount", type: "money" },
      { label: "Day", type: "date" },
    ],
    rows: [
      ["Fish & <Chips>", 12.5, "2026-01-01"],
      ["Blank", null, null],
    ],
  });
  const files = unzipSync(bytes);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /Fish &amp; &lt;Chips&gt;/);
  assert.match(sheet, /<v>12.5<\/v>/);
  assert.match(sheet, /<v>46023<\/v>/);
  assert.match(sheet, /<autoFilter ref="A1:C3"\/>/);
  assert.match(strFromU8(files["xl/workbook.xml"]), /name="a b c"/);
});

test("formula-like text is written as a plain string cell, never a formula", () => {
  const formula = '=HYPERLINK("http://example.com","x")';
  const bytes = buildXlsx({
    sheet: "Suppliers",
    columns: [
      { label: "=Name", type: "text" },
      { label: "Amount", type: "money" },
      { label: "Count", type: "number" },
      { label: "Day", type: "date" },
    ],
    rows: [
      [formula, -12.5, "=1+1", "=TODAY()"],
      ["-Minus Ltd", "-7", "+3", "@x"],
    ],
  });
  const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
  // No formula element anywhere, whatever the column type.
  assert.doesNotMatch(sheet, /<f[ >]/);
  assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;http:\/\/example.com&quot;,&quot;x&quot;\)<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="A3" t="inlineStr"><is><t xml:space="preserve">-Minus Ltd<\/t>/);
  // A negative amount stays a number.
  assert.match(sheet, /<c r="B2" s="2"><v>-12.5<\/v><\/c>/);
  assert.match(sheet, /<c r="B3" s="2"><v>-7<\/v><\/c>/);
  // Text in a number or date column falls back to a string cell.
  assert.match(sheet, /<c r="C2" t="inlineStr"><is><t xml:space="preserve">=1\+1<\/t>/);
  assert.match(sheet, /<c r="D2" t="inlineStr"><is><t xml:space="preserve">=TODAY\(\)<\/t>/);
  // Every cell with a value is either an inline string or a bare number.
  for (const cell of sheet.match(/<c [^>]*>/g) ?? []) assert.match(cell, /t="inlineStr"|^<c r="[A-Z]+\d+"(?: s="\d")?>$/);
});
