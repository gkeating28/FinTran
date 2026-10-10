"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import {
  parseAccountType,
  parseDescription,
  parseReferenceCode,
  REFERENCE_META,
  type AccountType,
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
  if (error.code === "23514" && error.message.includes("account_type")) {
    return "Choose a valid account type.";
  }
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

function accountTypeFrom(kind: ReferenceKind, formData: FormData): AccountType | null {
  if (kind !== "gl_codes") return null;
  return parseAccountType(text(formData, "account_type"));
}

export async function createReference(
  kind: ReferenceKind,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = parseReferenceCode(text(formData, "code"));
  const description = parseDescription(text(formData, "description"));
  const accountType = accountTypeFrom(kind, formData);
  if (!code || !description) {
    return { error: "Use 1 to 20 letters or numbers, and a description up to 200 characters." };
  }
  if (kind === "gl_codes" && !accountType) return { error: "Choose an account type." };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from(kind).insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    code,
    description,
    ...(accountType ? { account_type: accountType } : {}),
  });

  if (error) return { error: friendlyError(error, "That code could not be saved.") };

  revalidatePath(REFERENCE_META[kind].path);
  return { message: "Added." };
}

export async function updateReference(
  kind: ReferenceKind,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = text(formData, "id").trim();
  const code = parseReferenceCode(text(formData, "code"));
  const description = parseDescription(text(formData, "description"));
  const accountType = accountTypeFrom(kind, formData);
  if (!id || !code || !description) {
    return { error: "Use 1 to 20 letters or numbers, and a description up to 200 characters." };
  }
  if (kind === "gl_codes" && !accountType) return { error: "Choose an account type." };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from(kind)
    .update({
      code,
      description,
      ...(accountType ? { account_type: accountType } : {}),
    })
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) return { error: friendlyError(error, "That code could not be updated.") };

  revalidatePath(REFERENCE_META[kind].path);
  return { message: "Saved." };
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
