import { redirect } from "next/navigation";
import { clearSecret, saveAiSettings, testAiConnection } from "@/lib/settings-actions";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import styles from "@/components/OpsPage.module.css";

export const metadata = { title: "Ask Qula" };

export default async function AskQulaSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") redirect("/");
  if (!canManage(workspace.current.role)) redirect("/admin");
  const params = await searchParams;
  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [settings, secrets, usage] = await Promise.all([
    supabase.from("ai_settings").select("enabled, provider_code, model, config, user_hourly_limit, organisation_monthly_limit, data_notice_accepted_at").eq("organisation_id", organisationId).maybeSingle(),
    supabase.rpc("organisation_secret_status", { p_organisation_id: organisationId }),
    supabase.from("ai_usage").select("user_id, outcome, input_tokens, output_tokens").eq("organisation_id", organisationId),
  ]);
  const row = (settings.data ?? {}) as {
    enabled?: boolean;
    provider_code?: string;
    model?: string;
    config?: { baseUrl?: string; deployment?: string; apiVersion?: string };
    user_hourly_limit?: number;
    organisation_monthly_limit?: number | null;
    data_notice_accepted_at?: string | null;
  };
  const hint = ((secrets.data ?? []) as { kind: string; hint: string | null }[]).find((secret) => secret.kind === "ai_api_key")?.hint;
  const byUser = new Map<string, { questions: number; tokens: number; errors: number }>();
  for (const item of (usage.data ?? []) as { user_id: string | null; outcome: string; input_tokens: number; output_tokens: number }[]) {
    const key = item.user_id ?? "unknown";
    const current = byUser.get(key) ?? { questions: 0, tokens: 0, errors: 0 };
    current.questions += 1;
    current.tokens += Number(item.input_tokens ?? 0) + Number(item.output_tokens ?? 0);
    if (item.outcome === "error" || item.outcome === "fallback") current.errors += 1;
    byUser.set(key, current);
  }
  const providerName = row.provider_code === "openai" ? "OpenAI" : row.provider_code === "azure_openai" ? "Azure OpenAI" : row.provider_code === "openai_compatible" ? "the OpenAI-compatible endpoint" : "Anthropic";

  return (
    <section className={styles.stack}>
      <h1 className={styles.heading}>Ask Qula</h1>
      <p className={styles.lede}>Questions, and the organisation&apos;s data needed to answer them, will be sent to {providerName}. Check this meets your data protection obligations.</p>
      {params.error ? <p className={styles.alert} role="alert">{params.error}</p> : null}
      {params.message ? <p className={styles.panelMeta}>{params.message}</p> : null}
      <form className={styles.partyFields} action={saveAiSettings}>
        <label className={styles.field}>Provider
          <select name="provider" defaultValue={row.provider_code ?? "anthropic"}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="azure_openai">Azure OpenAI</option>
            <option value="openai_compatible">OpenAI-compatible endpoint</option>
          </select>
        </label>
        <label className={styles.field}>Model
          <input name="model" defaultValue={row.model ?? "claude-haiku-5-5"} maxLength={100} />
        </label>
        <label className={styles.field}>Base URL
          <input name="baseUrl" defaultValue={row.config?.baseUrl ?? ""} placeholder="https://" />
        </label>
        <label className={styles.field}>Azure deployment
          <input name="deployment" defaultValue={row.config?.deployment ?? ""} />
        </label>
        <label className={styles.field}>API version
          <input name="apiVersion" defaultValue={row.config?.apiVersion ?? ""} />
        </label>
        <label className={styles.field}>API key
          <input name="apiKey" type="password" autoComplete="off" placeholder={hint ? `Set, ending ${hint}` : "Write-only"} />
        </label>
        <label className={styles.field}>Hourly limit
          <input name="hourly" defaultValue={String(row.user_hourly_limit ?? 30)} />
        </label>
        <label className={styles.field}>Monthly limit
          <input name="monthly" defaultValue={row.organisation_monthly_limit ? String(row.organisation_monthly_limit) : ""} />
        </label>
        <label className={styles.checkLine}>
          <input type="checkbox" name="notice" defaultChecked={Boolean(row.data_notice_accepted_at)} />
          Questions, and the organisation&apos;s data needed to answer them, will be sent to {providerName}. Check this meets your data protection obligations.
        </label>
        <label className={styles.checkLine}>
          <input type="checkbox" name="enabled" defaultChecked={row.enabled} />
          Enable
        </label>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="submit" formAction={testAiConnection}>Test connection</button>
          <button className={styles.primary} type="submit">Save</button>
        </div>
      </form>
      {hint ? (
        <form action={clearSecret}>
          <input type="hidden" name="kind" value="ai_api_key" />
          <input type="hidden" name="return" value="/ask-qula" />
          <button className={styles.quiet} type="submit">Remove key</button>
        </form>
      ) : null}
      <h2 className={styles.heading}>This month</h2>
      {byUser.size === 0 ? <p className={styles.panelMeta}>No questions yet.</p> : (
        <ul>
          {[...byUser.entries()].map(([user, totals]) => (
            <li key={user}>{totals.questions} questions, {totals.tokens} tokens, {totals.errors} errors</li>
          ))}
        </ul>
      )}
    </section>
  );
}
