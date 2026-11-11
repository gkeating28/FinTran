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
  activeOrders: number;
  /** Nett still to invoice on active orders, in the document currency. */
  toInvoice: number;
};

const RECENT = 6;

function cents(value: number) {
  return Math.round(value * 100) / 100;
}

/** Works the summary out from the party's documents, newest first. `toInvoice` comes from the order lines. */
export function buildPartySummary(documents: PartyDocument[], today: string, toInvoice = 0): PartySummary {
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
  return {
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
