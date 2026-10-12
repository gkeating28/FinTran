import { getWorkspace } from "@/lib/data";
import { formatCurrencyRate } from "@/lib/currencies";
import { formatProductPrice } from "@/lib/products";
import { parseAccountType, parseVatType } from "@/lib/reference";
import {
  formatMoney,
  type InvoiceCode,
  type InvoiceCurrency,
  type InvoiceProduct,
  type InvoiceVat,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceRow,
  type PurchaseTypeChoice,
  type SupplierChoice,
} from "@/lib/purchase-invoices";
import { createClient } from "@/lib/supabase/server";

function embeddedCode(value: { code: string } | { code: string }[] | null) {
  if (Array.isArray(value)) return value[0]?.code ?? "";
  return value?.code ?? "";
}

export type PurchaseInvoiceChoices = {
  types: PurchaseTypeChoice[];
  suppliers: SupplierChoice[];
  currencies: InvoiceCurrency[];
  products: InvoiceProduct[];
  glCodes: InvoiceCode[];
  departments: InvoiceCode[];
  costCentres: InvoiceCode[];
  vatRates: InvoiceVat[];
};

const emptyChoices: PurchaseInvoiceChoices = {
  types: [],
  suppliers: [],
  currencies: [],
  products: [],
  glCodes: [],
  departments: [],
  costCentres: [],
  vatRates: [],
};

export async function listPurchaseInvoices(): Promise<{
  rows: PurchaseInvoiceRow[];
  choices: PurchaseInvoiceChoices;
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], choices: emptyChoices, error: null };

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [headers, types, suppliers, currencies, products, glCodes, departments, costCentres, vatRates] =
    await Promise.all([
      supabase
        .from("transaction_headers")
        .select(
          `id, transaction_type_id, reference, transaction_date, due_date, supplier_id, supplier_name,
           contact_details, notes, currency_id, exchange_rate, order_number,
           foreign_nett_amount, foreign_vat_amount, foreign_total_amount,
           home_nett_amount, home_vat_amount, home_total_amount, paid_amount,
           flex1, flex2, flex3, flex4, flex5,
           transaction_types(code), suppliers(code), currencies(code)`,
        )
        .eq("organisation_id", organisationId)
        .order("transaction_date", { ascending: false })
        .order("reference", { ascending: false }),
      supabase
        .from("transaction_types")
        .select("id, code, description, last_reference, type")
        .eq("organisation_id", organisationId)
        .eq("type", "Purchases")
        .order("code"),
      supabase
        .from("suppliers")
        .select("id, code, name, contact_details, currency_id")
        .eq("organisation_id", organisationId)
        .order("code"),
      supabase.from("currencies").select("id, code, rate").eq("organisation_id", organisationId).order("code"),
      supabase
        .from("products")
        .select("id, code, description, purchase_price, purchase_gl_code_id, purchase_vat_code_id")
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
        .select("id, code, description, rate, vat_type")
        .eq("organisation_id", organisationId)
        .order("code"),
    ]);

  if (
    headers.error ||
    types.error ||
    suppliers.error ||
    currencies.error ||
    products.error ||
    glCodes.error ||
    departments.error ||
    costCentres.error ||
    vatRates.error
  ) {
    return { rows: [], choices: emptyChoices, error: "Purchase invoices could not be loaded." };
  }

  return {
    rows: (headers.data ?? []).map((row) => ({
      id: row.id,
      transactionTypeId: row.transaction_type_id,
      transactionTypeCode: embeddedCode(row.transaction_types),
      reference: row.reference,
      transactionDate: row.transaction_date,
      dueDate: row.due_date ?? "",
      supplierId: row.supplier_id,
      supplierCode: embeddedCode(row.suppliers),
      supplierName: row.supplier_name,
      contactDetails: row.contact_details ?? "",
      notes: row.notes ?? "",
      currencyId: row.currency_id,
      currencyCode: embeddedCode(row.currencies),
      exchangeRate: formatCurrencyRate(row.exchange_rate),
      orderNumber: row.order_number ?? "",
      foreignNettAmount: formatMoney(row.foreign_nett_amount),
      foreignVatAmount: formatMoney(row.foreign_vat_amount),
      foreignTotalAmount: formatMoney(row.foreign_total_amount),
      homeNettAmount: formatMoney(row.home_nett_amount),
      homeVatAmount: formatMoney(row.home_vat_amount),
      homeTotalAmount: formatMoney(row.home_total_amount),
      paidAmount: formatMoney(row.paid_amount),
      flex1: row.flex1 ?? "",
      flex2: row.flex2 ?? "",
      flex3: row.flex3 ?? "",
      flex4: row.flex4 ?? "",
      flex5: row.flex5 ?? "",
    })),
    choices: {
      types: (types.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        description: row.description,
        nextReference: row.last_reference + 1,
      })),
      suppliers: (suppliers.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        contactDetails: row.contact_details ?? "",
        currencyId: row.currency_id,
      })),
      currencies: (currencies.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        rate: formatCurrencyRate(row.rate),
      })),
      products: (products.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        description: row.description,
        purchasePrice: formatProductPrice(row.purchase_price),
        purchaseGlCodeId: row.purchase_gl_code_id,
        purchaseVatCodeId: row.purchase_vat_code_id,
      })),
      glCodes: (glCodes.data ?? []).flatMap((row) => {
        const accountType = parseAccountType(row.account_type);
        if (!accountType) return [];
        return [{ id: row.id, code: row.code, description: `${row.description} (${accountType})` }];
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
          },
        ];
      }),
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
       quantity, price, discount_amount, nett_amount, vat_amount, products(code)`,
    )
    .eq("header_id", headerId)
    .eq("organisation_id", workspace.current.organisationId)
    .order("line_number");

  if (error) return { lines: [], error: "Invoice lines could not be loaded." };

  return {
    lines: (data ?? []).map((row) => ({
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
    })),
    error: null,
  };
}
