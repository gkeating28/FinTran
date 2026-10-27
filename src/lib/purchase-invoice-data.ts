import type { UnitChoice } from "@/lib/code-lists";
import { getWorkspace } from "@/lib/data";
import { formatCurrencyRate, formatExchangeRate } from "@/lib/currencies";
import { formatProductPrice } from "@/lib/products";
import { parseAccountType, parseVatType } from "@/lib/reference";
import {
  formatMoney,
  type InvoiceCode,
  type InvoiceCurrency,
  type InvoiceProduct,
  type InvoiceVat,
  type PaymentMeansChoice,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceRow,
  type CreditInvoice,
  type CreditNoteType,
  type PurchaseTypeChoice,
  type SupplierChoice,
} from "@/lib/purchase-invoices";
import { listUnits } from "@/lib/reference-data";
import { parseDocumentKind } from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";

function embeddedType(
  value:
    | { code: string; type: string; document_kind: string }
    | { code: string; type: string; document_kind: string }[]
    | null,
) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function embeddedCode(value: { code: string } | { code: string }[] | null) {
  if (Array.isArray(value)) return value[0]?.code ?? "";
  return value?.code ?? "";
}

function toPurchaseInvoiceLine(row: {
  line_number: number;
  product_id: string | null;
  description: string;
  gl_code_id: string | null;
  department_id: string | null;
  cost_centre_id: string | null;
  vat_rate_id: string | null;
  quantity: number | string;
  price: number | string;
  discount_amount: number | string;
  nett_amount: number | string;
  vat_amount: number | string;
  unit_code: string;
  line_note: string | null;
  seller_item_id: string | null;
  products: { code: string } | { code: string }[] | null;
}): PurchaseInvoiceLine {
  return {
    lineNumber: row.line_number,
    productId: row.product_id ?? "",
    productCode: embeddedCode(row.products),
    description: row.description,
    glCodeId: row.gl_code_id ?? "",
    departmentId: row.department_id ?? "",
    costCentreId: row.cost_centre_id ?? "",
    vatRateId: row.vat_rate_id ?? "",
    quantity: formatMoney(row.quantity),
    price: formatMoney(row.price),
    discountAmount: formatMoney(row.discount_amount),
    nettAmount: formatMoney(row.nett_amount),
    vatAmount: formatMoney(row.vat_amount),
    unitCode: row.unit_code || "C62",
    lineNote: row.line_note ?? "",
    sellerItemId: row.seller_item_id ?? "",
  };
}

export type PurchaseInvoiceChoices = {
  types: PurchaseTypeChoice[];
  suppliers: SupplierChoice[];
  customers: SupplierChoice[];
  creditNoteTypes: CreditNoteType[];
  currencies: InvoiceCurrency[];
  homeCurrencyCode: string;
  products: InvoiceProduct[];
  glCodes: InvoiceCode[];
  departments: InvoiceCode[];
  costCentres: InvoiceCode[];
  vatRates: InvoiceVat[];
  creditInvoices: CreditInvoice[];
  units: UnitChoice[];
  paymentMeans: PaymentMeansChoice[];
};

const emptyChoices: PurchaseInvoiceChoices = {
  types: [],
  suppliers: [],
  customers: [],
  creditNoteTypes: [],
  currencies: [],
  homeCurrencyCode: "",
  products: [],
  glCodes: [],
  departments: [],
  costCentres: [],
  vatRates: [],
  creditInvoices: [],
  units: [],
  paymentMeans: [],
};

export async function listPurchaseInvoices(typeCode?: string): Promise<{
  rows: PurchaseInvoiceRow[];
  choices: PurchaseInvoiceChoices;
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], choices: emptyChoices, error: null };

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [headers, lineRows, types, suppliers, customers, currencies, defaults, products, glCodes, departments, costCentres, vatRates, units, paymentMeans] =
    await Promise.all([
      supabase
        .from("transaction_headers")
        .select(
          `id, transaction_type_id, reference, document_number, transaction_date, due_date, supplier_id, customer_id, party_name,
           contact_details, notes, currency_id, exchange_rate, order_number, supplier_reference, supply_date,
           foreign_nett_amount, foreign_vat_amount, foreign_total_amount,
           home_nett_amount, home_vat_amount, home_total_amount, paid_amount,
           rounding_amount, amount_due, preceding_header_id, preceding_reference, preceding_date,
           buyer_reference, contract_reference, payment_terms, invoice_period_start, invoice_period_end, payment_means_code,
           status, void_reason,
           flex1, flex2, flex3, flex4, flex5,
           transaction_types(code, type, document_kind), suppliers(code), customers(code), currencies(code),
           transaction_vat_breakdown(vat_category, vat_percentage, taxable_amount, vat_amount, exemption_code, exemption_reason)`,
        )
        .eq("organisation_id", organisationId)
        .order("transaction_date", { ascending: false })
        .order("reference", { ascending: false }),
      supabase
        .from("transaction_lines")
        .select(
          `header_id, line_number, product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
           quantity, price, discount_amount, nett_amount, vat_amount, unit_code, line_note, seller_item_id, products(code)`,
        )
        .eq("organisation_id", organisationId)
        .order("line_number"),
      supabase
        .from("transaction_types")
        .select("id, code, description, last_reference, type, document_kind, flex1_label, flex2_label, flex3_label, flex4_label, flex5_label")
        .eq("organisation_id", organisationId)
        .order("code"),
      supabase
        .from("suppliers")
        .select("id, code, name, contact_details, currency_id")
        .eq("organisation_id", organisationId)
        .order("code"),
      supabase
        .from("customers")
        .select("id, code, name, contact_details, currency_id, payment_terms_days, default_buyer_reference")
        .eq("organisation_id", organisationId)
        .order("code"),
      supabase.from("currencies").select("id, code, rate").eq("organisation_id", organisationId).order("code"),
      supabase
        .from("organisation_defaults")
        .select("currencies(code)")
        .eq("organisation_id", organisationId)
        .maybeSingle(),
      supabase
        .from("products")
        .select("id, code, description, purchase_price, sales_price, purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id, unit_code")
        .eq("organisation_id", organisationId)
        .order("code"),
      supabase
        .from("gl_codes")
        .select("id, code, description, account_type")
        .eq("organisation_id", organisationId)
        .order("code"),
      supabase.from("departments").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase.from("cost_centres").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase
        .from("vat_rates")
        .select("id, code, description, rate, vat_type, vat_category, exemption_reason")
        .eq("organisation_id", organisationId)
        .order("code"),
      listUnits(),
      supabase.from("ref_payment_means").select("code, name, common").order("common", { ascending: false }).order("code"),
    ]);

  if (
    headers.error ||
    lineRows.error ||
    types.error ||
    suppliers.error ||
    customers.error ||
    currencies.error ||
    defaults.error ||
    products.error ||
    glCodes.error ||
    departments.error ||
    costCentres.error ||
    vatRates.error ||
    units.error ||
    paymentMeans.error
  ) {
    return { rows: [], choices: emptyChoices, error: "Purchase invoices could not be loaded." };
  }

  const wantedCode = typeCode?.trim().toUpperCase() ?? "";
  const requestedType = (types.data ?? []).find((row) => row.code === wantedCode);
  const direction = requestedType?.type === "Sales" ? "Sales" : "Purchases";
  const typeIds = new Set(
    (types.data ?? []).flatMap((row) => {
      if (row.type !== direction) return [];
      if (wantedCode && row.code !== wantedCode) return [];
      return [row.id];
    }),
  );
  const postedCreditTotals = new Map<string, number>();
  const creditLists = new Map<string, PurchaseInvoiceRow["credits"]>();
  for (const row of headers.data ?? []) {
    if (!row.preceding_header_id) continue;
    const kind = embeddedType(row.transaction_types);
    const credit = {
      id: row.id,
      typeCode: kind?.code ?? "",
      documentNumber: row.document_number ?? (row.reference == null ? "" : String(row.reference)),
      transactionDate: row.transaction_date,
      total: formatMoney(row.foreign_total_amount),
      status: row.status,
    };
    const list = creditLists.get(row.preceding_header_id) ?? [];
    list.push(credit);
    creditLists.set(row.preceding_header_id, list);
    if (row.status === "posted" && kind?.document_kind === "credit_note") {
      postedCreditTotals.set(
        row.preceding_header_id,
        (postedCreditTotals.get(row.preceding_header_id) ?? 0) + Number(row.foreign_total_amount),
      );
    }
  }

  const linesByHeader = new Map<string, PurchaseInvoiceLine[]>();
  for (const line of lineRows.data ?? []) {
    const list = linesByHeader.get(line.header_id) ?? [];
    list.push(toPurchaseInvoiceLine(line));
    linesByHeader.set(line.header_id, list);
  }

  const rows = (headers.data ?? []).flatMap((row) => {
      if (typeCode && !typeIds.has(row.transaction_type_id)) return [];
      return [{
      id: row.id,
      transactionTypeId: row.transaction_type_id,
      transactionTypeCode: embeddedCode(row.transaction_types),
      reference: row.reference,
      documentNumber: row.document_number ?? "",
      transactionDate: row.transaction_date,
      dueDate: row.due_date ?? "",
      supplierId: row.supplier_id ?? "",
      customerId: row.customer_id ?? "",
      supplierCode: embeddedCode(row.suppliers) || embeddedCode(row.customers),
      supplierName: row.party_name,
      contactDetails: row.contact_details ?? "",
      notes: row.notes ?? "",
      currencyId: row.currency_id,
      currencyCode: embeddedCode(row.currencies),
      exchangeRate: formatExchangeRate(row.exchange_rate),
      orderNumber: row.order_number ?? "",
      supplierReference: row.supplier_reference ?? "",
      supplyDate: row.supply_date ?? "",
      foreignNettAmount: formatMoney(row.foreign_nett_amount),
      foreignVatAmount: formatMoney(row.foreign_vat_amount),
      foreignTotalAmount: formatMoney(row.foreign_total_amount),
      homeNettAmount: formatMoney(row.home_nett_amount),
      homeVatAmount: formatMoney(row.home_vat_amount),
      homeTotalAmount: formatMoney(row.home_total_amount),
      paidAmount: formatMoney(row.paid_amount),
      roundingAmount: formatMoney(row.rounding_amount),
      amountDue: formatMoney(row.amount_due),
      precedingHeaderId: row.preceding_header_id ?? "",
      precedingReference: row.preceding_reference ?? "",
      precedingDate: row.preceding_date ?? "",
      buyerReference: row.buyer_reference ?? "",
      contractReference: row.contract_reference ?? "",
      paymentTerms: row.payment_terms ?? "",
      invoicePeriodStart: row.invoice_period_start ?? "",
      invoicePeriodEnd: row.invoice_period_end ?? "",
      paymentMeansCode: row.payment_means_code ?? "",
      breakdown: (Array.isArray(row.transaction_vat_breakdown) ? row.transaction_vat_breakdown : []).map((item) => ({
        category: item.vat_category,
        rate: Number(item.vat_percentage),
        taxable: Number(item.taxable_amount),
        vat: Number(item.vat_amount),
        exemption: [item.exemption_code, item.exemption_reason].filter(Boolean).join(" "),
      })),
      readiness: [],
      status: row.status,
      voidReason: row.void_reason ?? "",
      flex1: row.flex1 ?? "",
      flex2: row.flex2 ?? "",
      flex3: row.flex3 ?? "",
      flex4: row.flex4 ?? "",
      flex5: row.flex5 ?? "",
      lines: linesByHeader.get(row.id) ?? [],
      credits: creditLists.get(row.id) ?? [],
      remainingAmount: formatMoney(Math.max(0, Number(row.foreign_total_amount) - (postedCreditTotals.get(row.id) ?? 0))),
    }];
    });

  return {
    rows,
    choices: {
      types: (types.data ?? []).flatMap((row) => {
        const documentKind = parseDocumentKind(row.document_kind);
        if (!documentKind || row.type !== direction) return [];
        if (wantedCode && row.code !== wantedCode) return [];
        return [
          {
            id: row.id,
            code: row.code,
            description: row.description,
            documentKind,
            nextReference: row.last_reference + 1,
            flexLabels: [
              row.flex1_label ?? "",
              row.flex2_label ?? "",
              row.flex3_label ?? "",
              row.flex4_label ?? "",
              row.flex5_label ?? "",
            ],
          },
        ];
      }),
      suppliers: (suppliers.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        contactDetails: row.contact_details ?? "",
        currencyId: row.currency_id,
        paymentTermsDays: "",
        buyerReference: "",
      })),
      customers: (customers.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        contactDetails: row.contact_details ?? "",
        currencyId: row.currency_id,
        paymentTermsDays: row.payment_terms_days == null ? "" : String(row.payment_terms_days),
        buyerReference: row.default_buyer_reference ?? "",
      })),
      creditNoteTypes: (types.data ?? []).flatMap((row) => {
        if (row.type !== "Sales" || row.document_kind !== "credit_note") return [];
        return [{ id: row.id, code: row.code, description: row.description }];
      }),
      currencies: (currencies.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        rate: formatCurrencyRate(row.rate),
      })),
      homeCurrencyCode: embeddedCode(defaults.data?.currencies ?? null),
      products: (products.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        description: row.description,
        purchasePrice: formatProductPrice(row.purchase_price),
        salesPrice: formatProductPrice(row.sales_price),
        purchaseGlCodeId: row.purchase_gl_code_id,
        salesGlCodeId: row.sales_gl_code_id,
        purchaseVatCodeId: row.purchase_vat_code_id,
        salesVatCodeId: row.sales_vat_code_id,
        unitCode: row.unit_code,
      })),
      glCodes: (glCodes.data ?? []).flatMap((row) => {
        const accountType = parseAccountType(row.account_type);
        if (!accountType) return [];
        return [{ id: row.id, code: row.code, description: `${row.description} (${accountType})`, accountType }];
      }),
      departments: departments.data ?? [],
      costCentres: costCentres.data ?? [],
      vatRates: (vatRates.data ?? []).flatMap((row) => {
        const vatType = parseVatType(row.vat_type);
        if (!vatType) return [];
        return [
          {
            id: row.id,
            code: row.code,
            description: row.description,
            rate: String(row.rate),
            vatType,
            vatCategory: row.vat_category,
            exemptionReason: row.exemption_reason ?? "",
          },
        ];
      }),
      creditInvoices: (headers.data ?? []).flatMap((row) => {
        const kind = embeddedType(row.transaction_types);
        if (!kind || kind.type !== direction || kind.document_kind !== "invoice" || row.status !== "posted") return [];
        return [
          {
            id: row.id,
            reference: row.reference,
            documentNumber: row.document_number ?? "",
            transactionDate: row.transaction_date,
            supplierId: row.supplier_id ?? "",
            customerId: row.customer_id ?? "",
            currencyId: row.currency_id,
            typeCode: kind.code,
          },
        ];
      }),
      units: units.units,
      paymentMeans: (paymentMeans.data ?? []).map((row) => ({
        code: row.code,
        name: row.name,
        common: row.common,
      })),
    },
    error: null,
  };
}

export async function listPurchaseInvoiceLines(headerId: string): Promise<{
  lines: PurchaseInvoiceLine[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { lines: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_lines")
    .select(
      `line_number, product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id,
       quantity, price, discount_amount, nett_amount, vat_amount, unit_code, line_note, seller_item_id, products(code)`,
    )
    .eq("header_id", headerId)
    .eq("organisation_id", workspace.current.organisationId)
    .order("line_number");

  if (error) return { lines: [], error: "Invoice lines could not be loaded." };

  return {
    lines: (data ?? []).map((row) => toPurchaseInvoiceLine(row)),
    error: null,
  };
}
