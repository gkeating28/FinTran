const UBL_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const UBL_CREDIT = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

export const UBL = { invoice: UBL_INVOICE, creditNote: UBL_CREDIT, cac: CAC, cbc: CBC };
export const MAX_XML_BYTES = 4 * 1024 * 1024;

export function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function rejectUnsafeXml(xml: string) {
  const bytes = Buffer.byteLength(xml, "utf8");
  if (bytes < 1 || bytes > MAX_XML_BYTES) {
    throw new Error("The e-document file must be between 1 byte and 4 MB.");
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error("The file was refused because it contains a document type declaration.");
  }
  const root = xml.match(/<([A-Za-z0-9]+):?(Invoice|CreditNote|CrossIndustryInvoice)\b/);
  const tag = xml.match(/<(?:[A-Za-z0-9]+:)?(Invoice|CreditNote|CrossIndustryInvoice)\b/);
  const name = tag?.[1] ?? root?.[2];
  if (name === "CrossIndustryInvoice") {
    throw new Error("CII invoices are not accepted. Upload a UBL 2.1 Invoice or CreditNote.");
  }
  if (name !== "Invoice" && name !== "CreditNote") {
    throw new Error("The file must be a UBL 2.1 Invoice or CreditNote.");
  }
  const namespace = name === "Invoice" ? UBL_INVOICE : UBL_CREDIT;
  if (!xml.includes(namespace)) {
    throw new Error("The file must use the UBL 2.1 namespace.");
  }
  return { root: name as "Invoice" | "CreditNote", bytes };
}
