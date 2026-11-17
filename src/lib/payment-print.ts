import type { FormOrganisation } from "@/lib/form-document";
import { formatMoney } from "@/lib/documents";
import type { PageSize } from "@/lib/form-layout";
import {
  defaultPaymentLayout,
  paymentHeaderFieldLabel,
  paymentLineColumnLabel,
  paymentPartyLabel,
  paymentTitle,
  settlesInvoices,
  type PaymentFormLayout,
} from "@/lib/payment-form-layout";
import type { PaymentKind, TransactionTypeKind } from "@/lib/transaction-types";

/**
 * What a printed payment or receipt shows. Money paid out prints as a remittance advice, which is what a supplier or a
 * customer being refunded is sent. Money received prints as a receipt. Which fields and columns it shows, and in what
 * order, come from the form saved for its transaction type, or from the standard form when none is saved.
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
  /** The party's postal address, one line each, without the name. */
  partyAddressLines: string[];
  partyVatNumber: string;
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
  pageSize: PageSize;
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
  return paymentTitle(kind);
}

export function buildPaymentPrint(source: PaymentPrintSource, layout: PaymentFormLayout = defaultPaymentLayout(source.kind)): PaymentPrintView {
  const { organisation } = source;
  const title = layout.title.trim() || printTitle(source.kind);
  // A payment out or a refund to a customer settles the document that was owed. The documents are invoices, except for
  // a refund, which settles a credit note.
  const settles = settlesInvoices(source.kind, source.direction);

  const organisationValue = {
    name: "",
    address: linesOf(organisation.address),
    phone: [organisation.phone],
    contactEmail: [organisation.contactEmail],
    website: [organisation.website],
    contactName: [organisation.contactName],
    vatNumber: [organisation.vatNumber ? `VAT ID: ${organisation.vatNumber}` : ""],
    companyNumber: [organisation.companyNumber ? `Company no. ${organisation.companyNumber}` : ""],
    peppolId: [organisation.peppolId ? `Peppol ID: ${organisation.peppolId}` : ""],
    country: [organisation.country],
  } as const;
  const organisationLines = layout.organisationFields.flatMap((field) => organisationValue[field]).filter(Boolean);

  const partyLines = layout.partyFields.flatMap((field) =>
    field === "address" ? source.partyAddressLines : field === "vatNumber" && source.partyVatNumber ? [`VAT ID: ${source.partyVatNumber}`] : [],
  );

  const applied = source.allocations.reduce((sum, item) => sum + cents(item.applied), 0);
  const onAccount = source.status === "void" ? 0 : cents(source.amount) - applied;

  const detailValue = {
    documentNumber: source.documentNumber || "Draft",
    transactionDate: printedDate(source.paymentDate),
    paymentMeans: source.meansLabel,
    bankReference: source.bankReference,
    bankAccount: source.bankAccount,
    currency: source.currencyCode,
  } as const;
  const details = layout.headerFields
    .map((field) => ({ label: paymentHeaderFieldLabel(field, source.kind), value: detailValue[field] }))
    .filter((line) => line.value);

  const totals: PaymentPrintView["totals"] = [
    { label: `Amount (${source.currencyCode})`, value: formatMoney(source.amount), strong: true },
  ];
  if (source.allocations.length > 0) {
    totals.push({ label: settles ? "Applied to invoices" : "Applied to credit notes", value: formatMoney(applied / 100) });
  }
  if (onAccount > 0) totals.push({ label: "On account", value: formatMoney(onAccount / 100) });

  const align = { document: "left", date: "left", total: "right", applied: "right" } as const;
  const cell = (item: PaymentPrintSource["allocations"][number], column: PaymentFormLayout["lineColumns"][number]) =>
    column === "document"
      ? item.documentNumber
      : column === "date"
        ? printedDate(item.date)
        : column === "total"
          ? formatMoney(item.total)
          : formatMoney(item.applied);

  return {
    title,
    pageSize: layout.pageSize,
    downloadName: `${title} ${source.documentNumber || "draft"}`.trim(),
    watermark: source.status === "draft" ? "DRAFT" : source.status === "void" ? "VOID" : null,
    organisationName: layout.organisationFields.includes("name") ? organisation.name : "",
    organisationLines,
    logoUrl: layout.showLogo ? organisation.logoUrl : null,
    partyLabel: paymentPartyLabel(source.kind),
    partyName: layout.partyFields.includes("name") ? source.partyName : "",
    partyLines,
    details,
    headers: layout.lineColumns.map((column) => ({
      key: column,
      label: paymentLineColumnLabel(column, settles ? "invoices" : "credit notes"),
      align: align[column],
    })),
    rows: source.allocations.map((item) => layout.lineColumns.map((column) => ({ text: cell(item, column), align: align[column] }))),
    totals,
    notes: source.notes,
    voidNote: source.status === "void" ? `Voided${source.voidReason ? `: ${source.voidReason}` : ""}` : "",
  };
}

/** A made-up payment, so the form designer has a page to show before the organisation has made one. */
export function samplePaymentSource(
  kind: PaymentKind,
  direction: TransactionTypeKind,
  organisation: FormOrganisation,
  currencyCode: string,
): PaymentPrintSource {
  const settles = settlesInvoices(kind, direction);
  const prefix = settles ? "INV" : "CN";
  return {
    kind,
    direction,
    status: "posted",
    documentNumber: "0001",
    paymentDate: new Date().toISOString().slice(0, 10),
    organisation,
    partyName: "North Dock Systems",
    partyAddressLines: ["4 Quay Units", "Dublin 1", "Ireland"],
    partyVatNumber: "",
    currencyCode,
    amount: 1800,
    meansLabel: "58 SEPA credit transfer",
    bankReference: "Sample reference",
    bankAccount: "B01 Current account",
    notes: "",
    voidReason: "",
    allocations: [
      { documentNumber: `${prefix}-0001`, date: new Date().toISOString().slice(0, 10), total: 1000, applied: 1000 },
      { documentNumber: `${prefix}-0002`, date: new Date().toISOString().slice(0, 10), total: 700, applied: 500 },
    ],
  };
}
