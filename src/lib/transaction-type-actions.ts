"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import { parseDescription, parseReferenceCode } from "@/lib/reference";
import { parseTransactionTypeKind } from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (error.code === "23514" && error.message.includes("type")) return "Choose Sales or Purchases.";
  if (error.code === "23514") return "Use 1 to 20 letters or numbers, and a description up to 200 characters.";
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
    return { error: "Use 1 to 20 letters or numbers, and a description up to 200 characters." } as const;
  }
  if (!type) return { error: "Choose Sales or Purchases." } as const;
  return { code, description, type } as const;
}

function refresh() {
  revalidatePath("/transaction-types");
  revalidatePath("/admin");
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
    last_reference: 1,
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
