import { redirect } from "next/navigation";
import { saveAiSettings } from "@/lib/settings-actions";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import styles from "@/components/OpsPage.module.css";

export const metadata = { title: "Ask Qula" };

export default async function AskQulaSettingsPage() {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") redirect("/");
  if (!canManage(workspace.current.role)) redirect("/admin");
  const supabase = await createClient();
  const settings = await supabase.from("ai_settings").select("enabled, provider_code, model, user_hourly_limit, organisation_monthly_limit").eq("organisation_id", workspace.current.organisationId).maybeSingle();
  const row = (settings.data ?? {}) as { enabled?: boolean; provider_code?: string; model?: string; user_hourly_limit?: number; organisation_monthly_limit?: number | null };
  const usage = await supabase.from("ai_usage").select("outcome").eq("organisation_id", workspace.current.organisationId);
  const questions = usage.data?.length ?? 0;

  return (
    <section className={styles.stack}>
      <h1 className={styles.heading}>Ask Qula</h1>
      <p className={styles.lede}>Questions, and the organisation data needed to answer them, are sent to the provider you choose.</p>
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
          <input name="baseUrl" placeholder="https://" />
        </label>
        <label className={styles.field}>Azure deployment
          <input name="deployment" />
        </label>
        <label className={styles.field}>API version
          <input name="apiVersion" />
        </label>
        <label className={styles.field}>API key
          <input name="apiKey" type="password" autoComplete="off" placeholder="Write-only. A saved key is not shown again." />
        </label>
        <label className={styles.field}>Hourly limit
          <input name="hourly" defaultValue={String(row.user_hourly_limit ?? 30)} />
        </label>
        <label className={styles.field}>Monthly limit
          <input name="monthly" defaultValue={row.organisation_monthly_limit ? String(row.organisation_monthly_limit) : ""} />
        </label>
        <label className={styles.checkLine}>
          <input type="checkbox" name="notice" />
          Questions, and the organisation&apos;s data needed to answer them, will be sent to the provider. Check this meets your data protection obligations.
        </label>
        <label className={styles.checkLine}>
          <input type="checkbox" name="enabled" defaultChecked={row.enabled} />
          Enable
        </label>
        <p className={styles.panelMeta}>This month: {questions} questions.</p>
        <button className={styles.primary} type="submit">Save</button>
      </form>
    </section>
  );
}
