import type { FormOrganisation } from "@/lib/form-document";
import { formatMoney } from "@/lib/documents";
import type { PaymentKind, TransactionTypeKind } from "@/lib/transaction-types";

/**
 * What a printed payment or receipt shows. Money paid out prints as a remittance advice, which is what a supplier or a
 * customer being refunded is sent. Money received prints as a receipt. The layout is fixed: it is the same for every
 * organisation, and it is not designed in the form designer.
 */
export type PaymentPrintSource = {
  kind: PaymentKind;
  direction: TransactionTypeKind;
  status: "draft" | "posted" | "void";
  /** Empty on a draft that has not been numbered. */
  documentNumber: string;
  paymentDate: string;
  organisation: FormOrganisation;
  partyName: string;
  /** The party's postal address and tax details, one line each, without the name. */
  partyLines: string[];
  currencyCode: string;
  amount: number;
  meansLabel: string;
  bankReference: string;
  bankAccount: string;
  notes: string;
  voidReason: string;
  /** What the payment settles: effective allocations on a posted payment, planned ones on a draft. */
  allocations: { documentNumber: string; date: string; total: number; applied: number }[];
};

export type PaymentPrintView = {
  title: string;
  /** Without the extension, for the name of the PDF. */
  downloadName: string;
  watermark: "DRAFT" | "VOID" | null;
  organisationName: string;
  organisationLines: string[];
  logoUrl: string | null;
  partyLabel: string;
  partyName: string;
  partyLines: string[];
  details: { label: string; value: string }[];
  headers: { key: string; label: string; align: "left" | "right" }[];
  rows: { text: string; align: "left" | "right" }[][];
  totals: { label: string; value: string; strong?: boolean }[];
  notes: string;
  voidNote: string;
};

function linesOf(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 2026-11-17 as 17-11-2026, the way the printed documents show dates. */
export function printedDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function cents(value: number) {
  return Math.round(value * 100);
}

/** Money paid out is a remittance advice and money received is a receipt. */
export function printTitle(kind: PaymentKind) {
  return kind === "payment" ? "Remittance advice" : "Receipt";
}

export function buildPaymentPrint(source: PaymentPrintSource): PaymentPrintView {
  const { organisation } = source;
  const title = printTitle(source.kind);
  // A payment out or a refund to a customer settles the document that was owed. The documents are invoices, except for
  // a refund, which settles a credit note.
  const settlesInvoices =
    (source.kind === "receipt" && source.direction === "Sales") || (source.kind === "payment" && source.direction === "Purchases");

  const organisationLines = [
    ...linesOf(organisation.address),
    organisation.phone,
    organisation.contactEmail,
    organisation.website,
    organisation.vatNumber ? `VAT ID: ${organisation.vatNumber}` : "",
    organisation.companyNumber ? `Company no. ${organisation.companyNumber}` : "",
  ].filter(Boolean);

  const applied = source.allocations.reduce((sum, item) => sum + cents(item.applied), 0);
  const onAccount = source.status === "void" ? 0 : cents(source.amount) - applied;

  const details = [
    { label: "Number", value: source.documentNumber || "Draft" },
    { label: "Date", value: printedDate(source.paymentDate) },
    { label: "Payment method", value: source.meansLabel },
    { label: "Bank reference", value: source.bankReference },
    { label: source.kind === "payment" ? "Paid from" : "Paid into", value: source.bankAccount },
    { label: "Currency", value: source.currencyCode },
  ].filter((line) => line.value);

  const totals: PaymentPrintView["totals"] = [
    { label: `Amount (${source.currencyCode})`, value: formatMoney(source.amount), strong: true },
  ];
  if (source.allocations.length > 0) {
    totals.push({ label: settlesInvoices ? "Applied to invoices" : "Applied to credit notes", value: formatMoney(applied / 100) });
  }
  if (onAccount > 0) totals.push({ label: "On account", value: formatMoney(onAccount / 100) });

  return {
    title,
    downloadName: `${title} ${source.documentNumber || "draft"}`.trim(),
    watermark: source.status === "draft" ? "DRAFT" : source.status === "void" ? "VOID" : null,
    organisationName: organisation.name,
    organisationLines,
    logoUrl: organisation.logoUrl,
    partyLabel: source.kind === "payment" ? "Paid to" : "Received from",
    partyName: source.partyName,
    partyLines: source.partyLines,
    details,
    headers: [
      { key: "document", label: settlesInvoices ? "Invoice" : "Credit note", align: "left" },
      { key: "date", label: "Date", align: "left" },
      { key: "total", label: "Document total", align: "right" },
      { key: "applied", label: "Amount applied", align: "right" },
    ],
    rows: source.allocations.map((item) => [
      { text: item.documentNumber, align: "left" },
      { text: printedDate(item.date), align: "left" },
      { text: formatMoney(item.total), align: "right" },
      { text: formatMoney(item.applied), align: "right" },
    ]),
    totals,
    notes: source.notes,
    voidNote: source.status === "void" ? `Voided${source.voidReason ? `: ${source.voidReason}` : ""}` : "",
  };
}
