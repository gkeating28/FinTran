import { numberValue } from "@/lib/numbers";
import { formatProductPrice, parseProductPrice } from "@/lib/products";
import { parseCurrencyRate } from "@/lib/currencies";

export type PurchaseInvoiceLine = {
  lineNumber: number;
  productId: string;
  productCode: string;
  description: string;
  glCodeId: string;
  departmentId: string;
  costCentreId: string;
  vatRateId: string;
  quantity: string;
  price: string;
  discountAmount: string;
  nettAmount: string;
  vatAmount: string;
};

export type PurchaseInvoiceRow = {
  id: string;
  transactionTypeId: string;
  transactionTypeCode: string;
  reference: number;
  transactionDate: string;
  dueDate: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  contactDetails: string;
  notes: string;
  currencyId: string;
  currencyCode: string;
  exchangeRate: string;
  orderNumber: string;
  foreignNettAmount: string;
  foreignVatAmount: string;
  foreignTotalAmount: string;
  homeNettAmount: string;
  homeVatAmount: string;
  homeTotalAmount: string;
  paidAmount: string;
  flex1: string;
  flex2: string;
  flex3: string;
  flex4: string;
  flex5: string;
  lines: PurchaseInvoiceLine[];
};

export type PurchaseTypeChoice = {
  id: string;
  code: string;
  description: string;
  nextReference: number;
  flexLabels: [string, string, string, string, string];
};

export type SupplierChoice = {
  id: string;
  code: string;
  name: string;
  contactDetails: string;
  currencyId: string;
};

export type InvoiceCurrency = {
  id: string;
  code: string;
  rate: string;
};

export type InvoiceProduct = {
  id: string;
  code: string;
  description: string;
  purchasePrice: string;
  purchaseGlCodeId: string;
  purchaseVatCodeId: string;
};

export type InvoiceCode = {
  id: string;
  code: string;
  description: string;
};

export type InvoiceVat = InvoiceCode & {
  rate: string;
  vatType: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUuid(value: string) {
  const trimmed = value.trim();
  if (!UUID.test(trimmed)) return null;
  return trimmed;
}

export function optionalUuid(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseUuid(trimmed);
}

export function parseInvoiceDate(value: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export function optionalText(value: string, max: number) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

export function roundMoney(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function lineAmounts(
  quantity: string,
  price: string,
  discount: string,
  vatPercent: string | null,
) {
  const qty = numberValue(quantity);
  const unit = numberValue(price);
  const disc = numberValue(discount || 0);
  if (!(qty > 0) || !(unit >= 0) || !(disc >= 0)) return null;
  const gross = roundMoney(qty * unit);
  if (disc > gross) return { error: "Discount cannot be more than quantity times price." } as const;
  const nett = roundMoney(gross - disc);
  const vat = vatPercent == null ? 0 : roundMoney((nett * Number(vatPercent)) / 100);
  return { nett, vat } as const;
}

export function toHome(foreign: number, rate: string) {
  const exchange = numberValue(rate);
  if (!(exchange > 0)) return 0;
  return roundMoney(foreign / exchange);
}

export function formatMoney(value: string | number | null) {
  return formatProductPrice(value);
}

export function parseMoney(value: string) {
  return parseProductPrice(value);
}

export function parseExchangeRate(value: string) {
  return parseCurrencyRate(value);
}
