export const TRANSACTION_TYPE_KINDS = ["Sales", "Purchases"] as const;

export type TransactionTypeKind = (typeof TRANSACTION_TYPE_KINDS)[number];

export const DOCUMENT_KINDS = ["invoice", "credit_note", "order", "requisition"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Draft, posted and void belong to invoices and credit notes. Draft, open, closed and cancelled belong to orders and requisitions. */
export const DOCUMENT_STATUSES = ["draft", "posted", "void", "open", "closed", "cancelled"] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** An order or a requisition is opened and closed. It is never posted. */
export function isOrderKind(kind: DocumentKind | string | null | undefined) {
  return kind === "order" || kind === "requisition";
}

export function documentStatusLabel(status: DocumentStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** The statuses a document of this kind can have, in the order they happen. */
export function statusesForKind(kind: DocumentKind | string | null | undefined): DocumentStatus[] {
  return isOrderKind(kind) ? ["draft", "open", "closed", "cancelled"] : ["draft", "posted", "void"];
}

export type TransactionTypeRow = {
  id: string;
  code: string;
  description: string;
  lastReference: number;
  type: TransactionTypeKind;
  documentKind: DocumentKind;
  documentCount: number;
  numbering: "on_insert" | "on_post";
  referencePrefix: string;
  referencePadding: number;
  flexLabels: [string, string, string, string, string];
};

export function documentNumberPreview(prefix: string, padding: number, reference: number) {
  const body = String(reference);
  const padded = padding > body.length ? body.padStart(padding, "0") : body;
  return `${prefix}${padded}`;
}

export function parseReferencePrefix(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9./-]{1,10}$/.test(trimmed)) return undefined;
  return trimmed;
}

export function parseReferencePadding(value: string) {
  if (!/^(?:[0-9]|10)$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

export function parseDocumentKind(value: string): DocumentKind | null {
  return DOCUMENT_KINDS.find((kind) => kind === value) ?? null;
}

export function documentKindLabel(kind: DocumentKind) {
  if (kind === "credit_note") return "Credit note";
  if (kind === "order") return "Order";
  if (kind === "requisition") return "Requisition";
  return "Invoice";
}

export function parseFlexLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 80) return undefined;
  return trimmed;
}

export function parseTransactionTypeKind(value: string): TransactionTypeKind | null {
  return TRANSACTION_TYPE_KINDS.find((type) => type === value) ?? null;
}
