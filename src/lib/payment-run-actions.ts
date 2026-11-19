"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { approvalFromRow, type ApprovalRow } from "@/lib/approvals";
import { deliverQueuedEmails } from "@/lib/email/send";
import { OrganisationAccessError, requireCurrentOrganisation } from "@/lib/organisation-guard";
import type { PaymentActionState } from "@/lib/payment-actions";
import { listRunnableInvoices } from "@/lib/payment-run-data";
import type { RunApproval, RunnableInvoice } from "@/lib/payment-runs";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function refresh() {
  revalidatePath("/payment-runs");
  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  revalidatePath("/");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** What can be put in a run paid from this bank account. */
export async function loadRunnableInvoices(bankAccountId: string): Promise<{ invoices: RunnableInvoice[]; error: string | null }> {
  if (!UUID.test(bankAccountId)) return { invoices: [], error: null };
  try {
    const current = await requireCurrentOrganisation();
    return await listRunnableInvoices(current.organisationId, bankAccountId);
  } catch (error) {
    if (error instanceof OrganisationAccessError) return { invoices: [], error: "You cannot use that organisation." };
    throw error;
  }
}

/** Where each of these runs stands on approval. A run that needs none is left out. */
export async function loadPaymentRunApproval(ids: string[]): Promise<Record<string, RunApproval>> {
  const clean = ids.filter((id) => UUID.test(id)).slice(0, 200);
  if (clean.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payment_run_approval_status", { p_run_ids: clean });
  if (error) return {};
  const found: Record<string, RunApproval> = {};
  for (const row of (data ?? []) as (Omit<ApprovalRow, "header_id" | "self" | "price_over"> & { run_id: string; home_total: number | null; bank_suppliers: string | null })[]) {
    const info = approvalFromRow({ ...row, header_id: row.run_id, self: false, price_over: false });
    if (info) found[row.run_id] = { ...info, homeTotal: Number(row.home_total ?? 0).toFixed(2), bankSuppliers: row.bank_suppliers ?? "" };
  }
  return found;
}

async function sendEmails(supabase: Supabase, id: string) {
  try {
    const origin = (await headers()).get("origin") ?? "";
    await deliverQueuedEmails(supabase, id, origin, undefined, "run");
  } catch {
    // The emails stay queued or failed. The approval has already been recorded.
  }
}

async function act(
  call: (supabase: Supabase) => PromiseLike<{ error: { message: string } | null }>,
  options: { id?: string; fallback: string; done: string; email?: boolean },
): Promise<PaymentActionState> {
  try {
    await requireCurrentOrganisation();
  } catch (error) {
    if (error instanceof OrganisationAccessError) return { error: "You cannot change that organisation." };
    throw error;
  }
  const supabase = await createClient();
  const { error } = await call(supabase);
  if (error) return { error: error.message || options.fallback, id: options.id };
  if (options.email && options.id) await sendEmails(supabase, options.id);
  refresh();
  return { message: options.done, id: options.id };
}

/** Makes a run, and a draft payment for each supplier, from the invoices chosen. */
export async function createPaymentRun(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const typeId = text(formData, "transaction_type_id").trim();
  const bankAccountId = text(formData, "bank_account_id").trim();
  const date = text(formData, "payment_date").trim();
  let invoiceIds: string[] = [];
  try {
    const parsed = JSON.parse(text(formData, "invoice_ids") || "[]") as unknown;
    invoiceIds = Array.isArray(parsed) ? parsed.map(String).filter((id) => UUID.test(id)) : [];
  } catch {
    return { error: "The chosen invoices could not be read." };
  }
  if (!UUID.test(typeId)) return { error: "Choose a payment type." };
  if (!UUID.test(bankAccountId)) return { error: "Choose a bank account." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the payment date." };
  if (invoiceIds.length === 0) return { error: "Choose at least one invoice to pay." };
  let runId = "";
  const result = await act(
    async (supabase) => {
      const created = await supabase.rpc("create_payment_run", {
        p_run: { transactionTypeId: typeId, bankAccountId, paymentDate: date, notes: text(formData, "notes").trim() || null, invoiceIds },
      });
      if (!created.error) runId = String(created.data);
      return created;
    },
    { fallback: "The payment run could not be made.", done: "Made." },
  );
  return runId ? { ...result, id: runId } : result;
}

export async function requestRunApproval(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = text(formData, "id").trim();
  if (!UUID.test(id)) return { error: "Choose a payment run." };
  const note = text(formData, "note").trim() || undefined;
  return act((supabase) => supabase.rpc("request_run_approval", { p_run_id: id, p_note: note }), { id, fallback: "Approval could not be asked for.", done: "Approval asked for.", email: true });
}

export async function approveRun(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = text(formData, "id").trim();
  if (!UUID.test(id)) return { error: "Choose a payment run." };
  const note = text(formData, "note").trim() || undefined;
  return act((supabase) => supabase.rpc("approve_run", { p_run_id: id, p_note: note }), { id, fallback: "That could not be approved.", done: "Approved.", email: true });
}

export async function rejectRun(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = text(formData, "id").trim();
  if (!UUID.test(id)) return { error: "Choose a payment run." };
  const reason = text(formData, "reason").trim();
  return act((supabase) => supabase.rpc("reject_run", { p_run_id: id, p_reason: reason }), { id, fallback: "That could not be refused.", done: "Refused.", email: true });
}

/** Posts every payment in the run, or none. */
export async function postPaymentRun(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = text(formData, "id").trim();
  if (!UUID.test(id)) return { error: "Choose a payment run." };
  return act((supabase) => supabase.rpc("post_payment_run", { p_run_id: id }), { id, fallback: "The payment run could not be posted.", done: "Posted." });
}

export async function removeRunPayment(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const paymentId = text(formData, "payment_id").trim();
  if (!UUID.test(paymentId)) return { error: "Choose a payment." };
  return act((supabase) => supabase.rpc("remove_run_payment", { p_payment_id: paymentId }), { fallback: "That payment could not be taken out.", done: "Taken out of the run." });
}

export async function cancelPaymentRun(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const id = text(formData, "id").trim();
  if (!UUID.test(id)) return { error: "Choose a payment run." };
  return act((supabase) => supabase.rpc("cancel_payment_run", { p_run_id: id }), { id, fallback: "The payment run could not be cancelled.", done: "Cancelled." });
}
