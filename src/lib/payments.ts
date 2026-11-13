import { roundCents } from "@/lib/documents";
import type { PaymentKind, TransactionTypeKind } from "@/lib/transaction-types";

export type PaymentStatus = "draft" | "posted" | "void";

export type PartyChoice = {
  id: string;
  code: string;
  name: string;
  currencyId: string;
};

export type PaymentBankAccount = {
  id: string;
  code: string;
  name: string;
  currencyId: string;
  active: boolean;
  isDefault: boolean;
};

export type PaymentCurrency = {
  id: string;
  code: string;
  rate: string;
  home: boolean;
};

export type PaymentTypeInfo = {
  id: string;
  code: string;
  description: string;
  direction: TransactionTypeKind;
  kind: PaymentKind;
};

/** What a payment settles: the money a customer receipt or a supplier payment clears is an invoice, a refund clears a credit note. */
export type TargetKind = "invoice" | "credit_note";

export function targetKindFor(kind: PaymentKind, direction: TransactionTypeKind): TargetKind {
  const clearsInvoices = (kind === "receipt" && direction === "Sales") || (kind === "payment" && direction === "Purchases");
  return clearsInvoices ? "invoice" : "credit_note";
}

/** A short name for a payment, by who it is with and which way the money goes. */
export function paymentNoun(kind: PaymentKind, direction: TransactionTypeKind) {
  if (kind === "receipt") return direction === "Sales" ? "receipt" : "supplier refund";
  return direction === "Purchases" ? "payment" : "customer refund";
}

export type AllocationLine = {
  id: string;
  /** The invoice or credit note it settles. */
  documentId: string;
  documentNumber: string;
  documentDate: string;
  date: string;
  amount: string;
  exchangeDifference: string;
  pending: boolean;
  removedAt: string;
  removalReason: string;
  removedByName: string;
  byName: string;
};

export type PaymentRow = {
  id: string;
  transactionTypeId: string;
  status: PaymentStatus;
  source: "manual" | "migrated";
  documentNumber: string;
  paymentDate: string;
  partyId: string;
  partyName: string;
  bankAccountId: string;
  bankAccountLabel: string;
  currencyId: string;
  currencyCode: string;
  exchangeRate: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  paymentMeansCode: string;
  bankReference: string;
  notes: string;
  voidReason: string;
  /** Planned allocations on a draft, and effective ones on a posted payment. Removed ones are shown apart. */
  allocations: AllocationLine[];
};

/** A posted document that still has something due, as the payment screen lists it. */
export type OpenItem = {
  id: string;
  documentNumber: string;
  date: string;
  dueDate: string;
  total: string;
  /** What is still due, as a plain number with two decimals. */
  open: string;
  kind: TargetKind;
};

export type PaymentChoices = {
  type: PaymentTypeInfo;
  parties: PartyChoice[];
  bankAccounts: PaymentBankAccount[];
  currencies: PaymentCurrency[];
  paymentMeans: { code: string; name: string; common: boolean }[];
  canVoid: boolean;
};

/** A new draft raised from a document: its party, and the amount due already allocated to it. */
export type PaymentPrefill = {
  partyId: string;
  amount: string;
  allocations: Record<string, string>;
};

/**
 * Applies an amount to open items, oldest due date first, then oldest date, then id. Items with nothing due are
 * skipped. What is left stays unallocated. Amounts are worked in cents, so the sums are exact.
 */
export function distributeOldestFirst(
  items: { id: string; dueDate: string; date: string; open: string }[],
  amount: number,
): Record<string, string> {
  let cents = Math.round(roundCents(amount) * 100);
  const result: Record<string, string> = {};
  const ordered = [...items].sort((left, right) => {
    const dueLeft = left.dueDate || "9999-12-31";
    const dueRight = right.dueDate || "9999-12-31";
    return dueLeft.localeCompare(dueRight) || left.date.localeCompare(right.date) || left.id.localeCompare(right.id);
  });
  for (const item of ordered) {
    if (cents <= 0) break;
    const open = Math.round(roundCents(Number(item.open)) * 100);
    if (open <= 0) continue;
    const take = Math.min(open, cents);
    result[item.id] = (take / 100).toFixed(2);
    cents -= take;
  }
  return result;
}

/** What has been allocated, what is left on account, and whether the allocations ask for more than the payment. */
export function allocationTotals(amount: number, allocations: number[]) {
  const allocated = roundCents(allocations.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0));
  const unallocated = roundCents(amount - allocated);
  return { allocated, unallocated, over: unallocated < 0 };
}

/** An allocation amount typed in a box: blank is nothing, anything else is a positive amount with at most two decimals. */
export function parseAllocationAmount(value: string): number | null | undefined {
  const text = value.replace(/,/g, "").trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const parsed = Number(text);
  return parsed > 0 ? parsed : null;
}

/** The party's unallocated money, newest first, as the party summary lists it. */
export type OnAccount = {
  id: string;
  label: string;
  date: string;
  amount: string;
  kind: "payment" | "credit_note";
};

/**
 * The address of a new draft raised from a document: `?new=1&party=<id>&allocate=<id>:<amount>,<id>:<amount>`.
 * The amount of the payment is the sum of the allocations. Anything malformed is ignored, so a bad link opens
 * an empty draft rather than failing.
 */
export function parsePaymentPrefill(query: { party?: string; allocate?: string }): PaymentPrefill | null {
  const partyId = (query.party ?? "").trim();
  if (!partyId) return null;
  const allocations: Record<string, string> = {};
  let cents = 0;
  for (const part of (query.allocate ?? "").split(",")) {
    const [id, value = ""] = part.split(":");
    const amount = parseAllocationAmount(value);
    if (!id.trim() || typeof amount !== "number") continue;
    allocations[id.trim()] = amount.toFixed(2);
    cents += Math.round(amount * 100);
  }
  return { partyId, amount: cents > 0 ? (cents / 100).toFixed(2) : "", allocations };
}

/** One allocation as a posted invoice or credit note lists it. */
export type DocumentAllocation = {
  id: string;
  /** How it touches this document: money received or paid against it, or this credit note applied to an invoice. */
  role: "settled-by" | "applied-to";
  /** The payment, receipt or credit note on the other side, and the document number or payment number to show. */
  otherKind: "payment" | "credit_note" | "invoice";
  otherId: string;
  otherNumber: string;
  date: string;
  amount: string;
  exchangeDifference: string;
  removedAt: string;
  removalReason: string;
  removedByName: string;
  byName: string;
  createdAt: string;
};

/** Everything the Payments tab of a posted invoice or credit note shows. */
export type DocumentPayments = {
  documentId: string;
  kind: "invoice" | "credit_note";
  direction: TransactionTypeKind;
  partyId: string;
  currencyCode: string;
  total: string;
  /** Paid on an invoice, applied or refunded on a credit note. */
  paid: string;
  /** What is still open, as a plain number with two decimals. */
  open: string;
  allocations: DocumentAllocation[];
  /** The types that can be raised from it: a receipt or payment for an invoice, a refund for a credit note. */
  recordTypes: { id: string; code: string; description: string; kind: PaymentKind }[];
  /** For a credit note with a balance: the party's open invoices it can be applied to. */
  openInvoices: OpenItem[];
};

/** The address that opens a new draft of a payment type with this document's open amount allocated to it. */
export function recordPaymentHref(typeCode: string, documentId: string, partyId: string, open: string) {
  const query = new URLSearchParams({ new: "1", party: partyId, allocate: `${documentId}:${open}` });
  return `/transactions/${encodeURIComponent(typeCode)}?${query.toString()}`;
}

export type SettlementState = "unpaid" | "part" | "paid";

/** Where a posted invoice or credit note stands: nothing paid, some paid, or nothing left due. Amounts may carry thousands separators. */
export function settlementState(paid: string | number, due: string | number): SettlementState {
  const amount = (value: string | number) => Number(String(value).replace(/,/g, "")) || 0;
  if (amount(due) <= 0) return "paid";
  return amount(paid) > 0 ? "part" : "unpaid";
}
