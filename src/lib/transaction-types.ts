export const TRANSACTION_TYPE_KINDS = ["Sales", "Purchases"] as const;

export type TransactionTypeKind = (typeof TRANSACTION_TYPE_KINDS)[number];

export type TransactionTypeRow = {
  id: string;
  code: string;
  description: string;
  lastReference: number;
  type: TransactionTypeKind;
};

export function parseTransactionTypeKind(value: string): TransactionTypeKind | null {
  return TRANSACTION_TYPE_KINDS.find((type) => type === value) ?? null;
}
