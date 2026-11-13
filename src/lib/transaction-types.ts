export const TRANSACTION_TYPE_KINDS = ["Sales", "Purchases"] as const;

export type TransactionTypeKind = (typeof TRANSACTION_TYPE_KINDS)[number];

export const DOCUMENT_KINDS = ["invoice", "credit_note", "order", "requisition"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** A payment is money out and a receipt is money in. Neither is a document: they are never transaction headers. */
export const PAYMENT_KINDS = ["payment", "receipt"] as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** Every kind a transaction type can have. */
export type TypeKind = DocumentKind | PaymentKind;

export function isPaymentKind(kind: TypeKind | string | null | undefined): kind is PaymentKind {
  return kind === "payment" || kind === "receipt";
}

/** Draft, posted and void belong to invoices and credit notes. Draft, open, closed and cancelled belong to orders and requisitions. */
export const DOCUMENT_STATUSES = ["draft", "posted", "void", "open", "closed", "cancelled"] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** An order or a requisition is activated and closed. It is never posted. */
export function isOrderKind(kind: DocumentKind | string | null | undefined) {
  return kind === "order" || kind === "requisition";
}

/** The stored value 'open' is shown as Active, because open also means looking at a document. */
export function documentStatusLabel(status: DocumentStatus) {
  if (status === "open") return "Active";
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
  documentKind: TypeKind;
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

/** The kind of a type, whether it is for documents or for payments. */
export function parseTypeKind(value: string): TypeKind | null {
  return DOCUMENT_KINDS.find((kind) => kind === value) ?? PAYMENT_KINDS.find((kind) => kind === value) ?? null;
}

export function documentKindLabel(kind: TypeKind) {
  if (kind === "payment") return "Payment";
  if (kind === "receipt") return "Receipt";
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
