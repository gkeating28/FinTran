"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import { listReference } from "@/lib/reference-data";
import { parseDescription } from "@/lib/reference";
import { parseProductCode, parseProductPrice } from "@/lib/products";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (
    error.code === "23514" &&
    (error.message.includes("purchase_price") || error.message.includes("sales_price"))
  ) {
    return "Enter a price of 0 or more, with up to 4 decimal places.";
  }
  if (error.code === "23514") {
    return "Use 1 to 30 letters or numbers, and a description up to 200 characters.";
  }
  if (error.code === "P0001" && error.message.includes("Expense account")) {
    return "Choose an Expense GL code for purchases.";
  }
  if (error.code === "P0001" && error.message.includes("Income account")) {
    return "Choose an Income GL code for sales.";
  }
  if (error.code === "P0001" && error.message.includes("Expense rate")) {
    return "Choose an Expense VAT rate for purchases.";
  }
  if (error.code === "P0001" && error.message.includes("Sales rate")) {
    return "Choose a Sales VAT rate for sales.";
  }
  if (error.code === "P0001" && error.message.includes("GL")) {
    return "Choose a GL code from this organisation.";
  }
  if (error.code === "P0001" && error.message.includes("VAT")) {
    return "Choose a VAT code from this organisation.";
  }
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function idFrom(formData: FormData, name: string) {
  const value = text(formData, name).trim();
  if (!UUID.test(value)) return null;
  return value;
}

function fieldsFrom(formData: FormData) {
  const code = parseProductCode(text(formData, "code"));
  const description = parseDescription(text(formData, "description"));
  const purchasePrice = parseProductPrice(text(formData, "purchase_price"));
  const salesPrice = parseProductPrice(text(formData, "sales_price"));
  const purchaseGlCodeId = idFrom(formData, "purchase_gl_code_id");
  const salesGlCodeId = idFrom(formData, "sales_gl_code_id");
  const purchaseVatCodeId = idFrom(formData, "purchase_vat_code_id");
  const salesVatCodeId = idFrom(formData, "sales_vat_code_id");

  if (!code || !description) {
    return {
      error: "Use 1 to 30 letters or numbers, and a description up to 200 characters.",
    } as const;
  }
  if (!purchasePrice) {
    return { error: "Enter a purchase price of 0 or more, with up to 4 decimal places." } as const;
  }
  if (!salesPrice) {
    return { error: "Enter a sales price of 0 or more, with up to 4 decimal places." } as const;
  }
  if (!purchaseGlCodeId) return { error: "Choose a purchase GL code." } as const;
  if (!purchaseVatCodeId) return { error: "Choose a purchase VAT code." } as const;
  if (!salesGlCodeId) return { error: "Choose a sales GL code." } as const;
  if (!salesVatCodeId) return { error: "Choose a sales VAT code." } as const;

  return {
    code,
    description,
    purchasePrice,
    salesPrice,
    purchaseGlCodeId,
    salesGlCodeId,
    purchaseVatCodeId,
    salesVatCodeId,
  } as const;
}

function refresh() {
  revalidatePath("/products");
  revalidatePath("/admin");
}

export async function loadProductChoices() {
  const [glCodes, vatRates] = await Promise.all([
    listReference("gl_codes"),
    listReference("vat_rates"),
  ]);
  return {
    glCodes: glCodes.rows,
    vatRates: vatRates.rows,
    error: [glCodes.error, vatRates.error].filter(Boolean).join(" ") || null,
  };
}

export async function createProduct(_state: ActionState, formData: FormData): Promise<ActionState> {
  const fields = fieldsFrom(formData);
  if ("error" in fields) return { error: fields.error };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    code: fields.code,
    description: fields.description,
    purchase_price: fields.purchasePrice,
    sales_price: fields.salesPrice,
    purchase_gl_code_id: fields.purchaseGlCodeId,
    sales_gl_code_id: fields.salesGlCodeId,
    purchase_vat_code_id: fields.purchaseVatCodeId,
    sales_vat_code_id: fields.salesVatCodeId,
  });

  if (error) return { error: friendlyError(error, "That product could not be saved.") };

  refresh();
  return { message: "Added." };
}

export async function updateProduct(_state: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id").trim();
  const fields = fieldsFrom(formData);
  if (!id || "error" in fields) {
    return { error: "error" in fields ? fields.error : "That product could not be updated." };
  }

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      code: fields.code,
      description: fields.description,
      purchase_price: fields.purchasePrice,
      sales_price: fields.salesPrice,
      purchase_gl_code_id: fields.purchaseGlCodeId,
      sales_gl_code_id: fields.salesGlCodeId,
      purchase_vat_code_id: fields.purchaseVatCodeId,
      sales_vat_code_id: fields.salesVatCodeId,
    })
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) return { error: friendlyError(error, "That product could not be updated.") };

  refresh();
  return { message: "Saved." };
}

export async function deleteProduct(formData: FormData) {
  const id = text(formData, "id").trim();
  if (!id) redirect("/products");

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) {
    redirect(`/products?error=${encodeURIComponent(friendlyError(error, "That product could not be removed."))}`);
  }

  refresh();
  redirect("/products");
}
