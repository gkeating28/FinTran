import { semanticRecord, semanticRows, semanticText } from "@/lib/einvoice/semantic-read";
import { numberValue } from "@/lib/numbers";
import { formatMoney, roundCents } from "@/lib/documents";
import type { Named, Vat } from "./types";

export function sameId(left: string | null | undefined, right: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function dateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

export function fieldMoney(value: string) {
  if (!value) return "";
  return formatMoney(value) || value;
}

export function moneyText(value: string) {
  return fieldMoney(value) || "—";
}

export function invoiceVat(nett: string, rate: string) {
  if (!nett || !rate) return "";
  return formatMoney(roundCents((numberValue(nett) * numberValue(rate)) / 100));
}

export function discountAmount(line: Record<string, unknown>) {
  const allowances = semanticRows(line["BG-27"]);
  if (allowances.length === 0) return formatMoney(0);
  const total = allowances.reduce((sum, entry) => sum + numberValue(semanticText(entry["BT-136"])), 0);
  return formatMoney(roundCents(total));
}

export function presentedLine(line: Record<string, unknown>) {
  const item = semanticRecord(line["BG-31"]);
  const tax = semanticRecord(line["BG-30"]);
  const price = semanticRecord(line["BG-29"]);
  const name = semanticText(item?.["BT-153"]);
  const description = semanticText(item?.["BT-154"]) || name;
  const nett = semanticText(line["BT-131"]);
  const rate = semanticText(tax?.["BT-152"]);
  const allowances = semanticRows(line["BG-27"]);
  return {
    number: semanticText(line["BT-126"]),
    name,
    description,
    sellerItem: semanticText(item?.["BT-155"]),
    note: semanticText(line["BT-127"]),
    quantity: semanticText(line["BT-129"]),
    unit: semanticText(line["BT-130"]) || "C62",
    price: semanticText(price?.["BT-146"]),
    base: semanticText(price?.["BT-149"]),
    nett,
    vatCategory: semanticText(tax?.["BT-151"]),
    vatRate: rate,
    vatAmount: invoiceVat(nett, rate),
    discount: discountAmount(line),
    allowances,
  };
}

export function namedCode(rows: Named[], id: string) {
  return rows.find((row) => row.id === id)?.code ?? "";
}

export function vatCode(rows: Vat[], id: string) {
  return rows.find((row) => row.id === id)?.code ?? "";
}

export function codeLabel(row: { code: string; description: string }) {
  return row.description ? `${row.code} — ${row.description}` : row.code;
}
