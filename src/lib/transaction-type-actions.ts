"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import { parseDescription, parseReferenceCode } from "@/lib/reference";
import { parseFlexLabel, parseTransactionTypeKind } from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (error.code === "23503" && error.message.includes("transaction_")) {
    return "That transaction type is used on an invoice. Remove the invoice before removing the type.";
  }
  if (error.code === "23514" && error.message.includes("type")) return "Choose Sales or Purchases.";
  if (error.code === "23514" && error.message.includes("flex")) return "Each flex label can be up to 80 characters.";
  if (error.code === "23514") return "Start the code with a letter or number. Then use letters, numbers, dots, or hyphens, up to 20 characters, and a description up to 200 characters.";
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

  return {
    organisationId: workspace.current.organisationId,
    tenantId: workspace.current.tenantId,
  };
}

function fieldsFrom(formData: FormData) {
  const code = parseReferenceCode(text(formData, "code"));
  const description = parseDescription(text(formData, "description"));
  const type = parseTransactionTypeKind(text(formData, "type"));
  if (!code || !description) {
    return { error: "Start the code with a letter or number. Then use letters, numbers, dots, or hyphens, up to 20 characters, and a description up to 200 characters." } as const;
  }
  if (!type) return { error: "Choose Sales or Purchases." } as const;
  const flexLabels = [1, 2, 3, 4, 5].map((number) => parseFlexLabel(text(formData, `flex${number}_label`)));
  if (flexLabels.some((label) => label === undefined)) {
    return { error: "Each flex label can be up to 80 characters." } as const;
  }
  return { code, description, type, flexLabels: flexLabels as [string | null, string | null, string | null, string | null, string | null] } as const;
}

function refresh() {
  revalidatePath("/transaction-types");
  revalidatePath("/transactions");
  revalidatePath("/admin");
}

function labelColumns(labels: readonly (string | null)[]) {
  return {
    flex1_label: labels[0],
    flex2_label: labels[1],
    flex3_label: labels[2],
    flex4_label: labels[3],
    flex5_label: labels[4],
  };
}

export async function createTransactionType(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = fieldsFrom(formData);
  if ("error" in fields) return { error: fields.error };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from("transaction_types").insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    code: fields.code,
    description: fields.description,
    type: fields.type,
    last_reference: 0,
    ...labelColumns(fields.flexLabels),
  });

  if (error) return { error: friendlyError(error, "That transaction type could not be saved.") };

  refresh();
  return { message: "Added." };
}

export async function updateTransactionType(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = text(formData, "id").trim();
  const fields = fieldsFrom(formData);
  if (!id || "error" in fields) {
    return { error: "error" in fields ? fields.error : "That transaction type could not be updated." };
  }

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("transaction_types")
    .update({
      code: fields.code,
      description: fields.description,
      type: fields.type,
      ...labelColumns(fields.flexLabels),
    })
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) return { error: friendlyError(error, "That transaction type could not be updated.") };

  refresh();
  return { message: "Saved." };
}

export async function deleteTransactionType(formData: FormData) {
  const id = text(formData, "id").trim();
  if (!id) redirect("/transaction-types");

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("transaction_types")
    .delete()
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) {
    redirect(
      `/transaction-types?error=${encodeURIComponent(friendlyError(error, "That transaction type could not be removed."))}`,
    );
  }

  refresh();
  redirect("/transaction-types");
}
