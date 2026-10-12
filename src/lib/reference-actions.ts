"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import {
  parseAccountType,
  parseDescription,
  parseRate,
  parseReferenceCode,
  parseVatType,
  REFERENCE_META,
  type AccountType,
  type ReferenceKind,
  type VatType,
} from "@/lib/reference";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (error.code === "23503" && error.message.includes("transaction_lines")) {
    return "That code is used on an invoice line. Choose another code on the invoice before removing it.";
  }
  if (error.code === "23503" && error.message.includes("products")) {
    return "That code is used by a product. Choose another code on the product before removing it.";
  }
  if (error.code === "P0001" && error.message.includes("purchase GL")) {
    return "That GL code is a purchase GL code on a product and must stay Expense.";
  }
  if (error.code === "P0001" && error.message.includes("sales GL")) {
    return "That GL code is a sales GL code on a product and must stay Income.";
  }
  if (error.code === "P0001" && error.message.includes("purchase VAT")) {
    return "That VAT rate is a purchase VAT code on a product and must stay Expense.";
  }
  if (error.code === "P0001" && error.message.includes("sales VAT")) {
    return "That VAT rate is a sales VAT code on a product and must stay Sales.";
  }
  if (error.code === "23514" && error.message.includes("account_type")) {
    return "Choose a valid account type.";
  }
  if (error.code === "23514" && error.message.includes("vat_type")) return "Choose Sales or Expense.";
  if (error.code === "23514" && error.message.includes("rate")) {
    return "Enter a rate from 0 to 100, with up to 2 decimal places.";
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

function vatFields(kind: ReferenceKind, formData: FormData): {
  error: string | null;
  rate: string | null;
  vatType: VatType | null;
} {
  if (kind !== "vat_rates") return { error: null, rate: null, vatType: null };
  const rate = parseRate(text(formData, "rate"));
  const vatType = parseVatType(text(formData, "vat_type"));
  if (!rate) return { error: "Enter a rate from 0 to 100, with up to 2 decimal places.", rate: null, vatType: null };
  if (!vatType) return { error: "Choose Sales or Expense.", rate: null, vatType: null };
  return { error: null, rate, vatType };
}

export async function createReference(
  kind: ReferenceKind,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = parseReferenceCode(text(formData, "code"));
  const description = parseDescription(text(formData, "description"));
  const accountType = accountTypeFrom(kind, formData);
  const vat = vatFields(kind, formData);
  if (!code || !description) {
    return { error: "Use 1 to 20 letters or numbers, and a description up to 200 characters." };
  }
  if (kind === "gl_codes" && !accountType) return { error: "Choose an account type." };
  if (vat.error) return { error: vat.error };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from(kind).insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    code,
    description,
    ...(accountType ? { account_type: accountType } : {}),
    ...(vat.rate && vat.vatType ? { rate: vat.rate, vat_type: vat.vatType } : {}),
  });

  if (error) return { error: friendlyError(error, "That code could not be saved.") };

  refreshReference(kind);
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
  const vat = vatFields(kind, formData);
  if (!id || !code || !description) {
    return { error: "Use 1 to 20 letters or numbers, and a description up to 200 characters." };
  }
  if (kind === "gl_codes" && !accountType) return { error: "Choose an account type." };
  if (vat.error) return { error: vat.error };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from(kind)
    .update({
      code,
      description,
      ...(accountType ? { account_type: accountType } : {}),
      ...(vat.rate && vat.vatType ? { rate: vat.rate, vat_type: vat.vatType } : {}),
    })
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) return { error: friendlyError(error, "That code could not be updated.") };

  refreshReference(kind);
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

  refreshReference(kind);
  redirect(path);
}

function refreshReference(kind: ReferenceKind) {
  revalidatePath(REFERENCE_META[kind].path);
  revalidatePath("/admin");
  if (kind === "gl_codes" || kind === "vat_rates") revalidatePath("/products");
}
