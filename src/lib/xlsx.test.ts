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
