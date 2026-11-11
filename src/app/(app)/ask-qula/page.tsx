import { redirect } from "next/navigation";
import { clearSecret, saveAiSettings, testAiConnection } from "@/lib/settings-actions";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import styles from "@/components/OpsPage.module.css";

export const metadata = { title: "Ask Qula" };

const PROVIDERS = [
  { code: "anthropic", name: "Anthropic" },
  { code: "openai", name: "OpenAI" },
  { code: "azure_openai", name: "Azure OpenAI" },
  { code: "openai_compatible", name: "OpenAI-compatible endpoint" },
] as const;

const ACTION_STATUS: Record<string, string> = {
  proposed: "Waiting for confirmation",
  confirmed: "Done",
  failed: "Failed",
  expired: "Expired, not confirmed",
  superseded: "Replaced by a newer proposal",
};

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
  const [settings, secrets, usage, feedback, actions] = await Promise.all([
    supabase.from("ai_settings").select("enabled, provider_code, model, config, user_hourly_limit, organisation_monthly_limit, data_notice_accepted_at, log_answers, actions_enabled").eq("organisation_id", organisationId).maybeSingle(),
    supabase.rpc("organisation_secret_status", { p_organisation_id: organisationId }),
    supabase.from("ai_usage").select("user_id, outcome, input_tokens, output_tokens").eq("organisation_id", organisationId),
    supabase.from("ai_feedback").select("rating, at, comment, question, answer").eq("organisation_id", organisationId).order("at", { ascending: false }).limit(200),
    supabase.from("ai_actions").select("at, action, summary, status, detail, user_id").eq("organisation_id", organisationId).order("at", { ascending: false }).limit(20),
  ]);
  const row = (settings.data ?? {}) as {
    enabled?: boolean;
    provider_code?: string;
    model?: string;
    config?: { baseUrl?: string; deployment?: string; apiVersion?: string };
    user_hourly_limit?: number;
    organisation_monthly_limit?: number | null;
    data_notice_accepted_at?: string | null;
    log_answers?: boolean;
    actions_enabled?: boolean;
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
  const ratings = (feedback.data ?? []) as { rating: number; at: string; comment: string | null; question: string | null; answer: string | null }[];
  const thumbsUp = ratings.filter((item) => item.rating === 1).length;
  const thumbsDown = ratings.length - thumbsUp;
  const lowRated = ratings.filter((item) => item.rating === -1).slice(0, 8);
  const done = (actions.data ?? []) as { at: string; action: string; summary: string; status: string; detail: string | null; user_id: string | null }[];
  const actionUsers = [...new Set(done.map((item) => item.user_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actionUsers.length > 0) {
    const profiles = await supabase.from("profiles").select("id, display_name, email").in("id", actionUsers);
    for (const profile of (profiles.data ?? []) as { id: string; display_name: string | null; email: string }[]) names.set(profile.id, profile.display_name || profile.email);
  }
  const when = (value: string) => new Date(value).toLocaleString("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
  const providerName = PROVIDERS.find((provider) => provider.code === row.provider_code)?.name ?? "Anthropic";
  const status = params.error ?? params.message ?? (row.enabled ? "Ask Qula is enabled for this organisation." : "Ask Qula answers the fixed questions until you enable a provider.");

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Ask Qula</h1>
        <p className={styles.lede}>
          Questions, and the organisation&apos;s data needed to answer them, will be sent to {providerName}. Check this meets your data protection obligations.
        </p>
      </div>
      <div className={styles.statusRow}>
        <p className={params.error ? styles.alert : styles.notice} role={params.error ? "alert" : "status"}>
          {status}
        </p>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>Provider</div>
        <form id="ask-qula-settings" className={styles.partyFields} action={saveAiSettings} autoComplete="off">
          <label className={styles.field}>
            Provider
            <select name="provider" defaultValue={row.provider_code ?? "anthropic"}>
              {PROVIDERS.map((provider) => (
                <option key={provider.code} value={provider.code}>{provider.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Model
            <input name="model" defaultValue={row.model ?? "claude-haiku-5-5"} maxLength={100} />
          </label>
          <label className={styles.field}>
            Base URL
            <input name="baseUrl" defaultValue={row.config?.baseUrl ?? ""} placeholder="https://" />
          </label>
          <label className={styles.field}>
            API key
            <input name="apiKey" type="password" autoComplete="off" placeholder={hint ? `Set, ending ${hint}` : "Write-only"} />
          </label>
          <label className={styles.field}>
            Azure deployment
            <input name="deployment" defaultValue={row.config?.deployment ?? ""} />
          </label>
          <label className={styles.field}>
            API version
            <input name="apiVersion" defaultValue={row.config?.apiVersion ?? ""} />
          </label>
          <label className={styles.field}>
            Hourly limit
            <input name="hourly" defaultValue={String(row.user_hourly_limit ?? 30)} inputMode="numeric" />
          </label>
          <label className={styles.field}>
            Monthly limit
            <input name="monthly" defaultValue={row.organisation_monthly_limit ? String(row.organisation_monthly_limit) : ""} inputMode="numeric" placeholder="No limit" />
          </label>
          <label className={`${styles.checkLine} ${styles.wide}`}>
            <input type="checkbox" name="notice" defaultChecked={Boolean(row.data_notice_accepted_at)} />
            Questions, and the organisation&apos;s data needed to answer them, will be sent to {providerName}. Check this meets your data protection obligations.
          </label>
          <label className={`${styles.checkLine} ${styles.wide}`}>
            <input type="checkbox" name="logAnswers" defaultChecked={Boolean(row.log_answers)} />
            When someone rates an answer, keep the question and the answer with the rating so you can review it. Off by default. With it off only the thumb and any comment are kept.
          </label>
          <label className={`${styles.checkLine} ${styles.wide}`}>
            <input type="checkbox" name="enabled" defaultChecked={row.enabled} />
            Enable
          </label>
          <label className={`${styles.checkLine} ${styles.wide}`}>
            <input type="checkbox" name="actionsEnabled" defaultChecked={Boolean(row.actions_enabled)} />
            Allow actions. Ask Qula may propose posting drafts and adding customers or suppliers. Nothing happens until a person confirms. Off by default, and only available while Ask Qula is enabled.
          </label>
          <div className={`${styles.modalActions} ${styles.wide}`}>
            {hint ? <button className={`${styles.quiet} ${styles.actionStart}`} type="submit" form="clear-ai-key">Remove key</button> : <span className={styles.actionStart} />}
            <button className={styles.quiet} type="submit" formAction={testAiConnection}>Test connection</button>
            <button className={styles.primary} type="submit">Save</button>
          </div>
        </form>
      </div>
      {hint ? (
        <form id="clear-ai-key" action={clearSecret}>
          <input type="hidden" name="kind" value="ai_api_key" />
          <input type="hidden" name="return" value="/ask-qula" />
        </form>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          This month
          <span className={styles.panelMeta}>{byUser.size === 0 ? "No questions yet" : `${byUser.size} ${byUser.size === 1 ? "person" : "people"}`}</span>
        </div>
        <table className={styles.lineTable}>
          <thead>
            <tr>
              <th>Person</th>
              <th className={styles.num}>Questions</th>
              <th className={styles.num}>Tokens</th>
              <th className={styles.num}>Errors</th>
            </tr>
          </thead>
          <tbody>
            {byUser.size === 0 ? (
              <tr>
                <td colSpan={4}>No questions yet.</td>
              </tr>
            ) : [...byUser.entries()].map(([user, totals]) => (
              <tr key={user}>
                <td>{user}</td>
                <td className={styles.num}>{totals.questions}</td>
                <td className={styles.num}>{totals.tokens}</td>
                <td className={styles.num}>{totals.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          Feedback
          <span className={styles.panelMeta}>{ratings.length === 0 ? "No ratings yet" : `${thumbsUp} helpful, ${thumbsDown} not helpful (latest ${ratings.length})`}</span>
        </div>
        {lowRated.length === 0 ? (
          <p className={styles.empty}>Answers rated not helpful will show here. {row.log_answers ? "The question and answer are kept with each rating." : "Only the rating and any comment are kept, because keeping the question and answer is switched off above."}</p>
        ) : (
          <table className={styles.lineTable}>
            <thead>
              <tr>
                <th>When</th>
                <th>Comment</th>
                <th>Question</th>
                <th>Answer</th>
              </tr>
            </thead>
            <tbody>
              {lowRated.map((item) => (
                <tr key={item.at}>
                  <td>{when(item.at)}</td>
                  <td>{item.comment ?? ""}</td>
                  <td>{item.question ?? ""}</td>
                  <td>{item.answer ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          Actions Ask Qula proposed
          <span className={styles.panelMeta}>{done.length === 0 ? "None yet" : `Latest ${done.length}`}</span>
        </div>
        {done.length === 0 ? (
          <p className={styles.empty}>When someone confirms an action Ask Qula proposed, such as posting a draft, it is recorded here.</p>
        ) : (
          <table className={styles.lineTable}>
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>What</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {done.map((item) => (
                <tr key={`${item.at}-${item.summary}`}>
                  <td>{when(item.at)}</td>
                  <td>{item.user_id ? (names.get(item.user_id) ?? "Unknown") : "System"}</td>
                  <td>{item.summary}</td>
                  <td>{ACTION_STATUS[item.status] ?? item.status}{item.status === "failed" && item.detail ? `: ${item.detail}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
