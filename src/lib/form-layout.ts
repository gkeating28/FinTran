import type { TransactionTypeKind } from "@/lib/transaction-types";

export const ORGANISATION_FIELDS = [
  "name",
  "address",
  "phone",
  "contactEmail",
  "website",
  "contactName",
  "vatNumber",
  "companyNumber",
] as const;

export const PARTY_FIELDS = [
  "contactDetails",
  "name",
  "address",
  "phone",
  "email",
  "website",
  "code",
] as const;

export const HEADER_FIELDS = [
  "reference",
  "transactionDate",
  "terms",
  "dueDate",
  "orderNumber",
  "currency",
  "exchangeRate",
  "paidAmount",
  "supplierReference",
  "supplyDate",
  "flex1",
  "flex2",
  "flex3",
  "flex4",
  "flex5",
] as const;

export const LINE_COLUMNS = [
  "date",
  "item",
  "description",
  "tax",
  "quantity",
  "price",
  "amount",
  "discount",
  "glCode",
  "vatCode",
  "department",
  "costCentre",
] as const;

export type OrganisationField = (typeof ORGANISATION_FIELDS)[number];
export type PartyField = (typeof PARTY_FIELDS)[number];
export type HeaderField = (typeof HEADER_FIELDS)[number];
export type LineColumn = (typeof LINE_COLUMNS)[number];

export const PAGE_SIZES = ["A4", "A5", "Letter", "Legal"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const PAGE_SIZE_OPTIONS: Record<PageSize, { label: string; width: string; height: string; css: string }> = {
  A4: { label: "A4", width: "210mm", height: "297mm", css: "A4" },
  A5: { label: "A5", width: "148mm", height: "210mm", css: "A5" },
  Letter: { label: "US Letter", width: "8.5in", height: "11in", css: "letter" },
  Legal: { label: "US Legal", width: "8.5in", height: "14in", css: "legal" },
};

export type FormLayout = {
  version: 1;
  title: string;
  pageSize: PageSize;
  showLogo: boolean;
  showVatSummary: boolean;
  showBanking: boolean;
  organisationFields: OrganisationField[];
  partyFields: PartyField[];
  headerFields: HeaderField[];
  lineColumns: LineColumn[];
};

const ORGANISATION_LABELS: Record<OrganisationField, string> = {
  name: "Name",
  address: "Address",
  phone: "Phone",
  contactEmail: "Email",
  website: "Web",
  contactName: "Contact name",
  vatNumber: "VAT number",
  companyNumber: "Company number",
};

const PARTY_LABELS: Record<PartyField, string> = {
  contactDetails: "Contact",
  name: "Name",
  address: "Address",
  phone: "Phone",
  email: "Email",
  website: "Web",
  code: "Code",
};

const HEADER_LABELS: Record<HeaderField, string> = {
  reference: "Invoice",
  transactionDate: "Date",
  terms: "Terms",
  dueDate: "Due date",
  orderNumber: "Order number",
  currency: "Currency",
  exchangeRate: "Exchange rate",
  paidAmount: "Paid",
  supplierReference: "Supplier invoice no.",
  supplyDate: "Supply date",
  flex1: "Flex 1",
  flex2: "Flex 2",
  flex3: "Flex 3",
  flex4: "Flex 4",
  flex5: "Flex 5",
};

const LINE_LABELS: Record<LineColumn, string> = {
  date: "Date",
  item: "Item",
  description: "Description",
  tax: "Tax",
  quantity: "Qty",
  price: "Rate",
  amount: "Amount",
  discount: "Discount",
  glCode: "GL",
  vatCode: "VAT code",
  department: "Department",
  costCentre: "Cost centre",
};

export function organisationFieldLabel(field: OrganisationField) {
  return ORGANISATION_LABELS[field];
}

export function partyFieldLabel(field: PartyField) {
  return PARTY_LABELS[field];
}

export function lineColumnLabel(column: LineColumn) {
  return LINE_LABELS[column];
}

export function headerFieldLabel(field: HeaderField, flexLabels: readonly string[], numberLabel: string) {
  if (field === "reference") return numberLabel;
  if (field.startsWith("flex")) {
    const label = flexLabels[Number(field.slice(4)) - 1]?.trim();
    return label || HEADER_LABELS[field];
  }
  return HEADER_LABELS[field];
}

export function documentNumberLabel(code: string, description: string) {
  const text = `${code} ${description}`.toLowerCase();
  if (text.includes("order")) return "Order";
  if (text.includes("return") || text.includes("credit")) return "Credit";
  if (text.includes("invoice")) return "Invoice";
  return "Number";
}

export function defaultTitle(kind: TransactionTypeKind, description: string) {
  if (kind === "Sales" && /invoice/i.test(description)) return "Tax Invoice";
  const title = description.trim();
  return title || "Tax Invoice";
}

export function defaultLayout(kind: TransactionTypeKind, description: string): FormLayout {
  return {
    version: 1,
    title: defaultTitle(kind, description),
    pageSize: "A4",
    showLogo: true,
    showVatSummary: true,
    showBanking: true,
    organisationFields: ["name", "address", "phone", "contactEmail", "vatNumber"],
    partyFields: ["contactDetails", "name", "address"],
    headerFields: ["reference", "transactionDate", "terms", "dueDate"],
    lineColumns: ["date", "item", "description", "tax", "quantity", "price", "amount"],
  };
}

function choose<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[]) {
  if (!Array.isArray(value)) return [...fallback];
  const chosen: T[] = [];
  for (const item of value) {
    if (typeof item === "string" && (allowed as readonly string[]).includes(item) && !chosen.includes(item as T)) {
      chosen.push(item as T);
    }
  }
  return chosen;
}

function flag(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function pageSize(value: unknown): PageSize {
  return PAGE_SIZES.includes(value as PageSize) ? (value as PageSize) : "A4";
}

export function parseLayout(value: unknown, kind: TransactionTypeKind, description: string): FormLayout {
  const base = defaultLayout(kind, description);
  if (!value || typeof value !== "object") return base;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  return {
    version: 1,
    title: title && title.length <= 80 ? title : base.title,
    pageSize: pageSize(record.pageSize),
    showLogo: flag(record.showLogo, base.showLogo),
    showVatSummary: flag(record.showVatSummary, base.showVatSummary),
    showBanking: flag(record.showBanking, base.showBanking),
    organisationFields: choose(record.organisationFields, ORGANISATION_FIELDS, base.organisationFields),
    partyFields: choose(record.partyFields, PARTY_FIELDS, base.partyFields),
    headerFields: choose(record.headerFields, HEADER_FIELDS, base.headerFields),
    lineColumns: choose(record.lineColumns, LINE_COLUMNS, base.lineColumns),
  };
}
