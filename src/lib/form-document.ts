import { formatExchangeRate } from "@/lib/currencies";
import {
  headerFieldLabel,
  lineColumnLabel,
  partyFieldLabel,
  type FormLayout,
  type HeaderField,
  type LineColumn,
} from "@/lib/form-layout";
import { formatInteger } from "@/lib/numbers";
import { formatProductPrice as formatMoney } from "@/lib/products";

export type FormOrganisation = {
  name: string;
  address: string;
  phone: string;
  contactName: string;
  contactEmail: string;
  website: string;
  vatNumber: string;
  companyNumber: string;
  bankingDetails: string;
  logoUrl: string | null;
};

export type FormParty = {
  code: string;
  name: string;
  address: string;
  contactDetails: string;
  phone: string;
  email: string;
  website: string;
};

export type FormHeader = {
  reference: string;
  transactionDate: string;
  dueDate: string;
  orderNumber: string;
  currencyCode: string;
  exchangeRate: string;
  paidAmount: number;
  flex: [string, string, string, string, string];
  foreignNett: number;
  foreignVat: number;
  foreignTotal: number;
};

export type FormLine = {
  item: string;
  description: string;
  tax: string;
  taxRate: number | null;
  quantity: number;
  price: number;
  discount: number;
  nett: number;
  vat: number;
  glCode: string;
  vatCode: string;
  department: string;
  costCentre: string;
};

export type FormSource = {
  organisation: FormOrganisation;
  party: FormParty;
  header: FormHeader;
  lines: FormLine[];
  flexLabels: [string, string, string, string, string];
  numberLabel: string;
};

export type PrintCell = {
  text: string;
  align: "left" | "right";
};

export type PrintHeader = {
  key: string;
  label: string;
  align: "left" | "right";
};

export type PrintView = {
  title: string;
  pageSize: FormLayout["pageSize"];
  showLogo: boolean;
  logoUrl: string | null;
  organisationName: string;
  organisationLines: string[];
  partyLines: string[];
  headerLines: { label: string; value: string }[];
  lineHeaders: PrintHeader[];
  lineRows: PrintCell[][];
  subtotal: string;
  tax: string;
  total: string;
  paid: string | null;
  balance: string;
  vatRows: { rate: string; vat: string; nett: string }[];
  showVatSummary: boolean;
  footerTitle: string;
  footerBody: string;
  showFooter: boolean;
};

function linesOf(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatInvoiceDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatQuantity(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 0.0001) return formatInteger(Math.round(value));
  return formatMoney(value);
}

function formatPercent(rate: number) {
  const text = rate.toFixed(2).replace(/\.?0+$/, "");
  return `VAT @ ${text}%`;
}

function terms(start: string, due: string) {
  const opened = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const closed = Date.parse(`${due.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(opened) || !Number.isFinite(closed)) return "";
  const days = Math.round((closed - opened) / 86400000);
  if (days <= 0) return "Due on receipt";
  return `Net ${days}`;
}

function headerValue(field: HeaderField, source: FormSource) {
  const header = source.header;
  if (field === "reference") return header.reference;
  if (field === "transactionDate") return formatInvoiceDate(header.transactionDate);
  if (field === "dueDate") return formatInvoiceDate(header.dueDate);
  if (field === "terms") return terms(header.transactionDate, header.dueDate);
  if (field === "orderNumber") return header.orderNumber;
  if (field === "currency") return header.currencyCode;
  if (field === "exchangeRate") return header.exchangeRate ? formatExchangeRate(header.exchangeRate) : "";
  if (field === "paidAmount") return formatMoney(header.paidAmount);
  const index = Number(field.slice(4)) - 1;
  return header.flex[index] ?? "";
}

function lineValue(column: LineColumn, line: FormLine, date: string): PrintCell {
  const right = ["quantity", "price", "amount", "discount"].includes(column);
  const text = (() => {
    if (column === "date") return date;
    if (column === "item") return line.item;
    if (column === "description") return line.description;
    if (column === "tax") return line.tax;
    if (column === "quantity") return formatQuantity(line.quantity);
    if (column === "price") return formatMoney(line.price);
    if (column === "amount") return formatMoney(line.nett);
    if (column === "discount") return formatMoney(line.discount);
    if (column === "glCode") return line.glCode;
    if (column === "vatCode") return line.vatCode;
    if (column === "department") return line.department;
    return line.costCentre;
  })();
  return { text, align: right ? "right" : "left" };
}

const RIGHT_ALIGNED = new Set<LineColumn>(["quantity", "price", "amount", "discount"]);

function lineHeaders(columns: LineColumn[]): PrintHeader[] {
  return columns.map((column) => ({
    key: column,
    label: lineColumnLabel(column),
    align: RIGHT_ALIGNED.has(column) ? "right" : "left",
  }));
}

export function buildPrintView(layout: FormLayout, source: FormSource): PrintView {
  const organisation = source.organisation;
  const organisationLines: string[] = [];
  for (const field of layout.organisationFields) {
    if (field === "name") continue;
    if (field === "address") {
      const lines = linesOf(organisation.address);
      organisationLines.push(...(lines.length ? lines : ["Address"]));
    }
    if (field === "phone") organisationLines.push(organisation.phone || "Phone");
    if (field === "contactEmail") organisationLines.push(organisation.contactEmail || "Email");
    if (field === "website") organisationLines.push(organisation.website || "Web");
    if (field === "contactName") organisationLines.push(organisation.contactName || "Contact name");
    if (field === "vatNumber") organisationLines.push(organisation.vatNumber ? `VAT ID: ${organisation.vatNumber}` : "VAT ID");
    if (field === "companyNumber") {
      organisationLines.push(organisation.companyNumber ? `Company no. ${organisation.companyNumber}` : "Company no.");
    }
  }

  const partyLines = layout.partyFields.flatMap((field) => {
    const value = source.party[field];
    if (field === "address") {
      const lines = linesOf(value);
      return lines.length ? lines : ["Address"];
    }
    return [value.trim() || partyFieldLabel(field)];
  });

  const headerLines = layout.headerFields.map((field) => ({
    label: headerFieldLabel(field, source.flexLabels, source.numberLabel),
    value: headerValue(field, source) || "\u00a0",
  }));

  const columns = layout.lineColumns;
  const date = formatInvoiceDate(source.header.transactionDate);
  const lineRows = source.lines.map((line) => columns.map((column) => lineValue(column, line, date)));

  const groups = new Map<string, { label: string; nett: number; vat: number }>();
  for (const line of source.lines) {
    const key = line.taxRate == null ? "none" : line.taxRate.toFixed(2);
    const current = groups.get(key) ?? {
      label: line.taxRate == null ? "No VAT" : formatPercent(line.taxRate),
      nett: 0,
      vat: 0,
    };
    current.nett += line.nett;
    current.vat += line.vat;
    groups.set(key, current);
  }

  const paid = source.header.paidAmount;
  const balance = Math.max(0, source.header.foreignTotal - paid);
  const currency = source.header.currencyCode;
  const footerBody = organisation.bankingDetails.trim();

  return {
    title: layout.title,
    pageSize: layout.pageSize,
    showLogo: layout.showLogo,
    logoUrl: layout.showLogo ? organisation.logoUrl : null,
    organisationName: layout.organisationFields.includes("name") ? organisation.name || "Name" : "",
    organisationLines,
    partyLines,
    headerLines,
    lineHeaders: lineHeaders(columns),
    lineRows,
    subtotal: formatMoney(source.header.foreignNett),
    tax: formatMoney(source.header.foreignVat),
    total: formatMoney(source.header.foreignTotal),
    paid: paid > 0 ? formatMoney(paid) : null,
    balance: currency ? `${currency} ${formatMoney(balance)}` : formatMoney(balance),
    vatRows: [...groups.values()].map((group) => ({
      rate: group.label,
      vat: formatMoney(group.vat),
      nett: formatMoney(group.nett),
    })),
    showVatSummary: layout.showVatSummary,
    footerTitle: organisation.name || "Organisation",
    footerBody: footerBody || "Bank details",
    showFooter: layout.showBanking,
  };
}

export function sampleSource(organisation: FormOrganisation, currencyCode: string): FormSource {
  return {
    organisation,
    party: {
      code: "NORTH",
      name: "North Dock Systems",
      address: "4 Quay Units\nDublin 1\nIreland",
      contactDetails: "Ms Niamh Kelly",
      phone: "+353 1 555 0190",
      email: "accounts@northdock.example",
      website: "",
    },
    header: {
      reference: "1030",
      transactionDate: "2026-09-30",
      dueDate: "2026-10-30",
      orderNumber: "",
      currencyCode: currencyCode || "EUR",
      exchangeRate: "1",
      paidAmount: 0,
      flex: ["", "", "", "", ""],
      foreignNett: 4000,
      foreignVat: 920,
      foreignTotal: 4920,
    },
    lines: [
      {
        item: "Consultancy",
        description: "Product & sales consultancy services",
        tax: "Standard",
        taxRate: 23,
        quantity: 4,
        price: 1000,
        discount: 0,
        nett: 4000,
        vat: 920,
        glCode: "",
        vatCode: "S23",
        department: "",
        costCentre: "",
      },
    ],
    flexLabels: ["", "", "", "", ""],
    numberLabel: "Invoice",
  };
}

export function emptyOrganisation(): FormOrganisation {
  return {
    name: "",
    address: "",
    phone: "",
    contactName: "",
    contactEmail: "",
    website: "",
    vatNumber: "",
    companyNumber: "",
    bankingDetails: "",
    logoUrl: null,
  };
}
