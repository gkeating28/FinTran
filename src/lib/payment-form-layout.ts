import {
  ORGANISATION_FIELDS,
  PAGE_SIZES,
  type OrganisationField,
  type PageSize,
} from "@/lib/form-layout";
import type { PaymentKind, TransactionTypeKind } from "@/lib/transaction-types";

/**
 * The form of a payment, receipt or refund. It is saved in the same table as a document's form and uses the same
 * settings, but what it can show is its own: the fields a payment prints, and, as its line columns, what it says about
 * each document it settled.
 */
export const PAYMENT_PARTY_FIELDS = ["name", "address", "vatNumber"] as const;
export const PAYMENT_HEADER_FIELDS = ["documentNumber", "transactionDate", "paymentMeans", "bankReference", "bankAccount", "currency"] as const;
export const PAYMENT_LINE_COLUMNS = ["document", "date", "total", "applied"] as const;

export type PaymentPartyField = (typeof PAYMENT_PARTY_FIELDS)[number];
export type PaymentHeaderField = (typeof PAYMENT_HEADER_FIELDS)[number];
export type PaymentLineColumn = (typeof PAYMENT_LINE_COLUMNS)[number];

export type PaymentFormLayout = {
  version: 1;
  title: string;
  pageSize: PageSize;
  showLogo: boolean;
  organisationFields: OrganisationField[];
  partyFields: PaymentPartyField[];
  headerFields: PaymentHeaderField[];
  lineColumns: PaymentLineColumn[];
};

/** What the database insists a payment form shows, and so what the designer will not let anyone remove. */
export const PAYMENT_REQUIRED = {
  organisationFields: ["name"],
  partyFields: ["name"],
  headerFields: ["documentNumber", "transactionDate"],
  lineColumns: ["document", "applied"],
} as const;

/** Money paid out is a remittance advice and money received is a receipt. */
export function paymentTitle(kind: PaymentKind) {
  return kind === "payment" ? "Remittance advice" : "Receipt";
}

/** A payment out or a refund to a customer settles what was owed. Money in from a supplier settles a credit note. */
export function settlesInvoices(kind: PaymentKind, direction: TransactionTypeKind) {
  return (kind === "receipt" && direction === "Sales") || (kind === "payment" && direction === "Purchases");
}

export function paymentPartyLabel(kind: PaymentKind) {
  return kind === "payment" ? "Paid to" : "Received from";
}

export function paymentPartyFieldLabel(field: PaymentPartyField) {
  return { name: "Name", address: "Address", vatNumber: "VAT number" }[field];
}

export function paymentHeaderFieldLabel(field: PaymentHeaderField, kind: PaymentKind) {
  switch (field) {
    case "documentNumber":
      return "Number";
    case "transactionDate":
      return "Date";
    case "paymentMeans":
      return "Payment method";
    case "bankReference":
      return "Bank reference";
    case "bankAccount":
      return kind === "payment" ? "Paid from" : "Paid into";
    case "currency":
      return "Currency";
  }
}

export function paymentLineColumnLabel(column: PaymentLineColumn, settles: "invoices" | "credit notes") {
  switch (column) {
    case "document":
      return settles === "invoices" ? "Invoice" : "Credit note";
    case "date":
      return "Date";
    case "total":
      return "Document total";
    case "applied":
      return "Amount applied";
  }
}

export function defaultPaymentLayout(kind: PaymentKind): PaymentFormLayout {
  return {
    version: 1,
    title: paymentTitle(kind),
    pageSize: "A4",
    showLogo: true,
    organisationFields: ["name", "address", "phone", "contactEmail", "website", "vatNumber", "companyNumber"],
    partyFields: ["name", "address", "vatNumber"],
    headerFields: ["documentNumber", "transactionDate", "paymentMeans", "bankReference", "bankAccount", "currency"],
    lineColumns: ["document", "date", "total", "applied"],
  };
}

function choose<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]) {
  if (!Array.isArray(value)) return [...fallback];
  const chosen: T[] = [];
  for (const item of value) {
    if (typeof item === "string" && (allowed as readonly string[]).includes(item) && !chosen.includes(item as T)) chosen.push(item as T);
  }
  return chosen;
}

/** A saved layout read back, with anything the printed payment cannot show left out. Unknown or missing parts take the standard layout's. */
export function parsePaymentLayout(value: unknown, kind: PaymentKind): PaymentFormLayout {
  const base = defaultPaymentLayout(kind);
  if (!value || typeof value !== "object") return base;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  return {
    version: 1,
    title: title && title.length <= 80 ? title : base.title,
    pageSize: PAGE_SIZES.includes(record.pageSize as PageSize) ? (record.pageSize as PageSize) : "A4",
    showLogo: typeof record.showLogo === "boolean" ? record.showLogo : base.showLogo,
    organisationFields: choose(record.organisationFields, ORGANISATION_FIELDS, base.organisationFields),
    partyFields: choose(record.partyFields, PAYMENT_PARTY_FIELDS, base.partyFields),
    headerFields: choose(record.headerFields, PAYMENT_HEADER_FIELDS, base.headerFields),
    lineColumns: choose(record.lineColumns, PAYMENT_LINE_COLUMNS, base.lineColumns),
  };
}

/** The parts a payment form must have are put back if they were left out, the way the designer does before it saves. */
export function withRequiredPaymentFields(layout: PaymentFormLayout): PaymentFormLayout {
  const add = <T extends string>(current: readonly T[], required: readonly T[]) => [...current, ...required.filter((item) => !current.includes(item))];
  return {
    ...layout,
    organisationFields: add(layout.organisationFields, PAYMENT_REQUIRED.organisationFields),
    partyFields: add(layout.partyFields, PAYMENT_REQUIRED.partyFields),
    headerFields: add(layout.headerFields, PAYMENT_REQUIRED.headerFields),
    lineColumns: add(layout.lineColumns, PAYMENT_REQUIRED.lineColumns),
  };
}
