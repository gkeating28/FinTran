"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { approvalFromRow, type ApprovalInfo, type ApprovalRow } from "@/lib/approvals";
import { deliverQueuedEmails } from "@/lib/email/send";
import { OrganisationAccessError, requireCurrentOrganisation } from "@/lib/organisation-guard";
import type { PaymentActionState } from "@/lib/payment-actions";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function refresh() {
  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  revalidatePath("/");
}

/** Where each of these draft payments stands on approval. Payments that need none are left out. */
export async function loadPaymentApprovalStatus(ids: string[]): Promise<Record<string, ApprovalInfo>> {
  const clean = ids.filter((id) => UUID.test(id)).slice(0, 500);
  if (clean.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payment_approval_status", { p_payment_ids: clean });
  if (error) return {};
  const found: Record<string, ApprovalInfo> = {};
  for (const row of (data ?? []) as (Omit<ApprovalRow, "header_id" | "self" | "price_over"> & { payment_id: string })[]) {
    const info = approvalFromRow({ ...row, header_id: row.payment_id, self: false, price_over: false });
    if (info) found[row.payment_id] = info;
  }
  return found;
}

/** Hands the emails the call queued to the mail adapter. A failure is recorded on the email and never stops the action. */
async function sendEmails(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  try {
    const origin = (await headers()).get("origin") ?? "";
    await deliverQueuedEmails(supabase, id, origin, undefined, "payment");
  } catch {
    // The emails stay queued or failed. The approval has already been recorded.
  }
}

async function decide(
  formData: FormData,
  call: (supabase: Awaited<ReturnType<typeof createClient>>, id: string) => PromiseLike<{ error: { message: string } | null }>,
  fallback: string,
  done: string,
): Promise<PaymentActionState> {
  const id = text(formData, "id").trim();
  if (!UUID.test(id)) return { error: "Choose a payment." };
  try {
    await requireCurrentOrganisation();
  } catch (error) {
    if (error instanceof OrganisationAccessError) return { error: "You cannot change that organisation." };
    throw error;
  }
  const supabase = await createClient();
  const { error } = await call(supabase, id);
  if (error) return { error: error.message || fallback, id };
  await sendEmails(supabase, id);
  refresh();
  return { message: done, id };
}

export async function requestPaymentApproval(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const note = text(formData, "note").trim() || undefined;
  return decide(formData, (supabase, id) => supabase.rpc("request_payment_approval", { p_payment_id: id, p_note: note }), "Approval could not be asked for.", "Approval asked for.");
}

export async function approvePayment(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const note = text(formData, "note").trim() || undefined;
  return decide(formData, (supabase, id) => supabase.rpc("approve_payment", { p_payment_id: id, p_note: note }), "That could not be approved.", "Approved.");
}

export async function rejectPayment(_state: PaymentActionState, formData: FormData): Promise<PaymentActionState> {
  const reason = text(formData, "reason").trim();
  return decide(formData, (supabase, id) => supabase.rpc("reject_payment", { p_payment_id: id, p_reason: reason }), "That could not be refused.", "Refused.");
}
