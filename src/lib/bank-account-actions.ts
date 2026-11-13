"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseBankAccountForm } from "@/lib/bank-accounts";
import { codeChangeError, friendlyCodeChange } from "@/lib/immutable-code";
import { requireCurrentOrganisation } from "@/lib/organisation-guard";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  const locked = friendlyCodeChange(error);
  if (locked) return locked;
  if (!error) return fallback;
  if (error.code === "23505" && error.message.includes("iban")) {
    return "That IBAN is already used by another bank account in this organisation.";
  }
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (error.code === "23503" && error.message.includes("payments")) {
    return "That bank account is used by a payment. Make it inactive instead.";
  }
  if (error.code === "23503") return "That bank account is in use and cannot be removed. Make it inactive instead.";
  if (error.code === "23514" && error.message.includes("default_active")) {
    return "An inactive account cannot be the default.";
  }
  if (error.code === "23514") {
    return "Start the code with a letter or number. Then use letters, numbers, dots, or hyphens, up to 20 characters, and a name up to 100 characters.";
  }
  return error.message || fallback;
}

function fieldsFrom(formData: FormData) {
  return parseBankAccountForm({
    code: text(formData, "code"),
    name: text(formData, "name"),
    iban: text(formData, "iban"),
    bic: text(formData, "bic"),
    currencyId: text(formData, "currency_id"),
    glCodeId: text(formData, "gl_code_id"),
    active: formData.get("active") === "on",
    isDefault: formData.get("is_default") === "on",
  });
}

function refresh() {
  revalidatePath("/bank-accounts");
  revalidatePath("/admin");
}

export async function createBankAccount(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = fieldsFrom(formData);
  if ("error" in parsed) return { error: parsed.error };

  const current = await requireCurrentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from("bank_accounts").insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    ...parsed.fields,
  });
  if (error) return { error: friendlyError(error, "That bank account could not be saved.") };

  refresh();
  return { message: "Added." };
}

export async function updateBankAccount(_state: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id").trim();
  const parsed = fieldsFrom(formData);
  if (!id || "error" in parsed) {
    return { error: "error" in parsed ? parsed.error : "That bank account could not be updated." };
  }

  const current = await requireCurrentOrganisation();
  const supabase = await createClient();
  const locked = await codeChangeError(
    supabase,
    "bank_accounts",
    id,
    current.organisationId,
    parsed.fields.code,
    "That bank account could not be updated.",
  );
  if (locked) return { error: locked };

  // The code is fixed after save, so an update leaves it out.
  const { code: _code, ...changes } = parsed.fields;
  void _code;
  const { error } = await supabase
    .from("bank_accounts")
    .update(changes)
    .eq("id", id)
    .eq("organisation_id", current.organisationId);
  if (error) return { error: friendlyError(error, "That bank account could not be updated.") };

  refresh();
  return { message: "Saved." };
}

export async function deleteBankAccount(formData: FormData) {
  const id = text(formData, "id").trim();
  if (!id) redirect("/bank-accounts");

  const current = await requireCurrentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_accounts")
    .delete()
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) {
    redirect(`/bank-accounts?error=${encodeURIComponent(friendlyError(error, "That bank account could not be removed."))}`);
  }

  refresh();
  redirect("/bank-accounts");
}
