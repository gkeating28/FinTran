import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateXML, type XMLFileInfo } from "xmllint-wasm";
import type { ValidationFailure } from "./validate";

const DIRECTORY = path.join(process.cwd(), "einvoice/rules/3.0.21/xsd");

let preloaded: XMLFileInfo[] | null = null;

function schemaFiles(): XMLFileInfo[] {
  if (preloaded) return preloaded;
  const files: XMLFileInfo[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".xsd")) {
        files.push({
          fileName: path.relative(DIRECTORY, full).split(path.sep).join("/"),
          contents: readFileSync(full),
        });
      }
    }
  };
  walk(DIRECTORY);
  preloaded = files;
  return files;
}

export async function validateXsd(xml: string, root: "Invoice" | "CreditNote"): Promise<ValidationFailure[]> {
  const name = root === "CreditNote" ? "UBL-CreditNote-2.1.xsd" : "UBL-Invoice-2.1.xsd";
  const files = schemaFiles();
  const main = files.find((file) => file.fileName === `maindoc/${name}`);
  if (!main) {
    return [{ layer: "xsd", ruleId: "XSD", severity: "fatal", location: null, message: "The UBL schema is not installed." }];
  }
  const result = await validateXML({
    xml: [{ fileName: "instance.xml", contents: xml }],
    schema: [main],
    preload: files.filter((file) => file.fileName !== main.fileName),
    initialMemoryPages: 256,
    maxMemoryPages: 1024,
  });
  if (result.valid) return [];
  const errors = result.errors.length
    ? result.errors
    : [{ message: "The file does not match the UBL schema.", loc: null }];
  return errors.map((error) => ({
    layer: "xsd" as const,
    ruleId: "XSD",
    severity: "fatal" as const,
    location: error.loc ? `line ${error.loc.lineNumber}` : null,
    message: error.message.slice(0, 2000),
  }));
}
