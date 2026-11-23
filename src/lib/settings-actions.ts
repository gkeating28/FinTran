"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mockAccessPoint } from "@/lib/access-point/adapter";
import { adapterFor } from "@/lib/ai/providers";
import { requireOrganisationMember } from "@/lib/organisation-guard";
import { settingsOrganisation, settingsUrl, type SettingsTab } from "@/lib/org-settings";
import { encryptSecret, getSecret, secretHint, type SecretKind } from "@/lib/secrets";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function isNavigationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const digest = (error as { digest?: string }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

export async function setSecret(organisationId: string, kind: SecretKind, value: string): Promise<ActionState> {
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

export async function clearSecret(formData: FormData) {
  const current = await settingsOrganisation(formData);
  const kind = text(formData, "kind") as SecretKind;
  const tab: SettingsTab = text(formData, "tab") === "access-point" ? "access-point" : "ask-qula";
  const { error } = await (await createClient()).rpc("clear_organisation_secret", { p_organisation_id: current.organisationId, p_kind: kind });
  if (error) redirect(settingsUrl(current.organisationId, tab, "error", "The secret could not be removed."));
  redirect(settingsUrl(current.organisationId, tab, "message", "The key was removed."));
}

export async function saveAiSettings(formData: FormData): Promise<void> {
  const current = await settingsOrganisation(formData);
  const to = (key: "error" | "message", value: string) => settingsUrl(current.organisationId, "ask-qula", key, value);
  try {
    const enabled = formData.get("enabled") === "on";
    const provider = text(formData, "provider");
    const model = text(formData, "model");
    const baseUrl = text(formData, "baseUrl");
    const accepted = formData.get("notice") === "on";
    if (baseUrl && !baseUrl.startsWith("https://")) redirect(to("error", "The base URL must use https."));
    const apiKey = text(formData, "apiKey");
    if (apiKey) {
      const saved = await setSecret(current.organisationId, "ai_api_key", apiKey);
      if (saved.error) redirect(to("error", saved.error));
    }
    const supabase = await createClient();
    const existing = await supabase.from("ai_settings").select("data_notice_accepted_at, log_answers, answer_retention_days, log_notice_accepted_at").eq("organisation_id", current.organisationId).maybeSingle();
    if (existing.error) redirect(to("error", existing.error.message));
    const alreadyAccepted = Boolean((existing.data as { data_notice_accepted_at?: string } | null)?.data_notice_accepted_at);
    if (enabled && (!provider || !model || (!accepted && !alreadyAccepted))) {
      redirect(to("error", "Choose a provider and model, and accept the data notice."));
    }
    // Keeping questions and answers has its own notice. It is needed when keeping is switched on and when the number of
    // days changes while it is on. The database enforces the same rule.
    const before = existing.data as { log_answers?: boolean; answer_retention_days?: number; log_notice_accepted_at?: string | null } | null;
    const retentionText = text(formData, "retentionDays") || "30";
    const retention = Number(retentionText);
    if (!/^\d{1,3}$/.test(retentionText) || retention < 1 || retention > 365) {
      redirect(to("error", "Keep the text for 1 to 365 days."));
    }
    const logAnswers = formData.get("logAnswers") === "on";
    const needsLogNotice = logAnswers && (!before?.log_answers || before.answer_retention_days !== retention);
    if (needsLogNotice && formData.get("logNotice") !== "on") {
      redirect(to("error", `Accept the notice that questions and answers will be stored for ${retention} days and visible to owners and admins.`));
    }
    const key = apiKey || (await getSecret(current.organisationId, "ai_api_key")) || "";
    if (enabled && !key) redirect(to("error", "Add an API key before enabling Ask Qula."));
    const { error } = await supabase.from("ai_settings").upsert({
      organisation_id: current.organisationId,
      tenant_id: current.tenantId,
      enabled,
      provider_code: provider || null,
      model: model || null,
      config: { baseUrl, deployment: text(formData, "deployment"), apiVersion: text(formData, "apiVersion") },
      log_answers: logAnswers,
      answer_retention_days: retention,
      log_notice_accepted_at: needsLogNotice ? new Date().toISOString() : (before?.log_notice_accepted_at ?? null),
      // Actions are a separate switch, and they can only be on while AI answers are on.
      actions_enabled: enabled && formData.get("actionsEnabled") === "on",
      ...(accepted ? { data_notice_accepted_at: new Date().toISOString() } : {}),
      user_hourly_limit: Math.min(500, Math.max(1, Number(text(formData, "hourly") || "30"))),
      organisation_monthly_limit: text(formData, "monthly") ? Number(text(formData, "monthly")) : null,
    });
    if (error) redirect(to("error", error.message));
    revalidatePath("/organisations");
    redirect(to("message", "Saved."));
  } catch (error) {
    if (isNavigationError(error)) throw error;
    const message = error instanceof Error ? error.message : "Ask Qula could not be saved.";
    redirect(to("error", message));
  }
}

export async function testAiConnection(formData: FormData) {
  const current = await settingsOrganisation(formData);
  const to = (key: "error" | "message", value: string) => settingsUrl(current.organisationId, "ask-qula", key, value);
  try {
    const provider = text(formData, "provider");
    const model = text(formData, "model");
    const typedKey = text(formData, "apiKey");
    const apiKey = typedKey || (await getSecret(current.organisationId, "ai_api_key")) || "";
    if (!provider || !model || !apiKey) redirect(to("error", "Choose a provider, model, and key before testing."));
    const turn = await adapterFor({
      provider,
      model,
      config: { baseUrl: text(formData, "baseUrl"), deployment: text(formData, "deployment"), apiVersion: text(formData, "apiVersion") },
      apiKey,
    }).complete({ system: "Reply with the single word ready.", messages: [{ role: "user", text: "ping" }], tools: [] });
    redirect(to("message", turn.text ? `The connection succeeded. ${turn.text}` : "The connection succeeded."));
  } catch (error) {
    if (isNavigationError(error)) throw error;
    const message = error instanceof Error ? error.message : "The provider could not be reached.";
    redirect(to("error", message));
  }
}

export async function saveAccessPoint(formData: FormData): Promise<void> {
  const current = await settingsOrganisation(formData);
  const to = (key: "error" | "message", value: string) => settingsUrl(current.organisationId, "access-point", key, value);
  await writeAccessPoint(current.organisationId, current.tenantId, formData, null, to);
  revalidatePath("/organisations");
  redirect(to("message", "Saved."));
}

export async function testAccessPoint(formData: FormData) {
  const current = await settingsOrganisation(formData);
  const to = (key: "error" | "message", value: string) => settingsUrl(current.organisationId, "access-point", key, value);
  const forced = text(formData, "forceFailure") === "on";
  const result = forced
    ? { ok: false, message: "The mock Access Point refused the connection." }
    : await mockAccessPoint().testConnection();
  await writeAccessPoint(current.organisationId, current.tenantId, formData, result, to);
  redirect(to(result.ok ? "message" : "error", result.message));
}

export async function lookupParticipant(formData: FormData) {
  const current = await settingsOrganisation(formData);
  const to = (key: "error" | "message", value: string) => settingsUrl(current.organisationId, "access-point", key, value);
  const found = await mockAccessPoint().lookupParticipant(text(formData, "scheme"), text(formData, "participant"));
  redirect(to("message", found.registered ? "That participant can receive invoices." : "That participant was not found."));
}

export async function registerParticipant(formData: FormData) {
  const current = await settingsOrganisation(formData);
  const to = (key: "error" | "message", value: string) => settingsUrl(current.organisationId, "access-point", key, value);
  const supabase = await createClient();
  const settings = await supabase.from("access_point_settings").select("status, provider_code").eq("organisation_id", current.organisationId).maybeSingle();
  const row = settings.data as { status?: string; provider_code?: string } | null;
  if (row?.status !== "verified") redirect(to("error", "Test the connection before registering."));
  const defaults = await supabase.from("organisation_defaults").select("peppol_scheme, peppol_id").eq("organisation_id", current.organisationId).maybeSingle();
  const peppol = defaults.data as { peppol_scheme?: string; peppol_id?: string } | null;
  if (!peppol?.peppol_id) redirect(to("error", "Add a Peppol ID before registering."));
  await mockAccessPoint().registerParticipant(peppol.peppol_scheme ?? "", peppol.peppol_id);
  const { error } = await supabase.from("access_point_settings").update({
    participant_registered: true,
    participant_registered_at: new Date().toISOString(),
  }).eq("organisation_id", current.organisationId);
  if (error) redirect(to("error", error.message));
  redirect(to("message", "The Peppol ID is registered."));
}

async function writeAccessPoint(
  organisationId: string,
  tenantId: string,
  formData: FormData,
  test: { ok: boolean; message: string } | null,
  to: (key: "error" | "message", value: string) => string,
) {
  const environment = text(formData, "environment") || "sandbox";
  const supabase = await createClient();
  if (environment === "production") {
    const defaults = await supabase.from("organisation_defaults").select("peppol_id").eq("organisation_id", organisationId).maybeSingle();
    if (!(defaults.data as { peppol_id?: string } | null)?.peppol_id) {
      redirect(to("error", "Add a Peppol ID before using production."));
    }
  }
  const existing = await supabase.from("access_point_settings").select("participant_registered, provider_code, webhook_token").eq("organisation_id", organisationId).maybeSingle();
  const row = existing.data as { participant_registered?: boolean; provider_code?: string; webhook_token?: string } | null;
  const provider = text(formData, "provider") || "mock";
  if (row?.participant_registered && row.provider_code && row.provider_code !== provider) {
    redirect(to("error", "Deregister the Peppol ID with the current provider before switching."));
  }
  const apiKey = text(formData, "apiKey");
  if (apiKey) {
    const saved = await setSecret(organisationId, "ap_api_key", apiKey);
    if (saved.error) redirect(to("error", saved.error));
  }
  const webhookSecret = text(formData, "webhookSecret");
  if (webhookSecret) {
    const saved = await setSecret(organisationId, "ap_webhook_secret", webhookSecret);
    if (saved.error) redirect(to("error", saved.error));
  }
  const { error } = await supabase.from("access_point_settings").upsert({
    organisation_id: organisationId,
    tenant_id: tenantId,
    provider_code: provider,
    environment,
    config: { baseUrl: text(formData, "baseUrl"), accountId: text(formData, "accountId") },
    webhook_token: row?.webhook_token || crypto.randomUUID().replace(/-/g, ""),
    ...(test
      ? { status: test.ok ? "verified" : "configured", last_test_at: new Date().toISOString(), last_test_result: test.message }
      : {}),
  });
  if (error) redirect(to("error", error.message));
}
