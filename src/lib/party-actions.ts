"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWorkspace, ORGANISATION_COOKIE } from "@/lib/data";
import { codeChangeError, friendlyCodeChange } from "@/lib/immutable-code";
import { PARTY_META, parseParty, type PartyFields, type PartyKind } from "@/lib/parties";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  const locked = friendlyCodeChange(error);
  if (locked) return locked;
  if (!error) return fallback;
  if (error.code === "23505") return "That code is already used in this organisation.";
  if (error.code === "23503" && error.message.includes("transaction_headers")) {
    return "That supplier is used on an invoice. Choose another supplier on the invoice before removing it.";
  }
  if (error.code === "23514" && error.message.includes("phone")) return "Use a phone number up to 40 characters.";
  if (error.code === "23514" && error.message.includes("email")) return "Use an email address, or leave it blank.";
  if (error.code === "23514" && error.message.includes("website")) {
    return "Use a website up to 200 characters, without spaces.";
  }
  if (error.code === "23505" && error.message.includes("peppol")) {
    return "That Peppol ID is already used in this organisation.";
  }
  if (error.code === "23514" && error.message.includes("address_line")) return "Each address line can be up to 100 characters.";
  if (error.code === "23514" && error.message.includes("post_code")) return "Post code can be up to 20 characters.";
  if (error.code === "23514" && error.message.includes("city")) return "City can be up to 60 characters.";
  if (error.code === "23514" && error.message.includes("county")) return "County can be up to 60 characters.";
  if (error.code === "23514" && error.message.includes("contact_details")) {
    return "Contact details can be up to 500 characters.";
  }
  if (error.code === "23514" && error.message.includes("notes")) return "Notes can be up to 4000 characters.";
  if (error.code === "23514") return "Start the code with a letter or number. Then use letters, numbers, dots, or hyphens, up to 20 characters, and a name up to 200 characters.";
  if (error.code === "P0001" && error.message.includes("Currency")) {
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

function fieldsFrom(formData: FormData) {
  return parseParty({
    code: text(formData, "code"),
    name: text(formData, "name"),
    currencyId: text(formData, "currency_id"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    website: text(formData, "website"),
    address: {
      line1: text(formData, "address_line1"),
      line2: text(formData, "address_line2"),
      line3: text(formData, "address_line3"),
      city: text(formData, "city"),
      postCode: text(formData, "post_code"),
      county: text(formData, "county"),
      countryCode: text(formData, "country_code"),
    },
    contactDetails: text(formData, "contact_details"),
    notes: text(formData, "notes"),
    vatNumber: text(formData, "vat_number"),
    companyNumber: text(formData, "company_number"),
    peppolScheme: text(formData, "peppol_scheme"),
    peppolId: text(formData, "peppol_id"),
    paymentTermsDays: text(formData, "payment_terms_days"),
    defaultBuyerReference: text(formData, "default_buyer_reference"),
  });
}

function rowFrom(kind: PartyKind, fields: PartyFields, includeCode = true) {
  return {
    ...(includeCode ? { code: fields.code } : {}),
    name: fields.name,
    currency_id: fields.currencyId,
    phone: fields.phone,
    email: fields.email,
    website: fields.website,
    address_line1: fields.addressLine1,
    address_line2: fields.addressLine2,
    address_line3: fields.addressLine3,
    city: fields.city,
    post_code: fields.postCode,
    county: fields.county,
    country_code: fields.countryCode,
    address_needs_review: false,
    contact_details: fields.contactDetails,
    notes: fields.notes,
    vat_number: fields.vatNumber,
    company_number: fields.companyNumber,
    peppol_scheme: fields.peppolScheme,
    peppol_id: fields.peppolId,
    payment_terms_days: fields.paymentTermsDays,
    ...(kind === "customers" ? { default_buyer_reference: fields.defaultBuyerReference } : {}),
  };
}

export async function createParty(
  kind: PartyKind,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = fieldsFrom(formData);
  if ("error" in fields) return { error: fields.error };

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from(kind).insert({
    tenant_id: current.tenantId,
    organisation_id: current.organisationId,
    ...rowFrom(kind, fields),
  });

  if (error) return { error: friendlyError(error, "That record could not be saved.") };

  revalidatePath(PARTY_META[kind].path);
  return { message: "Added." };
}

export async function updateParty(
  kind: PartyKind,
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = text(formData, "id").trim();
  const fields = fieldsFrom(formData);
  if (!id || "error" in fields) {
    return { error: "error" in fields ? fields.error : "That record could not be updated." };
  }

  const current = await currentOrganisation();
  const supabase = await createClient();
  const locked = await codeChangeError(
    supabase,
    kind,
    id,
    current.organisationId,
    fields.code,
    "That record could not be updated.",
  );
  if (locked) return { error: locked };

  const { error } = await supabase
    .from(kind)
    .update(rowFrom(kind, fields, false))
    .eq("id", id)
    .eq("organisation_id", current.organisationId);

  if (error) return { error: friendlyError(error, "That record could not be updated.") };

  revalidatePath(PARTY_META[kind].path);
  return { message: "Saved." };
}

export async function deleteParty(kind: PartyKind, formData: FormData) {
  const path = PARTY_META[kind].path;
  const id = text(formData, "id").trim();
  if (!id) redirect(path);

  const current = await currentOrganisation();
  const supabase = await createClient();
  const { error } = await supabase.from(kind).delete().eq("id", id).eq("organisation_id", current.organisationId);

  if (error) {
    redirect(`${path}?error=${encodeURIComponent(friendlyError(error, "That record could not be removed."))}`);
  }

  revalidatePath(path);
  redirect(path);
}
