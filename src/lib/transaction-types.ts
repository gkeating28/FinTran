export const TRANSACTION_TYPE_KINDS = ["Sales", "Purchases"] as const;

export type TransactionTypeKind = (typeof TRANSACTION_TYPE_KINDS)[number];

export const DOCUMENT_KINDS = ["invoice", "credit_note", "order"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type TransactionTypeRow = {
  id: string;
  code: string;
  description: string;
  lastReference: number;
  type: TransactionTypeKind;
  documentKind: DocumentKind;
  documentCount: number;
  numbering: "on_insert" | "on_post";
  flexLabels: [string, string, string, string, string];
};

export function parseDocumentKind(value: string): DocumentKind | null {
  return DOCUMENT_KINDS.find((kind) => kind === value) ?? null;
}

export function documentKindLabel(kind: DocumentKind) {
  if (kind === "credit_note") return "Credit note";
  if (kind === "order") return "Order";
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
