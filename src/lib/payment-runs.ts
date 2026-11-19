import type { ApprovalInfo } from "@/lib/approvals";

export type RunStatus = "draft" | "posted" | "cancelled";

/** One invoice a payment in a run pays. */
export type RunInvoice = {
  id: string;
  number: string;
  typeCode: string;
  amount: string;
};

/** The draft payment made for one supplier in a run. */
export type RunPayment = {
  id: string;
  supplierId: string;
  supplierName: string;
  amount: string;
  documentNumber: string;
  status: "draft" | "posted" | "void";
  iban: string;
  bic: string;
  bankAccountName: string;
  invoices: RunInvoice[];
};

export type PaymentRunRow = {
  id: string;
  documentNumber: string;
  status: RunStatus;
  paymentDate: string;
  typeId: string;
  typeCode: string;
  bankAccountId: string;
  bankAccountLabel: string;
  currencyCode: string;
  notes: string;
  /** In the run's currency, as a plain number with two decimals. */
  total: string;
  payments: RunPayment[];
};

/** What can be paid: posted purchase invoices with something open, in the currency of the chosen bank account. */
export type RunnableInvoice = {
  id: string;
  number: string;
  typeCode: string;
  supplierId: string;
  supplierName: string;
  date: string;
  dueDate: string;
  open: string;
};

export type RunChoices = {
  types: { id: string; code: string; description: string }[];
  bankAccounts: { id: string; code: string; name: string; currencyCode: string; isDefault: boolean }[];
  canCreate: boolean;
};

/** A run's approval, with what the run screen adds to the document form: the total and which suppliers' details are new. */
export type RunApproval = ApprovalInfo & { homeTotal: string; bankSuppliers: string };

export function runStatusLabel(status: RunStatus) {
  return status === "draft" ? "Draft" : status === "posted" ? "Posted" : "Cancelled";
}

/** Totals the chosen invoices by supplier, for the line under the picker. */
export function summariseChoice(invoices: RunnableInvoice[], chosen: Set<string>) {
  const picked = invoices.filter((invoice) => chosen.has(invoice.id));
  const suppliers = new Set(picked.map((invoice) => invoice.supplierId));
  const cents = picked.reduce((sum, invoice) => sum + Math.round(Number(invoice.open) * 100), 0);
  return { invoices: picked.length, suppliers: suppliers.size, total: (cents / 100).toFixed(2) };
}
