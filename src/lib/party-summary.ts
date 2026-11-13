import type { DocumentStatus } from "@/lib/transaction-types";

/** One document of a customer or supplier, as far as the summary needs it. Amounts are in the document currency. */
export type PartyDocument = {
  id: string;
  typeCode: string;
  kind: string;
  number: string;
  status: DocumentStatus;
  date: string;
  dueDate: string | null;
  total: number;
  amountDue: number;
};

/** One payment, receipt or refund of a customer or supplier, as far as the summary needs it. Amounts are in its currency. */
export type PartyPayment = {
  id: string;
  typeCode: string;
  number: string;
  status: "draft" | "posted" | "void";
  date: string;
  amount: number;
  unallocated: number;
  /** True for money that pays the party's invoices: a customer receipt or a supplier payment. A refund is not. */
  settlesInvoices: boolean;
};

/** Money the party has paid, or credit it holds, that has not been applied to an invoice. */
export type PartyOnAccount = {
  id: string;
  typeCode: string;
  number: string;
  date: string;
  amount: number;
  kind: "payment" | "credit_note";
};

export type PartySummary = {
  /** Still due on posted invoices, less posted credit notes. */
  due: number;
  /** The part of what is due that is past its due date. */
  overdue: number;
  overdueCount: number;
  /** Posted invoices less posted credit notes, dated this calendar year. */
  yearTotal: number;
  year: number;
  documentCount: number;
  lastDate: string | null;
  recent: PartyDocument[];
  /** Posted receipts or payments not yet applied, and posted credit notes with a balance, newest first. */
  onAccountTotal: number;
  onAccount: PartyOnAccount[];
  /** The latest posted payments and receipts, newest first. */
  recentPayments: PartyPayment[];
  activeOrders: number;
  /** Nett still to invoice on active orders, in the document currency. */
  toInvoice: number;
};

const RECENT = 6;

function cents(value: number) {
  return Math.round(value * 100) / 100;
}

/** Works the summary out from the party's documents, newest first. `toInvoice` comes from the order lines. */
export function buildPartySummary(documents: PartyDocument[], today: string, toInvoice = 0, payments: PartyPayment[] = []): PartySummary {
  const year = Number(today.slice(0, 4));
  let due = 0;
  let overdue = 0;
  let overdueCount = 0;
  let yearTotal = 0;
  for (const document of documents) {
    if (document.status !== "posted") continue;
    const sign = document.kind === "credit_note" ? -1 : 1;
    if (document.kind !== "invoice" && document.kind !== "credit_note") continue;
    due += sign * document.amountDue;
    if (sign === 1 && document.amountDue > 0 && document.dueDate && document.dueDate < today) {
      overdue += document.amountDue;
      overdueCount += 1;
    }
    if (Number(document.date.slice(0, 4)) === year) yearTotal += sign * document.total;
  }
  const onAccount: PartyOnAccount[] = [
    ...payments
      .filter((payment) => payment.status === "posted" && payment.settlesInvoices && payment.unallocated > 0)
      .map((payment): PartyOnAccount => ({ id: payment.id, typeCode: payment.typeCode, number: payment.number, date: payment.date, amount: cents(payment.unallocated), kind: "payment" })),
    ...documents
      .filter((document) => document.status === "posted" && document.kind === "credit_note" && document.amountDue > 0)
      .map((document): PartyOnAccount => ({ id: document.id, typeCode: document.typeCode, number: document.number, date: document.date, amount: cents(document.amountDue), kind: "credit_note" })),
  ].sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
  return {
    onAccountTotal: cents(onAccount.reduce((sum, item) => sum + item.amount, 0)),
    onAccount,
    recentPayments: payments
      .filter((payment) => payment.status === "posted")
      .sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id))
      .slice(0, RECENT),
    due: cents(due),
    overdue: cents(overdue),
    overdueCount,
    yearTotal: cents(yearTotal),
    year,
    documentCount: documents.length,
    lastDate: documents[0]?.date ?? null,
    recent: documents.slice(0, RECENT),
    activeOrders: documents.filter((document) => document.kind === "order" && document.status === "open").length,
    toInvoice: cents(toInvoice),
  };
}
