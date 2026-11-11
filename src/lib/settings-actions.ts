"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { mockAccessPoint } from "@/lib/access-point/adapter";
import { adapterFor } from "@/lib/ai/providers";
import { requireCurrentOrganisation, requireOrganisationMember } from "@/lib/organisation-guard";
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

export async function clearSecret(formData: FormData) {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const kind = text(formData, "kind") as SecretKind;
  await clearSecretFor(current.organisationId, kind);
  redirect(text(formData, "return") || "/ask-qula");
}

async function clearSecretFor(organisationId: string, kind: SecretKind) {
  await requireOrganisationMember(organisationId, ["owner", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_organisation_secret", { p_organisation_id: organisationId, p_kind: kind });
  if (error) redirect(`/ask-qula?error=${encodeURIComponent("The secret could not be removed.")}`);
}

export async function saveAiSettings(formData: FormData): Promise<void> {
  try {
    const current = await requireCurrentOrganisation(["owner", "admin"]);
    const enabled = formData.get("enabled") === "on";
    const provider = text(formData, "provider");
    const model = text(formData, "model");
    const baseUrl = text(formData, "baseUrl");
    const accepted = formData.get("notice") === "on";
    if (baseUrl && !baseUrl.startsWith("https://")) redirect("/ask-qula?error=The%20base%20URL%20must%20use%20https.");
    const apiKey = text(formData, "apiKey");
    if (apiKey) {
      const saved = await setSecret(current.organisationId, "ai_api_key", apiKey);
      if (saved.error) redirect(`/ask-qula?error=${encodeURIComponent(saved.error)}`);
    }
    const supabase = await createClient();
    const existing = await supabase.from("ai_settings").select("data_notice_accepted_at").eq("organisation_id", current.organisationId).maybeSingle();
    if (existing.error) redirect(`/ask-qula?error=${encodeURIComponent(existing.error.message)}`);
    const alreadyAccepted = Boolean((existing.data as { data_notice_accepted_at?: string } | null)?.data_notice_accepted_at);
    if (enabled && (!provider || !model || (!accepted && !alreadyAccepted))) {
      redirect("/ask-qula?error=Choose%20a%20provider%20and%20model%2C%20and%20accept%20the%20data%20notice.");
    }
    const key = apiKey || (await getSecret(current.organisationId, "ai_api_key")) || "";
    if (enabled && !key) redirect("/ask-qula?error=Add%20an%20API%20key%20before%20enabling%20Ask%20Qula.");
    const { error } = await supabase.from("ai_settings").upsert({
      organisation_id: current.organisationId,
      tenant_id: current.tenantId,
      enabled,
      provider_code: provider || null,
      model: model || null,
      config: { baseUrl, deployment: text(formData, "deployment"), apiVersion: text(formData, "apiVersion") },
      log_answers: formData.get("logAnswers") === "on",
      // Actions are a separate switch, and they can only be on while AI answers are on.
      actions_enabled: enabled && formData.get("actionsEnabled") === "on",
      ...(accepted ? { data_notice_accepted_at: new Date().toISOString() } : {}),
      user_hourly_limit: Math.min(500, Math.max(1, Number(text(formData, "hourly") || "30"))),
      organisation_monthly_limit: text(formData, "monthly") ? Number(text(formData, "monthly")) : null,
    });
    if (error) redirect(`/ask-qula?error=${encodeURIComponent(error.message)}`);
    revalidatePath("/ask-qula");
    redirect("/ask-qula?message=Saved.");
  } catch (error) {
    if (isNavigationError(error)) throw error;
    const message = error instanceof Error ? error.message : "Ask Qula could not be saved.";
    redirect(`/ask-qula?error=${encodeURIComponent(message)}`);
  }
}

export async function testAiConnection(formData: FormData) {
  try {
    const current = await requireCurrentOrganisation(["owner", "admin"]);
    const provider = text(formData, "provider");
    const model = text(formData, "model");
    const typedKey = text(formData, "apiKey");
    const apiKey = typedKey || (await getSecret(current.organisationId, "ai_api_key")) || "";
    if (!provider || !model || !apiKey) redirect("/ask-qula?error=Choose%20a%20provider%2C%20model%2C%20and%20key%20before%20testing.");
    const turn = await adapterFor({
      provider,
      model,
      config: { baseUrl: text(formData, "baseUrl"), deployment: text(formData, "deployment"), apiVersion: text(formData, "apiVersion") },
      apiKey,
    }).complete({ system: "Reply with the single word ready.", messages: [{ role: "user", text: "ping" }], tools: [] });
    redirect(`/ask-qula?message=${encodeURIComponent(turn.text ? `The connection succeeded. ${turn.text}` : "The connection succeeded.")}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    const message = error instanceof Error ? error.message : "The provider could not be reached.";
    redirect(`/ask-qula?error=${encodeURIComponent(message)}`);
  }
}

export async function saveAccessPoint(formData: FormData): Promise<void> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  await writeAccessPoint(current.organisationId, current.tenantId, formData, null);
  revalidatePath("/access-point");
  redirect("/access-point?message=Saved.");
}

export async function testAccessPoint(formData: FormData) {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const forced = text(formData, "forceFailure") === "on";
  const result = forced
    ? { ok: false, message: "The mock Access Point refused the connection." }
    : await mockAccessPoint().testConnection();
  await writeAccessPoint(current.organisationId, current.tenantId, formData, result);
  redirect(`/access-point?${result.ok ? "message" : "error"}=${encodeURIComponent(result.message)}`);
}

export async function lookupParticipant(formData: FormData) {
  await requireCurrentOrganisation(["owner", "admin"]);
  const found = await mockAccessPoint().lookupParticipant(text(formData, "scheme"), text(formData, "participant"));
  redirect(`/access-point?message=${encodeURIComponent(found.registered ? "That participant can receive invoices." : "That participant was not found.")}`);
}

export async function registerParticipant(formData: FormData) {
  void formData;
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const supabase = await createClient();
  const settings = await supabase.from("access_point_settings").select("status, provider_code").eq("organisation_id", current.organisationId).maybeSingle();
  const row = settings.data as { status?: string; provider_code?: string } | null;
  if (row?.status !== "verified") redirect("/access-point?error=Test%20the%20connection%20before%20registering.");
  const defaults = await supabase.from("organisation_defaults").select("peppol_scheme, peppol_id").eq("organisation_id", current.organisationId).maybeSingle();
  const peppol = defaults.data as { peppol_scheme?: string; peppol_id?: string } | null;
  if (!peppol?.peppol_id) redirect("/access-point?error=Add%20a%20Peppol%20ID%20before%20registering.");
  await mockAccessPoint().registerParticipant(peppol.peppol_scheme ?? "", peppol.peppol_id);
  const { error } = await supabase.from("access_point_settings").update({
    participant_registered: true,
    participant_registered_at: new Date().toISOString(),
  }).eq("organisation_id", current.organisationId);
  if (error) redirect(`/access-point?error=${encodeURIComponent(error.message)}`);
  redirect("/access-point?message=The%20Peppol%20ID%20is%20registered.");
}

async function writeAccessPoint(organisationId: string, tenantId: string, formData: FormData, test: { ok: boolean; message: string } | null) {
  const environment = text(formData, "environment") || "sandbox";
  const supabase = await createClient();
  if (environment === "production") {
    const defaults = await supabase.from("organisation_defaults").select("peppol_id").eq("organisation_id", organisationId).maybeSingle();
    if (!(defaults.data as { peppol_id?: string } | null)?.peppol_id) {
      redirect("/access-point?error=Add%20a%20Peppol%20ID%20before%20using%20production.");
    }
  }
  const existing = await supabase.from("access_point_settings").select("participant_registered, provider_code, webhook_token").eq("organisation_id", organisationId).maybeSingle();
  const row = existing.data as { participant_registered?: boolean; provider_code?: string; webhook_token?: string } | null;
  const provider = text(formData, "provider") || "mock";
  if (row?.participant_registered && row.provider_code && row.provider_code !== provider) {
    redirect("/access-point?error=Deregister%20the%20Peppol%20ID%20with%20the%20current%20provider%20before%20switching.");
  }
  const apiKey = text(formData, "apiKey");
  if (apiKey) {
    const saved = await setSecret(organisationId, "ap_api_key", apiKey);
    if (saved.error) redirect(`/access-point?error=${encodeURIComponent(saved.error)}`);
  }
  const webhookSecret = text(formData, "webhookSecret");
  if (webhookSecret) {
    const saved = await setSecret(organisationId, "ap_webhook_secret", webhookSecret);
    if (saved.error) redirect(`/access-point?error=${encodeURIComponent(saved.error)}`);
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
  if (error) redirect(`/access-point?error=${encodeURIComponent(error.message)}`);
}
