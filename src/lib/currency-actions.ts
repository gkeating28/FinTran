"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseCurrencyCode, parseCurrencyName, parseCurrencyRate } from "@/lib/currencies";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (error.code === "23503" && error.message.includes("home_currency")) {
    return "That currency is the home currency. Choose another home currency before removing it.";
  }
  if (error.code === "23503" && error.message.includes("transaction_headers")) {
    return "That currency is used on an invoice. Choose another currency on the invoice before removing it.";
  }
  if (error.code === "23503") {
    return "That currency is used by a customer or supplier. Choose another currency for them before removing it.";
  }
  if (error.code === "23514" && error.message.includes("rate")) {
    return "Enter a rate greater than 0, with up to 8 decimal places.";
  }
  if (error.code === "23514") return "Use 1 to 20 letters or numbers, and a name up to 80 characters.";
  if (error.code === "P0001" && error.message.includes("Home currency")) {
    return "Choose a currency from this organisation.";
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

function currencyFields(formData: FormData) {
  const code = parseCurrencyCode(text(formData, "code"));
  const name = parseCurrencyName(text(formData, "name"));
  const rate = parseCurrencyRate(text(formData, "rate"));
  if (!code || !name) {
    return { error: "Use 1 to 20 letters or numbers, and a name up to 80 characters." } as const;
  }
  if (!rate) {
    return { error: "Enter a rate greater than 0, with up to 8 decimal places." } as const;
  }
  return { code, name, rate } as const;
}

function refresh() {
  revalidatePath("/currencies");
  revalidatePath("/organisations");
  revalidatePath("/customers");
  revalidatePath("/suppliers");
}

export async function createCurrency(_state: ActionState, formData: FormData): Promise<ActionState> {
  const fields = currencyFields(formData);
  if ("error" in fields) return { error: fields.error };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from("currencies").insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    code: fields.code,
    name: fields.name,
    rate: fields.rate,
  });

  if (error) return { error: friendlyError(error, "That currency could not be saved.") };

  refresh();
  return { message: "Added." };
}

export async function updateCurrency(_state: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, "id").trim();
  const fields = currencyFields(formData);
  if (!id || "error" in fields) {
    return { error: "error" in fields ? fields.error : "That currency could not be updated." };
  }

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("currencies")
    .update({ code: fields.code, name: fields.name, rate: fields.rate })
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) return { error: friendlyError(error, "That currency could not be updated.") };

  refresh();
  return { message: "Saved." };
}

export async function deleteCurrency(formData: FormData) {
  const id = text(formData, "id").trim();
  if (!id) redirect("/currencies");

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase
    .from("currencies")
    .delete()
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) {
    redirect(`/currencies?error=${encodeURIComponent(friendlyError(error, "That currency could not be removed."))}`);
  }

  refresh();
  redirect("/currencies");
}

function organisationId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export async function updateOrganisationDefaults(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organisation = organisationId(text(formData, "organisation_id").trim());
  const homeCurrencyId = organisationId(text(formData, "home_currency_id").trim());
  if (!organisation) return { error: "Choose an organisation." };
  if (!homeCurrencyId) return { error: "Choose a home currency." };

  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  const membership = workspace.memberships.find((item) => item.organisationId === organisation);
  if (!membership) return { error: "You do not have access to that organisation." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisation_defaults")
    .update({ home_currency_id: homeCurrencyId })
    .eq("organisation_id", membership.organisationId)
    .select("organisation_id");

  if (error) return { error: friendlyError(error, "That organisation could not be saved.") };

  if (!data?.length) {
    const inserted = await supabase.from("organisation_defaults").insert({
      organisation_id: membership.organisationId,
      tenant_id: membership.tenantId,
      home_currency_id: homeCurrencyId,
    });
    if (inserted.error) return { error: friendlyError(inserted.error, "That organisation could not be saved.") };
  }

  refresh();
  return { message: "Saved." };
}
