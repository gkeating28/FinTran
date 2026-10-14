export const TRANSACTION_TYPE_KINDS = ["Sales", "Purchases"] as const;

export type TransactionTypeKind = (typeof TRANSACTION_TYPE_KINDS)[number];

export type TransactionTypeRow = {
  id: string;
  code: string;
  description: string;
  lastReference: number;
  type: TransactionTypeKind;
  flexLabels: [string, string, string, string, string];
};

export function parseFlexLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 80) return undefined;
  return trimmed;
}

export function parseTransactionTypeKind(value: string): TransactionTypeKind | null {
  return TRANSACTION_TYPE_KINDS.find((type) => type === value) ?? null;
}
