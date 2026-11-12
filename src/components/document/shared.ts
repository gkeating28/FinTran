import { formatInteger } from "@/lib/numbers";
import type { CreditInvoice, DocumentLine } from "@/lib/documents";

export function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + days);
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

export function termsText(days: number) {
  if (days === 0) return "Due on receipt";
  if (days === 1) return "Payment due within 1 day";
  return `Payment due within ${days} days`;
}

export const SPLIT_WIDTH_KEY = "fintran.transactionSplitWidth";

export function readStoredSplitWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(SPLIT_WIDTH_KEY);
    const value = stored == null ? Number.NaN : Number(stored);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export const SPLIT_HANDLE = 10;
export const SPLIT_MIN = 280;

export type HeaderTab = "document" | "notes" | "payment";

export function clampSplit(width: number, container: number) {
  const max = Math.max(SPLIT_MIN, container - SPLIT_MIN - SPLIT_HANDLE);
  return Math.round(Math.min(max, Math.max(SPLIT_MIN, width)));
}

export function blankLine(): DocumentLine {
  return {
    lineNumber: 0,
    productId: "",
    productCode: "",
    description: "",
    glCodeId: "",
    departmentId: "",
    costCentreId: "",
    vatRateId: "",
    quantity: "1",
    price: "0.00",
    discountAmount: "0.00",
    nettAmount: "0.00",
    vatAmount: "0.00",
    unitCode: "C62",
    lineNote: "",
    sellerItemId: "",
  };
}

export function creditLabel(invoice: CreditInvoice) {
  const reference = invoice.reference == null ? "—" : formatInteger(invoice.reference);
  return `${invoice.typeCode} ${reference} · ${invoice.transactionDate}`;
}

/** The id of the form that holds the open document. Buttons outside it submit it by this id. */
export const DOCUMENT_FORM = "purchase-document";
