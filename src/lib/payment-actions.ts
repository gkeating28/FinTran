"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAmount } from "@/lib/products";
import { parseInvoiceDate, parseUuid } from "@/lib/documents";
import { OrganisationAccessError, requireCurrentOrganisation } from "@/lib/organisation-guard";
import { listOpenItems, loadPaymentRows } from "@/lib/payment-data";
import { parseAllocationAmount, targetKindFor, type OpenItem, type PaymentRow } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";
import { parseCurrencyRate } from "@/lib/currencies";
import type { ActionState } from "@/lib/types";
import { isPaymentKind, parseTransactionTypeKind } from "@/lib/transaction-types";

/** A result that also says which payment it was about, so a form that has just saved a new draft keeps hold of it. */
export type PaymentActionState = ActionState & { id?: string };

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

/** The database says what is wrong in plain words. This only covers the codes it does not. */
function friendly(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "42501") return "You cannot do that.";
  return error.message || fallback;
}

function refresh() {
  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  revalidatePath("/customers");
  revalidatePath("/suppliers");
}

type Allocations = { targetHeaderId: string; amount: string }[];

/** The allocation boxes a form sends, as the database wants them. Blank boxes are left out. */
function allocationsFrom(value: string): Allocations | { error: string } {
  if (!value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: "The allocations could not be read." };
  }
  if (!Array.isArray(parsed)) return { error: "The allocations could not be read." };
  const lines: Allocations = [];
  for (const item of parsed) {
    const target = parseUuid(String((item as { targetHeaderId?: unknown })?.targetHeaderId ?? ""));
    const amount = parseAllocationAmount(String((item as { amount?: unknown })?.amount ?? ""));
    if (amount === undefined || !target) return { error: "Enter each allocation as an amount with at most 2 decimal places." };
    if (amount !== null) lines.push({ targetHeaderId: target, amount: amount.toFixed(2) });
  }
  return lines;
}

async function guarded<T>(work: () => Promise<T>, onDenied: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OrganisationAccessError) return onDenied;
    throw error;
  }
}

/** Saves a draft payment and its planned allocations. With then_action=post it posts the draft straight after. */
export async function savePayment(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = text(formData, "id").trim();
  const typeId = parseUuid(text(formData, "transaction_type_id"));
  const date = parseInvoiceDate(text(formData, "payment_date"));
  const customerId = text(formData, "customer_id").trim();
  const supplierId = text(formData, "supplier_id").trim();
  const bankAccountId = text(formData, "bank_account_id").trim();
  const amount = parseAmount(text(formData, "amount"));
  const rateText = text(formData, "exchange_rate").trim();
  const rate = rateText ? parseCurrencyRate(rateText) : null;
  const allocations = allocationsFrom(text(formData, "allocations"));

  if (!typeId) return { error: "Choose a transaction type." };
  if (!date) return { error: "Enter the payment date." };
  if (!customerId && !supplierId) return { error: "Choose who the money is with." };
  if (customerId && !parseUuid(customerId)) return { error: "Choose a customer from this organisation." };
  if (supplierId && !parseUuid(supplierId)) return { error: "Choose a supplier from this organisation." };
  if (!bankAccountId || !parseUuid(bankAccountId)) return { error: "Choose a bank account." };
  if (!amount || !(Number(amount) > 0)) return { error: "Enter an amount greater than 0, with at most 2 decimal places." };
  if (rateText && !rate) return { error: "Enter an exchange rate greater than 0." };
  if ("error" in allocations) return { error: allocations.error };
  if (id && !parseUuid(id)) return { error: "That payment could not be saved." };

  return guarded<PaymentActionState>(async () => {
    await requireCurrentOrganisation();
    const supabase = await createClient();
    const saved = await supabase.rpc("save_payment", {
      p_payment: {
        id: id || null,
        transactionTypeId: typeId,
        paymentDate: date,
        customerId: customerId || null,
        supplierId: supplierId || null,
        bankAccountId,
        exchangeRate: rate,
        amount,
        paymentMeansCode: text(formData, "payment_means_code").trim().toUpperCase() || null,
        bankReference: text(formData, "bank_reference").trim() || null,
        notes: text(formData, "notes").trim() || null,
        allocations,
      },
    });
    if (saved.error) return { error: friendly(saved.error, "That payment could not be saved."), id: id || undefined };
    const savedId = String(saved.data);

    if (text(formData, "then_action") === "post") {
      const posted = await supabase.rpc("post_payment", { p_payment_id: savedId });
      refresh();
      if (posted.error) {
        return { error: `The payment was saved as a draft, but it could not be posted. ${friendly(posted.error, "")}`.trim(), id: savedId };
      }
      return { message: "Posted.", id: savedId };
    }
    refresh();
    return { message: "Saved.", id: savedId };
  }, { error: "You cannot change that organisation." });
}

/** Posts a draft payment as it was saved. */
export async function postPayment(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = parseUuid(text(formData, "id"));
  if (!id) return { error: "Choose a payment." };
  return guarded<PaymentActionState>(async () => {
    await requireCurrentOrganisation();
    const supabase = await createClient();
    const { error } = await supabase.rpc("post_payment", { p_payment_id: id });
    if (error) return { error: friendly(error, "That payment could not be posted."), id };
    refresh();
    return { message: "Posted.", id };
  }, { error: "You cannot change that organisation." });
}

export async function voidPayment(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = parseUuid(text(formData, "id"));
  const reason = text(formData, "reason").trim();
  if (!id) return { error: "Choose a payment." };
  if (!reason) return { error: "Enter a reason for voiding this payment." };
  return guarded<PaymentActionState>(async () => {
    await requireCurrentOrganisation();
    const supabase = await createClient();
    const { error } = await supabase.rpc("void_payment", { p_payment_id: id, p_reason: reason });
    if (error) return { error: friendly(error, "That payment could not be voided."), id };
    refresh();
    return { message: "Voided.", id };
  }, { error: "You cannot change that organisation." });
}

export async function deletePayment(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = parseUuid(text(formData, "id"));
  if (!id) return { error: "Choose a payment." };
  return guarded<PaymentActionState>(async () => {
    await requireCurrentOrganisation();
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_payment", { p_payment_id: id });
    if (error) return { error: friendly(error, "That payment could not be deleted."), id };
    refresh();
    return { message: "Deleted." };
  }, { error: "You cannot change that organisation." });
}

/** Allocates the amounts typed against open documents, from a posted payment or from a posted credit note, in one step. */
export async function applyAllocations(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const paymentId = parseUuid(text(formData, "payment_id"));
  const creditNoteId = parseUuid(text(formData, "credit_note_id"));
  const lines = allocationsFrom(text(formData, "allocations"));
  if (!paymentId === !creditNoteId) return { error: "Choose a payment or a credit note to apply." };
  if ("error" in lines) return { error: lines.error };
  if (lines.length === 0) return { error: "Enter an amount against at least one document." };
  return guarded<PaymentActionState>(async () => {
    await requireCurrentOrganisation();
    const supabase = await createClient();
    const { error } = await supabase.rpc("allocate_lines", {
      p_source: paymentId ? { paymentId } : { creditNoteId },
      p_lines: lines,
    });
    if (error) return { error: friendly(error, "That could not be allocated."), id: paymentId ?? creditNoteId ?? undefined };
    refresh();
    return { message: "Allocated.", id: paymentId ?? creditNoteId ?? undefined };
  }, { error: "You cannot change that organisation." });
}

/** Applies what is left of a posted payment or credit note to the party's open documents, oldest first. */
export async function allocateOldestFirst(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const paymentId = parseUuid(text(formData, "payment_id"));
  const creditNoteId = parseUuid(text(formData, "credit_note_id"));
  if (!paymentId === !creditNoteId) return { error: "Choose a payment or a credit note to apply." };
  return guarded<PaymentActionState>(async () => {
    await requireCurrentOrganisation();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("allocate_oldest_first", { p_source: paymentId ? { paymentId } : { creditNoteId } });
    if (error) return { error: friendly(error, "That could not be allocated."), id: paymentId ?? creditNoteId ?? undefined };
    refresh();
    return { message: data ? "Allocated." : "There was nothing to allocate it to.", id: paymentId ?? creditNoteId ?? undefined };
  }, { error: "You cannot change that organisation." });
}

export async function removeAllocation(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = parseUuid(text(formData, "allocation_id"));
  const reason = text(formData, "reason").trim();
  if (!id) return { error: "Choose an allocation." };
  if (!reason) return { error: "Enter a reason for removing this allocation." };
  return guarded<PaymentActionState>(async () => {
    await requireCurrentOrganisation();
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_allocation", { p_allocation_id: id, p_reason: reason });
    if (error) return { error: friendly(error, "That allocation could not be removed.") };
    refresh();
    return { message: "Removed." };
  }, { error: "You cannot change that organisation." });
}

/** The notes and the bank reference are the only things that change on a posted payment. */
export async function updatePaymentNotes(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = parseUuid(text(formData, "id"));
  if (!id) return { error: "Choose a payment." };
  const notes = text(formData, "notes").trim();
  const reference = text(formData, "bank_reference").trim();
  if (notes.length > 4000) return { error: "Notes can be up to 4000 characters." };
  if (reference.length > 140) return { error: "The bank reference can be up to 140 characters." };
  return guarded<PaymentActionState>(async () => {
    const current = await requireCurrentOrganisation();
    const supabase = await createClient();
    const { error } = await supabase
      .from("payments")
      .update({ notes: notes || null, bank_reference: reference || null })
      .eq("id", id)
      .eq("organisation_id", current.organisationId);
    if (error) return { error: friendly(error, "The notes could not be saved."), id };
    refresh();
    return { message: "Saved.", id };
  }, { error: "You cannot change that organisation." });
}

/** The open documents a payment of this type could settle for this party. */
export async function loadOpenItems(typeId: string, partyId: string): Promise<{ items: OpenItem[]; error: string | null }> {
  if (!parseUuid(typeId) || !parseUuid(partyId)) return { items: [], error: null };
  return guarded(async () => {
    const current = await requireCurrentOrganisation();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("transaction_types")
      .select("type, document_kind")
      .eq("id", typeId)
      .eq("organisation_id", current.organisationId)
      .maybeSingle();
    const direction = data ? parseTransactionTypeKind(data.type) : null;
    if (error || !data || !direction || !isPaymentKind(data.document_kind)) return { items: [], error: "Payments could not be loaded." };
    return listOpenItems(supabase, current.organisationId, {
      direction,
      targetKind: targetKindFor(data.document_kind, direction),
      partyId,
    });
  }, { items: [], error: null });
}

/** One payment as it stands now, for a form that has just changed it. */
export async function loadPayment(id: string): Promise<PaymentRow | null> {
  if (!parseUuid(id)) return null;
  return guarded(async () => {
    const current = await requireCurrentOrganisation();
    const supabase = await createClient();
    const { rows } = await loadPaymentRows(supabase, current.organisationId, { paymentId: id });
    return rows[0] ?? null;
  }, null);
}

const STANDARD_TYPES = [
  { code: "REC", description: "Customer receipt", type: "Sales", kind: "receipt", prefix: "REC-" },
  { code: "PAY", description: "Supplier payment", type: "Purchases", kind: "payment", prefix: "PAY-" },
  { code: "CREF", description: "Customer refund", type: "Sales", kind: "payment", prefix: "CREF-" },
  { code: "SREF", description: "Supplier refund", type: "Purchases", kind: "receipt", prefix: "SREF-" },
] as const;

/** The four standard types of payment, offered on first use. A code already in use is left alone. */
export async function createStandardPaymentTypes(): Promise<never> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const supabase = await createClient();
  const existing = await supabase.from("transaction_types").select("code").eq("organisation_id", current.organisationId);
  if (existing.error) redirect(`/transactions?error=${encodeURIComponent("Transaction types could not be loaded.")}`);
  const used = new Set((existing.data ?? []).map((row) => row.code));
  const rows = STANDARD_TYPES.filter((item) => !used.has(item.code)).map((item) => ({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    code: item.code,
    description: item.description,
    last_reference: 0,
    type: item.type,
    document_kind: item.kind,
    numbering: "on_post" as const,
    reference_prefix: item.prefix,
    reference_padding: 5,
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from("transaction_types").insert(rows);
    if (error) redirect(`/transactions?error=${encodeURIComponent(friendly(error, "The payment types could not be added."))}`);
  }
  revalidatePath("/transactions");
  revalidatePath("/transaction-types");
  redirect("/transactions");
}
