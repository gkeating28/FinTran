"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseApprovalRuleForm } from "@/lib/approval-rules";
import { requireCurrentOrganisation } from "@/lib/organisation-guard";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "There is already a rule for that type at that amount.";
  if (error.code === "23514" && error.message.includes("amount")) return "Enter an amount above zero.";
  return error.message || fallback;
}

function fieldsFrom(formData: FormData) {
  return parseApprovalRuleForm({
    typeId: text(formData, "transaction_type_id"),
    amount: text(formData, "amount"),
    role: text(formData, "required_role"),
    active: formData.get("active") === "on",
  });
}

function refresh() {
  revalidatePath("/approval-rules");
  revalidatePath("/admin");
  revalidatePath("/transactions/[code]", "page");
}

export async function createApprovalRule(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = fieldsFrom(formData);
  if ("error" in parsed) return { error: parsed.error };

  const current = await requireCurrentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from("approval_rules").insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    ...parsed.fields,
  });
  if (error) return { error: friendlyError(error, "That rule could not be saved.") };

  refresh();
  return { message: "Added." };
}

export async function updateApprovalRule(_state: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id").trim();
  const parsed = fieldsFrom(formData);
  if (!id || "error" in parsed) return { error: "error" in parsed ? parsed.error : "That rule could not be updated." };

  const current = await requireCurrentOrganisation();
  const supabase = await createClient();
  // The type is fixed after save, so an update leaves it out.
  const { transaction_type_id: _type, ...changes } = parsed.fields;
  void _type;
  const { error } = await supabase
    .from("approval_rules")
    .update(changes)
    .eq("id", id)
    .eq("organisation_id", current.organisationId);
  if (error) return { error: friendlyError(error, "That rule could not be updated.") };

  refresh();
  return { message: "Saved." };
}

export async function deleteApprovalRule(formData: FormData) {
  const id = text(formData, "id").trim();
  if (!id) redirect("/approval-rules");

  const current = await requireCurrentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from("approval_rules").delete().eq("id", id).eq("organisation_id", current.organisationId);
  if (error) redirect(`/approval-rules?error=${encodeURIComponent(friendlyError(error, "That rule could not be removed."))}`);

  refresh();
  redirect("/approval-rules");
}
