"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ApprovalInfo, ApprovalState, PriceCheck } from "@/lib/approvals";
import { friendlyError } from "@/lib/document-errors";
import { requireCurrentOrganisation } from "@/lib/organisation-guard";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function returnPath(formData: FormData) {
  const next = text(formData, "return_to").trim();
  return /^\/transactions\/[A-Za-z0-9]+$/.test(next) ? next : "/transactions";
}

/** Where each of these documents stands on approval. Documents that need none are left out. */
export async function loadApprovalStatus(ids: string[]): Promise<Record<string, ApprovalInfo>> {
  const clean = ids.filter((id) => UUID.test(id)).slice(0, 500);
  if (clean.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approval_status", { p_header_ids: clean });
  if (error) return {};
  const found: Record<string, ApprovalInfo> = {};
  const rows = (data ?? []) as {
    header_id: string;
    state: string;
    required_role: string | null;
    reason: string | null;
    requested_by_name: string | null;
    requested_at: string | null;
    decided_by_name: string | null;
    decided_at: string | null;
    note: string | null;
    self: boolean | null;
    can_decide: boolean | null;
    price_over: boolean | null;
  }[];
  for (const row of rows) {
    const state = (["required", "requested", "approved", "rejected"] as const).find((item) => item === row.state);
    if (!state) continue;
    found[row.header_id] = {
      state: state satisfies ApprovalState,
      role: row.required_role === "owner" ? "owner" : "admin",
      reason: row.reason ?? "amount",
      requestedByName: row.requested_by_name ?? "",
      requestedAt: row.requested_at ?? "",
      decidedByName: row.decided_by_name ?? "",
      decidedAt: row.decided_at ?? "",
      note: row.note ?? "",
      self: Boolean(row.self),
      canDecide: Boolean(row.can_decide),
      priceOver: Boolean(row.price_over),
    };
  }
  return found;
}

/** Each line of a purchase invoice that came from an order line, with its price against the order's. */
export async function loadPriceChecks(headerId: string): Promise<PriceCheck[]> {
  if (!UUID.test(headerId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("price_checks", { p_header_id: headerId });
  if (error) return [];
  const rows = (data ?? []) as { line_id: string; line_number: number; order_price: number; invoice_price: number; difference_percent: number | null; over: boolean }[];
  return rows.map((row) => ({
    lineId: row.line_id,
    lineNumber: row.line_number,
    orderPrice: Number(row.order_price).toFixed(2),
    invoicePrice: Number(row.invoice_price).toFixed(2),
    differencePercent: row.difference_percent == null ? "" : Number(row.difference_percent).toFixed(2),
    over: row.over,
  }));
}

function done(next: string, id: string, error: string | null): never {
  revalidatePath("/transactions");
  revalidatePath("/transactions/[code]", "page");
  revalidatePath("/");
  redirect(error ? `${next}?open=${id}&error=${encodeURIComponent(error)}` : `${next}?open=${id}`);
}

/** Asks for approval of a draft. Also run after a save, by "Save and request approval". */
export async function requestApproval(formData: FormData): Promise<never> {
  const id = text(formData, "id").trim();
  const next = returnPath(formData);
  if (!UUID.test(id)) redirect(next);
  await requireCurrentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_approval", { p_header_id: id, p_note: text(formData, "note").trim() || undefined });
  return done(next, id, error ? friendlyError(error, "Approval could not be asked for.") : null);
}

export async function approveDocument(formData: FormData): Promise<never> {
  const id = text(formData, "id").trim();
  const next = returnPath(formData);
  if (!UUID.test(id)) redirect(next);
  await requireCurrentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_document", { p_header_id: id, p_note: text(formData, "note").trim() || undefined });
  return done(next, id, error ? friendlyError(error, "That could not be approved.") : null);
}

export async function rejectDocument(formData: FormData): Promise<never> {
  const id = text(formData, "id").trim();
  const next = returnPath(formData);
  if (!UUID.test(id)) redirect(next);
  await requireCurrentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_document", { p_header_id: id, p_reason: text(formData, "reason").trim() });
  return done(next, id, error ? friendlyError(error, "That could not be refused.") : null);
}
