import { formatExchangeRate } from "@/lib/currencies";
import {
  headerFieldLabel,
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
  label: string;
  align: "left" | "right";
  span: number;
};

export type PrintView = {
  title: string;
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
  if (field === "paidAmount") return header.paidAmount > 0 ? formatMoney(header.paidAmount) : "";
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

function lineHeaders(columns: LineColumn[]): PrintHeader[] {
  const headers: PrintHeader[] = [];
  for (let index = 0; index < columns.length; ) {
    const column = columns[index];
    if (column === "item" || column === "description") {
      let span = 1;
      while (columns[index + span] === "item" || columns[index + span] === "description") span += 1;
      headers.push({ label: "Description", align: "left", span });
      index += span;
      continue;
    }
    const align = ["quantity", "price", "amount", "discount"].includes(column) ? "right" : "left";
    const label =
      column === "price" ? "Rate" : column === "amount" ? "Amount" : column === "tax" ? "Tax" : column === "quantity" ? "Qty" : column === "date" ? "Date" : column;
    headers.push({
      label:
        column === "glCode"
          ? "GL"
          : column === "vatCode"
            ? "VAT code"
            : column === "costCentre"
              ? "Cost centre"
              : column === "department"
                ? "Department"
                : column === "discount"
                  ? "Discount"
                  : label,
      align,
      span: 1,
    });
    index += 1;
  }
  return headers;
}

export function buildPrintView(layout: FormLayout, source: FormSource): PrintView {
  const organisation = source.organisation;
  const organisationLines: string[] = [];
  for (const field of layout.organisationFields) {
    if (field === "name") continue;
    if (field === "address") organisationLines.push(...linesOf(organisation.address));
    if (field === "phone" && organisation.phone) organisationLines.push(organisation.phone);
    if (field === "contactEmail" && organisation.contactEmail) organisationLines.push(organisation.contactEmail);
    if (field === "website" && organisation.website) organisationLines.push(organisation.website);
    if (field === "contactName" && organisation.contactName) organisationLines.push(organisation.contactName);
    if (field === "vatNumber" && organisation.vatNumber) organisationLines.push(`VAT ID: ${organisation.vatNumber}`);
    if (field === "companyNumber" && organisation.companyNumber) {
      organisationLines.push(`Company no. ${organisation.companyNumber}`);
    }
  }

  const partyLines: string[] = [];
  for (const field of layout.partyFields) {
    const value = source.party[field];
    if (field === "address") partyLines.push(...linesOf(value));
    else if (value.trim()) partyLines.push(value.trim());
  }

  const headerLines = layout.headerFields.flatMap((field) => {
    const value = headerValue(field, source);
    if (!value) return [];
    return [{ label: headerFieldLabel(field, source.flexLabels, source.numberLabel), value }];
  });

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
  const showFooter = layout.showBanking && Boolean(organisation.name || footerBody);

  return {
    title: layout.title,
    logoUrl: layout.showLogo ? organisation.logoUrl : null,
    organisationName: layout.organisationFields.includes("name") ? organisation.name : "",
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
    showVatSummary: layout.showVatSummary && source.lines.length > 0,
    footerTitle: organisation.name,
    footerBody,
    showFooter,
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
