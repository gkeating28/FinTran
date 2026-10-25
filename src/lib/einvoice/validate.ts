import { readFileSync } from "node:fs";
import path from "node:path";
import SaxonJS from "saxon-js";
import { XMLParser } from "fast-xml-parser";
import { rejectUnsafeXml } from "./xml";

export type ValidationFailure = {
  layer: "xsd" | "en16931" | "peppol" | "national";
  ruleId: string;
  severity: "fatal" | "warning";
  location: string | null;
  message: string;
};

export type ValidationResult = {
  validatorVersion: string;
  rulesVersion: string;
  root: "Invoice" | "CreditNote";
  results: ValidationFailure[];
};

const RULES_VERSION = "3.0.21";
const VALIDATOR_VERSION = "saxon-js-peppol-bis-3.0.21";

let stylesheets: { cen: unknown; peppol: unknown } | null = null;

function loadStylesheets() {
  if (stylesheets) return stylesheets;
  // next.config.ts traces these files into the upload, regenerate, and posting routes.
  const directory = path.join(process.cwd(), "einvoice/rules/3.0.21");
  stylesheets = {
    cen: JSON.parse(readFileSync(path.join(directory, "cen.sef.json"), "utf8")),
    peppol: JSON.parse(readFileSync(path.join(directory, "peppol.sef.json"), "utf8")),
  };
  return stylesheets;
}

function failures(svrl: string, layer: ValidationFailure["layer"]): ValidationFailure[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    processEntities: false,
    isArray: (name) => name === "failed-assert",
  });
  const document = parser.parse(svrl) as { schematronOutput?: { "failed-assert"?: Array<Record<string, string>> } };
  const asserts = document.schematronOutput?.["failed-assert"] ?? [];
  return asserts.map((item) => ({
    layer,
    ruleId: item.id || "SCHEMATRON",
    severity: item.flag === "warning" ? "warning" : "fatal",
    location: item.location || null,
    message: (item.text || "Schematron rule failed").slice(0, 2000),
  }));
}

function runLayer(xml: string, stylesheet: unknown, layer: ValidationFailure["layer"]) {
  const result = SaxonJS.transform({
    stylesheetInternal: stylesheet,
    sourceText: xml,
    destination: "serialized",
  });
  return failures(String(result.principalResult ?? ""), layer);
}

export function validateXml(xml: string): ValidationResult {
  const checked = rejectUnsafeXml(xml);
  const loaded = loadStylesheets();
  const results = [
    ...runLayer(xml, loaded.cen, "en16931"),
    ...runLayer(xml, loaded.peppol, "peppol"),
  ];
  return {
    validatorVersion: VALIDATOR_VERSION,
    rulesVersion: RULES_VERSION,
    root: checked.root,
    results,
  };
}
