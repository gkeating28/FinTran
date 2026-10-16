"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseCurrencyCode, parseCurrencyName, parseCurrencyRate } from "@/lib/currencies";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import {
  logoContentType,
  ORGANISATION_LOGO_BUCKET,
  ORGANISATION_LOGO_ERROR,
  organisationLogoPath,
} from "@/lib/organisation-logo";
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
  if (error.code === "23514" && error.message.includes("phone")) return "Use a phone number up to 40 characters.";
  if (error.code === "23514" && error.message.includes("contact_email")) return "Use a contact email, or leave it blank.";
  if (error.code === "23514" && error.message.includes("website")) {
    return "Use a website up to 200 characters, without spaces.";
  }
  if (error.code === "23514" && error.message.includes("address")) return "Address can be up to 500 characters.";
  if (error.code === "23514" && error.message.includes("contact_name")) return "Contact name can be up to 200 characters.";
  if (error.code === "23514" && error.message.includes("vat_number")) {
    return "VAT number can be up to 40 letters or numbers.";
  }
  if (error.code === "23514" && error.message.includes("company_number")) {
    return "Company number can be up to 40 letters or numbers.";
  }
  if (error.code === "23514" && error.message.includes("banking_details")) {
    return "Banking details can be up to 1000 characters.";
  }
  if (error.code === "23514" && error.message.includes("logo_path")) return ORGANISATION_LOGO_ERROR;
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
  revalidatePath("/", "layout");
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

function optionalField(value: string, max: number, pattern?: RegExp) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max || (pattern && !pattern.test(trimmed))) return undefined;
  return trimmed;
}

function profileFrom(formData: FormData) {
  const address = optionalField(text(formData, "address"), 500);
  const contactName = optionalField(text(formData, "contact_name"), 200);
  const contactEmail = optionalField(
    text(formData, "contact_email"),
    200,
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  );
  const website = optionalField(text(formData, "website"), 200, /^\S+$/);
  const phone = optionalField(text(formData, "phone"), 40, /^[0-9+(). -]+$/);
  const vatNumber = optionalField(text(formData, "vat_number"), 40, /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/);
  const companyNumber = optionalField(text(formData, "company_number"), 40, /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/);
  const bankingDetails = optionalField(text(formData, "banking_details"), 1000);
  if (address === undefined) return { error: "Address can be up to 500 characters." } as const;
  if (contactName === undefined) return { error: "Contact name can be up to 200 characters." } as const;
  if (contactEmail === undefined) return { error: "Use a contact email, or leave it blank." } as const;
  if (website === undefined) return { error: "Use a website up to 200 characters, without spaces." } as const;
  if (phone === undefined) return { error: "Use a phone number up to 40 characters." } as const;
  if (vatNumber === undefined) return { error: "VAT number can be up to 40 letters or numbers." } as const;
  if (companyNumber === undefined) return { error: "Company number can be up to 40 letters or numbers." } as const;
  if (bankingDetails === undefined) return { error: "Banking details can be up to 1000 characters." } as const;
  return {
    address,
    contact_name: contactName,
    contact_email: contactEmail,
    website,
    phone,
    vat_number: vatNumber,
    company_number: companyNumber,
    banking_details: bankingDetails,
  } as const;
}

async function logoChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  formData: FormData,
) {
  const file = formData.get("logo");
  const path = organisationLogoPath(organisationId);
  if (file instanceof File && file.size > 0) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = logoContentType(bytes);
    if (!contentType) return { error: ORGANISATION_LOGO_ERROR } as const;
    const uploaded = await supabase.storage.from(ORGANISATION_LOGO_BUCKET).upload(path, new Blob([bytes], { type: contentType }), {
      upsert: true,
      contentType,
      cacheControl: "3600",
    });
    if (uploaded.error) {
      const message = uploaded.error.message.toLowerCase();
      if (message.includes("mime") || message.includes("size") || message.includes("exceeded")) {
        return { error: ORGANISATION_LOGO_ERROR } as const;
      }
      return { error: "The logo could not be saved." } as const;
    }
    return { path } as const;
  }

  if (text(formData, "remove_logo") === "1") {
    const removed = await supabase.storage.from(ORGANISATION_LOGO_BUCKET).remove([path]);
    if (removed.error) return { error: "The logo could not be removed." } as const;
    return { path: null } as const;
  }

  return null;
}

export async function updateOrganisationDefaults(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organisation = organisationId(text(formData, "organisation_id").trim());
  const homeCurrencyId = organisationId(text(formData, "home_currency_id").trim());
  const profile = profileFrom(formData);
  if (!organisation) return { error: "Choose an organisation." };
  if (!homeCurrencyId) return { error: "Choose a home currency." };
  if ("error" in profile) return { error: profile.error };

  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  const membership = workspace.memberships.find((item) => item.organisationId === organisation);
  if (!membership) return { error: "You do not have access to that organisation." };

  const supabase = await createClient();
  const logo = await logoChange(supabase, membership.organisationId, formData);
  if (logo && "error" in logo) return { error: logo.error };
  const details = {
    home_currency_id: homeCurrencyId,
    ...profile,
    ...(logo ? { logo_path: logo.path } : {}),
  };
  const { data, error } = await supabase
    .from("organisation_defaults")
    .update(details)
    .eq("organisation_id", membership.organisationId)
    .select("organisation_id");

  if (error) return { error: friendlyError(error, "That organisation could not be saved.") };

  if (!data?.length) {
    const inserted = await supabase.from("organisation_defaults").insert({
      organisation_id: membership.organisationId,
      tenant_id: membership.tenantId,
      ...details,
    });
    if (inserted.error) return { error: friendlyError(inserted.error, "That organisation could not be saved.") };
  }

  refresh();
  return { message: "Saved." };
}
