"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import {
  optionalText,
  parseExchangeRate,
  parseInvoiceDate,
  parseMoney,
  parseUuid,
  type PurchaseInvoiceLine,
} from "@/lib/purchase-invoices";
import { ORGANISATION_LOGO_BUCKET, organisationSnapshotPath } from "@/lib/organisation-logo";
import { parseAmount } from "@/lib/products";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505" && error.message.includes("supplier_reference")) {
    return "This supplier invoice number has already been entered for this supplier.";
  }
  if (error.code === "23505") return "That reference is already used for this transaction type.";
  if (error.code === "23503" && error.message.includes("suppliers")) {
    return "Choose a supplier from this organisation.";
  }
  if (error.code === "23503" && error.message.includes("currencies")) {
    return "Choose a currency from this organisation.";
  }
  if (error.code === "23503" && error.message.includes("unit_code")) return "Choose a unit.";
  if (error.code === "23503" && error.message.includes("preceding_header")) {
    return "Choose a posted invoice from this organisation.";
  }
  if (error.code === "23503") return "Choose a code from this organisation.";
  if (error.code === "P0001") return error.message;
  if (error.message.includes("Discount cannot")) return "Discount cannot be more than quantity times price.";
  if (error.message.includes("Purchases transaction type")) return "Choose a Purchases transaction type.";
  if (error.message.includes("exchange rate")) return "Enter an exchange rate greater than 0.";
  if (error.message.includes("Expense rate")) return "Choose an Expense VAT rate.";
  return error.message || fallback;
}

async function currentOrganisation() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const cookieStore = await cookies();
  if (cookieStore.get(ORGANISATION_COOKIE)?.value !== workspace.current.organisationId) {
    cookieStore.set(ORGANISATION_COOKIE, workspace.current.organisationId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
}

function linesFrom(value: string): PurchaseInvoiceLine[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "[]");
  } catch {
    return { error: "The invoice lines could not be read." };
  }
  if (!Array.isArray(parsed)) return { error: "The invoice lines could not be read." };

  return parsed.flatMap((line, index) => {
    if (!line || typeof line !== "object") return [];
    const record = line as Record<string, unknown>;
    const textValue = (name: string) => String(record[name] ?? "");
    return [
      {
        lineNumber: index + 1,
        productId: textValue("productId"),
        productCode: textValue("productCode"),
        description: textValue("description"),
        glCodeId: textValue("glCodeId"),
        departmentId: textValue("departmentId"),
        costCentreId: textValue("costCentreId"),
        vatRateId: textValue("vatRateId"),
        quantity: textValue("quantity"),
        price: textValue("price"),
        discountAmount: textValue("discountAmount"),
        nettAmount: textValue("nettAmount"),
        vatAmount: textValue("vatAmount"),
        unitCode: textValue("unitCode"),
        lineNote: textValue("lineNote"),
        sellerItemId: textValue("sellerItemId"),
      },
    ];
  });
}

function documentFrom(formData: FormData) {
  const transactionTypeId = parseUuid(text(formData, "transaction_type_id"));
  const transactionDate = parseInvoiceDate(text(formData, "transaction_date"));
  const dueDate = text(formData, "due_date").trim();
  const supplierId = text(formData, "supplier_id").trim();
  const customerId = text(formData, "customer_id").trim();
  const supplierName = text(formData, "party_name").trim();
  const currencyId = parseUuid(text(formData, "currency_id"));
  const exchangeRate = parseExchangeRate(text(formData, "exchange_rate"));
  const paidAmount = parseAmount(text(formData, "paid_amount") || "0");
  const roundingAmount = parseMoney(text(formData, "rounding_amount") || "0");
  const contactDetails = optionalText(text(formData, "contact_details"), 500);
  const notes = optionalText(text(formData, "notes"), 4000);
  const orderNumber = optionalText(text(formData, "order_number"), 40);
  const supplierReference = optionalText(text(formData, "supplier_reference"), 60);
  const supplyDate = text(formData, "supply_date").trim();
  const precedingHeaderId = text(formData, "preceding_header_id").trim();
  const precedingReference = optionalText(text(formData, "preceding_reference"), 60);
  const precedingDate = text(formData, "preceding_date").trim();
  const buyerReference = optionalText(text(formData, "buyer_reference"), 100);
  const contractReference = optionalText(text(formData, "contract_reference"), 60);
  const paymentTerms = optionalText(text(formData, "payment_terms"), 400);
  const invoicePeriodStart = text(formData, "invoice_period_start").trim();
  const invoicePeriodEnd = text(formData, "invoice_period_end").trim();
  const paymentMeansCode = text(formData, "payment_means_code").trim().toUpperCase();
  const flex = [1, 2, 3, 4, 5].map((number) => optionalText(text(formData, `flex${number}`), 200));
  const lines = linesFrom(text(formData, "lines"));

  if (!transactionTypeId) return { error: "Choose a transaction type." } as const;
  if (!transactionDate) return { error: "Enter the transaction date." } as const;
  if (dueDate && !parseInvoiceDate(dueDate)) return { error: "Enter a valid due date, or leave it blank." } as const;
  if (!supplierId && !customerId) return { error: "Choose a supplier or customer." } as const;
  if (supplierId && !parseUuid(supplierId)) return { error: "Choose a supplier from this organisation." } as const;
  if (customerId && !parseUuid(customerId)) return { error: "Choose a customer from this organisation." } as const;
  if (supplierName.length > 200) return { error: "The name can be up to 200 characters." } as const;
  if (!currencyId) return { error: "Choose a currency." } as const;
  if (!exchangeRate) return { error: "Enter an exchange rate greater than 0." } as const;
  if (paidAmount === null) return { error: "Amounts can have at most 2 decimal places." } as const;
  if (!roundingAmount) return { error: "Enter a rounding amount of 0 or more." } as const;
  if (contactDetails === undefined) return { error: "Contact details can be up to 500 characters." } as const;
  if (notes === undefined) return { error: "Notes can be up to 4000 characters." } as const;
  if (orderNumber === undefined) return { error: "Order number can be up to 40 characters." } as const;
  if (supplierReference === undefined) return { error: "Supplier invoice number can be up to 60 characters." } as const;
  if (supplyDate && !parseInvoiceDate(supplyDate)) return { error: "Enter a valid supply date, or leave it blank." } as const;
  if (precedingHeaderId && !parseUuid(precedingHeaderId)) return { error: "Choose the invoice this credit note applies to." } as const;
  if (precedingReference === undefined) return { error: "The credited invoice reference can be up to 60 characters." } as const;
  if (precedingDate && !parseInvoiceDate(precedingDate)) return { error: "Enter the credited invoice date, or leave it blank." } as const;
  if (buyerReference === undefined) return { error: "Buyer reference can be up to 100 characters." } as const;
  if (contractReference === undefined) return { error: "Contract reference can be up to 60 characters." } as const;
  if (paymentTerms === undefined) return { error: "Payment terms can be up to 400 characters." } as const;
  if ((invoicePeriodStart && !parseInvoiceDate(invoicePeriodStart)) || (invoicePeriodEnd && !parseInvoiceDate(invoicePeriodEnd))) {
    return { error: "Enter the invoice period dates, or leave both blank." } as const;
  }
  if ((invoicePeriodStart && !invoicePeriodEnd) || (!invoicePeriodStart && invoicePeriodEnd)) {
    return { error: "Enter both the invoice period start and end, or leave both blank." } as const;
  }
  if (invoicePeriodStart && invoicePeriodEnd && invoicePeriodEnd < invoicePeriodStart) {
    return { error: "The invoice period end cannot be before the start." } as const;
  }
  if (paymentMeansCode && !/^[0-9A-Z]{1,3}$/.test(paymentMeansCode)) {
    return { error: "Choose a payment means." } as const;
  }
  if (flex.some((value) => value === undefined)) return { error: "Each flex field can be up to 200 characters." } as const;
  if ("error" in lines) return { error: lines.error } as const;

  for (const line of lines) {
    const quantity = parseMoney(line.quantity);
    const price = parseMoney(line.price);
    const discount = parseAmount(line.discountAmount || "0");
    const description = line.description.trim();
    if (!description || description.length > 200) {
      return { error: "Each line needs a description up to 200 characters." } as const;
    }
    if (!quantity || !(Number(quantity) > 0)) return { error: "Each line needs a quantity greater than 0." } as const;
    if (!price) return { error: "Each line needs a price of 0 or more." } as const;
    if (discount === null) return { error: "Amounts can have at most 2 decimal places." } as const;
    const unitCode = line.unitCode.trim().toUpperCase();
    if (unitCode && !/^[A-Z0-9]{2,3}$/.test(unitCode)) return { error: "Choose a unit." } as const;
    if (line.lineNote.trim().length > 400) return { error: "A line note can be up to 400 characters." } as const;
    if (line.sellerItemId.trim().length > 60) return { error: "A seller item identifier can be up to 60 characters." } as const;
    if (line.productId.trim() && !parseUuid(line.productId)) {
      return { error: "Choose a product from this organisation." } as const;
    }
    for (const field of [line.glCodeId, line.departmentId, line.costCentreId, line.vatRateId]) {
      if (field.trim() && !parseUuid(field)) return { error: "Choose a code from this organisation." } as const;
    }
  }

  return {
    id: text(formData, "id").trim(),
    transactionTypeId,
    transactionDate,
    dueDate,
    supplierId,
    customerId,
    supplierName,
    contactDetails,
    notes,
    currencyId,
    exchangeRate,
    orderNumber,
    supplierReference,
    supplyDate,
    precedingHeaderId,
    precedingReference,
    precedingDate,
    buyerReference,
    contractReference,
    paymentTerms,
    invoicePeriodStart,
    invoicePeriodEnd,
    paymentMeansCode,
    paidAmount,
    roundingAmount,
    flex1: flex[0],
    flex2: flex[1],
    flex3: flex[2],
    flex4: flex[3],
    flex5: flex[4],
    lines: lines.map((line) => ({
      productId: line.productId.trim(),
      description: line.description.trim(),
      glCodeId: line.glCodeId.trim(),
      departmentId: line.departmentId.trim(),
      costCentreId: line.costCentreId.trim(),
      vatRateId: line.vatRateId.trim(),
      quantity: parseMoney(line.quantity),
      price: parseMoney(line.price),
      discountAmount: parseAmount(line.discountAmount || "0"),
      unitCode: line.unitCode.trim().toUpperCase(),
      lineNote: line.lineNote.trim(),
      sellerItemId: line.sellerItemId.trim(),
    })),
  } as const;
}

export async function savePurchaseInvoice(_state: ActionState, formData: FormData): Promise<ActionState> {
  const document = documentFrom(formData);
  if ("error" in document) return { error: document.error };

  await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_document", {
    p_document: {
      id: document.id,
      transactionTypeId: document.transactionTypeId,
      transactionDate: document.transactionDate,
      dueDate: document.dueDate,
      supplierId: document.supplierId,
      customerId: document.customerId,
      partyName: document.supplierName,
      contactDetails: document.contactDetails,
      notes: document.notes,
      currencyId: document.currencyId,
      exchangeRate: document.exchangeRate,
      orderNumber: document.orderNumber,
      supplierReference: document.supplierReference,
      supplyDate: document.supplyDate,
      precedingHeaderId: document.precedingHeaderId,
      precedingReference: document.precedingReference,
      precedingDate: document.precedingDate,
      buyerReference: document.buyerReference,
      contractReference: document.contractReference,
      paymentTerms: document.paymentTerms,
      invoicePeriodStart: document.invoicePeriodStart,
      invoicePeriodEnd: document.invoicePeriodEnd,
      paymentMeansCode: document.paymentMeansCode,
      paidAmount: document.paidAmount,
      roundingAmount: document.roundingAmount,
      flex1: document.flex1,
      flex2: document.flex2,
      flex3: document.flex3,
      flex4: document.flex4,
      flex5: document.flex5,
      lines: document.lines,
    },
  });

  if (error) return { error: friendlyError(error, "That invoice could not be saved.") };

  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  return { message: document.id ? "Saved." : "Added." };
}

function returnPath(formData: FormData) {
  const next = text(formData, "return_to").trim();
  return /^\/transactions\/[A-Za-z0-9]+$/.test(next) ? next : "/transactions";
}

export async function postPurchaseInvoice(formData: FormData) {
  const id = text(formData, "id").trim();
  const next = returnPath(formData);
  if (!id) redirect(next);

  const workspace = await getWorkspace();
  if (workspace.status !== "ready") redirect("/login");
  await currentOrganisation();
  const supabase = await createClient();
  const defaults = await supabase
    .from("organisation_defaults")
    .select("logo_path")
    .eq("organisation_id", workspace.current.organisationId)
    .maybeSingle();
  let logoPath: string | null = null;
  if (defaults.data?.logo_path) {
    logoPath = organisationSnapshotPath(workspace.current.organisationId, id);
    const copied = await supabase.storage.from(ORGANISATION_LOGO_BUCKET).copy(defaults.data.logo_path, logoPath);
    if (copied.error) {
      redirect(`${next}?error=${encodeURIComponent("The organisation logo could not be copied, so the document was not posted.")}`);
    }
  }
  const { error } = await supabase.rpc("post_document", { p_header_id: id, p_logo_path: logoPath });
  if (error) {
    if (logoPath) await supabase.storage.from(ORGANISATION_LOGO_BUCKET).remove([logoPath]);
    redirect(`${next}?error=${encodeURIComponent(friendlyError(error, "That document could not be posted."))}`);
  }

  const posted = await supabase
    .from("transaction_headers")
    .select("transaction_types(type, document_kind)")
    .eq("id", id)
    .maybeSingle();
  const kind = posted.data?.transaction_types as { type?: string; document_kind?: string } | { type?: string; document_kind?: string }[] | null;
  const typeRow = Array.isArray(kind) ? kind[0] : kind;
  if (typeRow?.type === "Sales" && (typeRow.document_kind === "invoice" || typeRow.document_kind === "credit_note")) {
    try {
      const { createOutbound } = await import("@/lib/einvoice/store");
      await createOutbound(supabase, id, workspace.current.organisationId);
    } catch (generationError) {
      const message = generationError instanceof Error ? generationError.message : "The e-invoice could not be generated.";
      redirect(`${next}?error=${encodeURIComponent(`Posted, but the e-invoice was not stored. ${message}`)}`);
    }
  }

  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  redirect(next);
}

export async function voidPurchaseInvoice(formData: FormData) {
  const id = text(formData, "id").trim();
  const reason = text(formData, "reason").trim();
  const next = returnPath(formData);
  if (!id) redirect(next);

  await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_document", { p_header_id: id, p_reason: reason });
  if (error) {
    redirect(`${next}?error=${encodeURIComponent(friendlyError(error, "That document could not be voided."))}`);
  }

  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  redirect(next);
}

export async function updatePaidAmount(_state: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseUuid(text(formData, "id"));
  const paidAmount = parseAmount(text(formData, "paid_amount"));
  if (!id) return { error: "Choose a document." };
  if (paidAmount === null) return { error: "Amounts can have at most 2 decimal places." };

  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("transaction_headers")
    .update({ paid_amount: paidAmount })
    .eq("id", id)
    .eq("organisation_id", workspace.current.organisationId)
    .eq("status", "posted");

  if (error) return { error: friendlyError(error, "The paid amount could not be saved.") };
  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  return { message: "Paid amount saved." };
}

export async function createCreditNote(formData: FormData) {
  const invoiceId = parseUuid(text(formData, "id"));
  const requestedType = text(formData, "credit_type_id").trim();
  const next = returnPath(formData);
  if (!invoiceId) redirect(next);

  await currentOrganisation();
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") redirect("/login");
  const supabase = await createClient();
  const invoice = await supabase
    .from("transaction_headers")
    .select(
      `id, customer_id, currency_id, document_number, reference, transaction_date, exchange_rate,
       transaction_types(type, document_kind),
       transaction_lines(line_number, product_id, description, gl_code_id, department_id, cost_centre_id, vat_rate_id, quantity, price, discount_amount, unit_code, line_note)`,
    )
    .eq("id", invoiceId)
    .eq("organisation_id", workspace.current.organisationId)
    .maybeSingle();
  if (invoice.error || !invoice.data) {
    redirect(`${next}?error=${encodeURIComponent("That invoice could not be credited.")}`);
  }
  const kind = Array.isArray(invoice.data.transaction_types) ? invoice.data.transaction_types[0] : invoice.data.transaction_types;
  if (!kind || kind.type !== "Sales" || kind.document_kind !== "invoice") {
    redirect(`${next}?error=${encodeURIComponent("Only a posted sales invoice can be credited from here.")}`);
  }

  const types = await supabase
    .from("transaction_types")
    .select("id, code, document_kind, type")
    .eq("organisation_id", workspace.current.organisationId)
    .eq("type", "Sales")
    .eq("document_kind", "credit_note")
    .order("code");
  const creditTypes = types.data ?? [];
  if (creditTypes.length === 0) {
    redirect(`${next}?error=${encodeURIComponent("Add a sales credit note type before raising a credit note.")}`);
  }
  const chosen = creditTypes.find((type) => type.id === requestedType) ?? (creditTypes.length === 1 ? creditTypes[0] : null);
  if (!chosen) {
    redirect(`${next}?error=${encodeURIComponent("Choose which sales credit note type to use.")}`);
  }

  const lines = [...(invoice.data.transaction_lines ?? [])].sort((left, right) => left.line_number - right.line_number);
  const { data, error } = await supabase.rpc("save_document", {
    p_document: {
      transactionTypeId: chosen.id,
      customerId: invoice.data.customer_id,
      currencyId: invoice.data.currency_id,
      exchangeRate: invoice.data.exchange_rate,
      transactionDate: new Date().toISOString().slice(0, 10),
      precedingHeaderId: invoice.data.id,
      precedingReference: invoice.data.document_number || (invoice.data.reference == null ? "" : String(invoice.data.reference)),
      precedingDate: invoice.data.transaction_date,
      lines: lines.map((line) => ({
        productId: line.product_id,
        description: line.description,
        glCodeId: line.gl_code_id,
        departmentId: line.department_id,
        costCentreId: line.cost_centre_id,
        vatRateId: line.vat_rate_id,
        quantity: line.quantity,
        price: line.price,
        discountAmount: line.discount_amount,
        unitCode: line.unit_code,
        lineNote: line.line_note,
      })),
    },
  });
  if (error || !data) {
    redirect(`${next}?error=${encodeURIComponent(friendlyError(error, "The credit note could not be created."))}`);
  }

  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  redirect(`/transactions/${chosen.code}?open=${data}`);
}

export async function deletePurchaseInvoice(formData: FormData) {
  const id = text(formData, "id").trim();
  const next = returnPath(formData);
  if (!id) redirect(next);

  await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from("transaction_headers").delete().eq("id", id);

  if (error) {
    redirect(`${next}?error=${encodeURIComponent(friendlyError(error, "That invoice could not be removed."))}`);
  }

  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  redirect(next);
}
