import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { validateXsd } from "../src/lib/einvoice/xsd.ts";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log("No stored e-documents were passed in, and this environment has no database connection. No records were changed.");
  console.log("Pass XML files to report XSD failures: node scripts/xsd-report.mjs path/to/file.xml");
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const xml = readFileSync(file, "utf8");
  const root = xml.includes("CreditNote") && !xml.includes("<Invoice") ? "CreditNote" : "Invoice";
  const started = Date.now();
  const errors = await validateXsd(xml, root);
  const elapsed = Date.now() - started;
  if (errors.length === 0) console.log(`${path.basename(file)} passed in ${elapsed} ms (${statSync(file).size} bytes)`);
  else {
    failed += 1;
    console.log(`${path.basename(file)} ${errors.length} XSD failure(s) in ${elapsed} ms`);
    for (const error of errors.slice(0, 5)) console.log(`  ${error.location ?? ""} ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
