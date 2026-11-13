import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { buildCsv, csvField, isPlainNumber, safeText } from "./safe-cell";

test("text that a spreadsheet would run as a formula gets a leading apostrophe", () => {
  for (const text of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=1+1", "\r=1+1", "-Minus Ltd", "-", "--5", "+353 1 234 5678"]) {
    assert.equal(safeText(text), `'${text}`, text);
  }
  for (const text of ["Acme Ltd", "a=b", "12.50", " =1+1", ""]) assert.equal(safeText(text), text, text);
});

test("a negative number is left as a number", () => {
  for (const text of ["-12.00", "-7", "-1,234.50", "-0.5"]) {
    assert.ok(isPlainNumber(text), text);
    assert.equal(safeText(text), text);
  }
  for (const text of ["-1+1", "-1,2", "-.5", "-1e5", "-€5.00", "- 5", "-5%"]) assert.ok(!isPlainNumber(text), text);
  assert.equal(csvField(-12.5), '"-12.5"');
});

test("every field is quoted and quotes are doubled", () => {
  assert.equal(csvField('Say "hi", Ltd'), '"Say ""hi"", Ltd"');
  assert.equal(csvField(null), '""');
  assert.equal(csvField("line\nbreak"), '"line\nbreak"');
});

test("a supplier named as a formula exports as text", () => {
  const formula = '=HYPERLINK("http://example.com","x")';
  const csv = buildCsv(["Supplier", "Total"], [[formula, -45], ["-Minus Ltd", "-12.00"]]);
  assert.equal(
    csv,
    '"Supplier","Total"\r\n' + `"'=HYPERLINK(""http://example.com"",""x"")","-45"\r\n` + `"'-Minus Ltd","-12.00"`,
  );
});

test("a formula-like column heading is made safe too", () => {
  assert.equal(buildCsv(["=Party"], []), `"'=Party"`);
});

test("Ask Qula's table download goes through the same helper", () => {
  // The Ask Qula table hands its columns and rows, all text, straight to downloadCsv, which calls buildCsv.
  const block = { columns: ["Party", "Total"], rows: [["=SUM(A1)", "-12.00"], ["@cmd", "5.00"]] };
  assert.equal(buildCsv(block.columns, block.rows), `"Party","Total"\r\n"'=SUM(A1)","-12.00"\r\n"'@cmd","5.00"`);
});

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("no export bypasses the helpers", () => {
  const root = join(process.cwd(), "src");
  // Only the download helper may name a spreadsheet file type or hand the browser a file to save.
  const marks = /text\/csv|spreadsheetml\.sheet"|application\/vnd\.ms-excel|\.download\s*=/;
  const found = sources(root)
    .filter((path) => marks.test(readFileSync(path, "utf8")))
    .map((path) => relative(root, path).replace(/\\/g, "/"))
    .sort();
  assert.deepEqual(found, ["lib/export/download.ts"]);
  // The table block that offers the CSV download is in the Ask Qula answer component.
  const askQula = readFileSync(join(root, "components/ask-qula/Answer.tsx"), "utf8");
  const grid = readFileSync(join(root, "components/GridExport.tsx"), "utf8");
  assert.match(askQula, /downloadCsv\(/);
  assert.match(grid, /downloadXlsx\(/);
});
