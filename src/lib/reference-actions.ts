"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/data";
import {
  parseDescription,
  parseReferenceCode,
  REFERENCE_META,
  type ReferenceKind,
} from "@/lib/reference";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (error.code === "23514") return "Use 1 to 20 letters or numbers, and a description up to 200 characters.";
  return error.message || fallback;
}

async function currentOrganisation() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  return workspace.current;
}

export async function createReference(
  kind: ReferenceKind,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = parseReferenceCode(text(formData, "code"));
  const description = parseDescription(text(formData, "description"));
  if (!code || !description) {
    return { error: "Use 1 to 20 letters or numbers, and a description up to 200 characters." };
  }

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from(kind).insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    code,
    description,
  });

  if (error) return { error: friendlyError(error, "That code could not be saved.") };

  revalidatePath(REFERENCE_META[kind].path);
  return { message: "Added." };
}

export async function updateReference(kind: ReferenceKind, formData: FormData) {
  const path = REFERENCE_META[kind].path;
  const id = text(formData, "id").trim();
  const code = parseReferenceCode(text(formData, "code"));
  const description = parseDescription(text(formData, "description"));
  if (!id || !code || !description) {
    redirect(`${path}?error=${encodeURIComponent("Use 1 to 20 letters or numbers, and a description up to 200 characters.")}`);
  }

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from(kind)
    .update({ code, description })
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) {
    redirect(`${path}?error=${encodeURIComponent(friendlyError(error, "That code could not be updated."))}`);
  }

  revalidatePath(path);
  redirect(path);
}

export async function deleteReference(kind: ReferenceKind, formData: FormData) {
  const path = REFERENCE_META[kind].path;
  const id = text(formData, "id").trim();
  if (!id) redirect(path);

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from(kind)
    .delete()
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) {
    redirect(`${path}?error=${encodeURIComponent(friendlyError(error, "That code could not be removed."))}`);
  }

  revalidatePath(path);
  redirect(path);
}
