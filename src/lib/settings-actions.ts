"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentOrganisation, requireOrganisationMember } from "@/lib/organisation-guard";
import { encryptSecret, secretHint, type SecretKind } from "@/lib/secrets";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function setSecret(organisationId: string, kind: SecretKind, value: string): Promise<ActionState> {
  await requireCurrentOrganisation(["owner", "admin"]);
  await requireOrganisationMember(organisationId, ["owner", "admin"]);
  if (!value) return { error: "Enter a value." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_organisation_secret", {
    p_organisation_id: organisationId,
    p_kind: kind,
    p_ciphertext: encryptSecret(value, organisationId, kind),
    p_hint: secretHint(value),
  });
  if (error) return { error: "The secret could not be saved." };
  return { message: "Saved." };
}

export async function clearSecret(organisationId: string, kind: SecretKind): Promise<ActionState> {
  await requireCurrentOrganisation(["owner", "admin"]);
  await requireOrganisationMember(organisationId, ["owner", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_organisation_secret", { p_organisation_id: organisationId, p_kind: kind });
  if (error) return { error: "The secret could not be removed." };
  return { message: "Removed." };
}

export async function saveAiSettings(formData: FormData): Promise<void> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const enabled = formData.get("enabled") === "on";
  const provider = text(formData, "provider");
  const model = text(formData, "model");
  const baseUrl = text(formData, "baseUrl");
  const accepted = formData.get("notice") === "on";
  if (enabled && (!provider || !model || !accepted)) return;
  if (baseUrl && !baseUrl.startsWith("https://")) return;
  const apiKey = text(formData, "apiKey");
  if (apiKey) {
    const saved = await setSecret(current.organisationId, "ai_api_key", apiKey);
    if (saved.error) return;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("ai_settings").upsert({
    organisation_id: current.organisationId,
    tenant_id: current.tenantId,
    enabled,
    provider_code: provider || null,
    model: model || null,
    config: { baseUrl, deployment: text(formData, "deployment"), apiVersion: text(formData, "apiVersion") },
    data_notice_accepted_at: accepted ? new Date().toISOString() : null,
    user_hourly_limit: Number(text(formData, "hourly") || "30"),
    organisation_monthly_limit: text(formData, "monthly") ? Number(text(formData, "monthly")) : null,
  });
  if (error) return;
  revalidatePath("/ask-qula");
}

export async function saveAccessPoint(formData: FormData): Promise<void> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const environment = text(formData, "environment");
  if (environment === "production") {
    const defaults = await (await createClient()).from("organisation_defaults").select("peppol_id").eq("organisation_id", current.organisationId).maybeSingle();
    if (!(defaults.data as { peppol_id?: string } | null)?.peppol_id) {
      return;
    }
  }
  const existing = await (await createClient()).from("access_point_settings").select("participant_registered, provider_code").eq("organisation_id", current.organisationId).maybeSingle();
  const row = existing.data as { participant_registered?: boolean; provider_code?: string } | null;
  if (row?.participant_registered && row.provider_code && row.provider_code !== text(formData, "provider")) {
    return;
  }
  const apiKey = text(formData, "apiKey");
  if (apiKey) {
    const saved = await setSecret(current.organisationId, "ap_api_key", apiKey);
    if (saved.error) return;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("access_point_settings").upsert({
    organisation_id: current.organisationId,
    tenant_id: current.tenantId,
    provider_code: text(formData, "provider") || "mock",
    environment: environment || "sandbox",
    config: { baseUrl: text(formData, "baseUrl"), accountId: text(formData, "accountId") },
    webhook_token: text(formData, "webhook") || crypto.randomUUID().replace(/-/g, ""),
    status: formData.get("verified") === "on" ? "verified" : "configured",
    last_test_at: new Date().toISOString(),
    last_test_result: formData.get("verified") === "on" ? "ok" : text(formData, "testResult") || null,
  });
  if (error) return;
  revalidatePath("/access-point");
}
