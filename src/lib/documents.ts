import { parseCurrencyRate } from "@/lib/currencies";
import { numberValue } from "@/lib/numbers";
import { formatProductPrice, parseProductPrice } from "@/lib/products";
import type { DocumentKind, DocumentStatus } from "@/lib/transaction-types";

export type DocumentLine = {
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
  unitCode: string;
  lineNote: string;
  sellerItemId: string;
  /** The stored line. A save keeps it, so other documents can point at this line. */
  id?: string;
  /** The order line an invoice line came from, or the requisition line an order line came from. */
  sourceLineId?: string;
  /**
   * The quantity used on an order line: Invoiced plus Reserved. Void documents do not count, and a posted credit note
   * marked Return to order gives its quantity back.
   */
  drawnQuantity?: string;
  /** On an order line: posted invoice quantity less returned credit quantity. */
  invoicedQuantity?: string;
  /** On an order line: quantity held by draft invoices. */
  reservedQuantity?: string;
  /** On a credit note line: the line of the credited invoice this line credits. */
  creditedLineId?: string;
  /** On a credit note line: posting it gives the quantity back to the order the invoice line came from. */
  returnsToOrder?: boolean;
  /** True when the credited invoice line came from an order, so Return to order can be ticked. */
  canReturnToOrder?: boolean;
  /** The number of the document the line came from, and that number with its type code for display. */
  sourceNumber?: string;
  sourceDocument?: string;
  /** The line of the buyer's purchase order this line answers. */
  orderLineReference?: string;
};

/** A document made from another one, or the one it was made from. */
export type LinkedDocument = {
  id: string;
  typeCode: string;
  documentNumber: string;
  transactionDate: string;
  total: string;
  status: DocumentStatus;
};

export type LinkedCredit = {
  id: string;
  typeCode: string;
  documentNumber: string;
  transactionDate: string;
  total: string;
  status: DocumentStatus;
};

export type DocumentRow = {
  id: string;
  transactionTypeId: string;
  transactionTypeCode: string;
  reference: number | null;
  documentNumber: string;
  transactionDate: string;
  dueDate: string;
  supplierId: string;
  customerId: string;
  supplierCode: string;
  supplierName: string;
  contactDetails: string;
  notes: string;
  currencyId: string;
  currencyCode: string;
  exchangeRate: string;
  /** The buyer's purchase order number or numbers. */
  orderNumber: string;
  /** The seller's own order number or numbers. Used on sales documents. */
  salesOrderReference: string;
  supplierReference: string;
  supplyDate: string;
  foreignNettAmount: string;
  foreignVatAmount: string;
  foreignTotalAmount: string;
  homeNettAmount: string;
  homeVatAmount: string;
  homeTotalAmount: string;
  paidAmount: string;
  roundingAmount: string;
  amountDue: string;
  precedingHeaderId: string;
  precedingReference: string;
  precedingDate: string;
  buyerReference: string;
  contractReference: string;
  paymentTerms: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  paymentMeansCode: string;
  breakdown: VatBreakdownRow[];
  readiness: ReadinessItem[];
  status: DocumentStatus;
  voidReason: string;
  flex1: string;
  flex2: string;
  flex3: string;
  flex4: string;
  flex5: string;
  lines: DocumentLine[];
  credits: LinkedCredit[];
  remainingAmount: string;
  /** For an order: how far it has been invoiced, and the nett value on invoices and still to invoice. Empty for other kinds. */
  invoicing: "none" | "part" | "full" | "";
  invoicedNett: string;
  remainingNett: string;
  /** Documents made from this one: purchase orders from a requisition, invoices from an order. */
  followOns: LinkedDocument[];
  /** The order or requisition this document was made from. */
  sources: LinkedDocument[];
};

export type PurchaseTypeChoice = {
  id: string;
  code: string;
  description: string;
  documentKind: DocumentKind;
  nextReference: number;
  flexLabels: [string, string, string, string, string];
};

export type CreditInvoice = {
  id: string;
  reference: number | null;
  documentNumber: string;
  transactionDate: string;
  supplierId: string;
  customerId: string;
  currencyId: string;
  typeCode: string;
};

/** An active order an invoice can bring lines in from, with the lines that still have something left. */
export type OrderSource = {
  id: string;
  typeCode: string;
  documentNumber: string;
  transactionDate: string;
  partyId: string;
  /** The customer's purchase order number entered on a sales order. */
  orderNumber: string;
  lines: (DocumentLine & { remainingQuantity: string })[];
};

/** A type a document can be turned into: an invoice type for an order, an order type for a requisition. */
export type FollowOnType = {
  id: string;
  code: string;
  description: string;
  documentKind: DocumentKind;
};

export type CreditNoteType = {
  id: string;
  code: string;
  description: string;
};

export type SupplierChoice = {
  id: string;
  code: string;
  name: string;
  contactDetails: string;
  currencyId: string;
  paymentTermsDays: string;
  buyerReference: string;
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
  salesPrice: string;
  purchaseGlCodeId: string;
  salesGlCodeId: string;
  purchaseVatCodeId: string;
  salesVatCodeId: string;
  unitCode: string;
};

export type InvoiceCode = {
  id: string;
  code: string;
  description: string;
  accountType?: string;
};

export type PaymentMeansChoice = {
  code: string;
  name: string;
  common: boolean;
};

export type InvoiceVat = InvoiceCode & {
  rate: string;
  vatType: string;
  vatCategory: string;
  exemptionReason: string;
};

export type ReadinessItem = {
  ruleId: string;
  severity: "error" | "warning";
  businessTerm: string;
  message: string;
};

export type VatBreakdownRow = {
  category: string;
  rate: number;
  taxable: number;
  vat: number;
  exemption: string;
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

export function roundCents(value: number) {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
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
  if (disc > qty * unit) return { error: "Discount cannot be more than quantity times price." } as const;
  const nett = roundCents(qty * unit - disc);
  const vat = vatPercent == null ? 0 : roundCents((nett * Number(vatPercent)) / 100);
  return { nett, vat } as const;
}

export function breakdownFromLines(
  lines: { nett: number; rate: number | null; category: string; exemption: string }[],
): VatBreakdownRow[] {
  const groups = new Map<string, { category: string; rate: number; taxable: number; exemption: string }>();
  for (const line of lines) {
    const category = line.category || "O";
    const rate = line.rate ?? 0;
    const key = `${category}|${rate}`;
    const current = groups.get(key) ?? { category, rate, taxable: 0, exemption: line.exemption };
    current.taxable += line.nett;
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => {
    const taxable = roundCents(group.taxable);
    return {
      category: group.category,
      rate: group.rate,
      taxable,
      vat: roundCents((taxable * group.rate) / 100),
      exemption: group.exemption,
    };
  });
}

export function toHome(foreign: number, rate: string) {
  const exchange = numberValue(rate);
  if (!(exchange > 0)) return 0;
  return roundCents(foreign / exchange);
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
