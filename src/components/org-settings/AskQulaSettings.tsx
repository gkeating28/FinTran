import { clearSecret, saveAiSettings, testAiConnection } from "@/lib/settings-actions";
import { createClient } from "@/lib/supabase/server";
import AskQulaLogFields from "@/components/AskQulaLogFields";
import { QuietInput } from "@/components/QuietField";
import tab from "@/components/org-settings/SettingsTab.module.css";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { slot } from "@/components/recordForm";

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

/** The Ask Qula settings, usage, feedback and actions of an organisation. It is the Ask Qula tab of the organisation edit. */
export default async function AskQulaSettings({
  organisationId,
  status,
  failed,
}: {
  organisationId: string;
  status: string | null;
  failed: boolean;
}) {
  const supabase = await createClient();
  const [settings, secrets, usage, feedback, actions] = await Promise.all([
    supabase.from("ai_settings").select("enabled, provider_code, model, config, user_hourly_limit, organisation_monthly_limit, data_notice_accepted_at, log_answers, actions_enabled, answer_retention_days").eq("organisation_id", organisationId).maybeSingle(),
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
    answer_retention_days?: number;
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
  const statusText = status ?? (row.enabled ? "Ask Qula is enabled for this organisation." : "Ask Qula answers the fixed questions until you enable a provider.");

  return (
    <AskQulaView
      organisationId={organisationId}
      row={row}
      hint={hint ?? null}
      statusText={statusText}
      failed={failed}
      usage={[...byUser.entries()].map(([user, totals]) => ({ user, ...totals }))}
      ratings={{ up: thumbsUp, down: thumbsDown, total: ratings.length, low: lowRated.map((item) => ({ at: item.at, when: when(item.at), comment: item.comment ?? "", question: item.question ?? "", answer: item.answer ?? "" })) }}
      actions={done.map((item) => ({
        at: item.at,
        when: when(item.at),
        person: item.user_id ? (names.get(item.user_id) ?? "Unknown") : "System",
        summary: item.summary,
        result: `${ACTION_STATUS[item.status] ?? item.status}${item.status === "failed" && item.detail ? `: ${item.detail}` : ""}`,
      }))}
    />
  );
}

export type AskQulaRow = {
  enabled?: boolean;
  provider_code?: string;
  model?: string;
  config?: { baseUrl?: string; deployment?: string; apiVersion?: string };
  user_hourly_limit?: number;
  organisation_monthly_limit?: number | null;
  data_notice_accepted_at?: string | null;
  log_answers?: boolean;
  actions_enabled?: boolean;
  answer_retention_days?: number;
};

export function AskQulaView({
  organisationId,
  row,
  hint,
  statusText,
  failed,
  usage,
  ratings,
  actions,
}: {
  organisationId: string;
  row: AskQulaRow;
  hint: string | null;
  statusText: string;
  failed: boolean;
  usage: { user: string; questions: number; tokens: number; errors: number }[];
  ratings: { up: number; down: number; total: number; low: { at: string; when: string; comment: string; question: string; answer: string }[] };
  actions: { at: string; when: string; person: string; summary: string; result: string }[];
}) {
  const providerName = PROVIDERS.find((provider) => provider.code === row.provider_code)?.name ?? "Anthropic";
  return (
    <div className={tab.tab}>
      <div className={styles.statusRow}>
        <p className={failed ? styles.alert : styles.notice} role={failed ? "alert" : "status"} title={statusText}>
          {statusText}
        </p>
      </div>
      <form id="ask-qula-settings" className={`${recordStyles.layout} ${tab.section}`} action={saveAiSettings} autoComplete="off">
        <input type="hidden" name="organisation_id" value={organisationId} />
        <p className={`${recordStyles.sectionHeading} ${slot("left", 1)}`}>Provider</p>
        <p className={`${recordStyles.sectionHeading} ${slot("right", 1)}`}>Limits and privacy</p>
        <div className={`${recordStyles.pair} ${slot("left", 2)}`}>
          <label className={recordStyles.cell}>
            Provider
            <select name="provider" defaultValue={row.provider_code ?? "anthropic"}>
              {PROVIDERS.map((provider) => (
                <option key={provider.code} value={provider.code}>{provider.name}</option>
              ))}
            </select>
          </label>
          <label className={recordStyles.cell}>
            Model
            <QuietInput name="model" defaultValue={row.model ?? "claude-haiku-5-5"} maxLength={100} />
          </label>
        </div>
        <div className={`${recordStyles.row} ${slot("left", 3)}`}>
          <label className={recordStyles.grow}>
            Base URL
            <QuietInput name="baseUrl" defaultValue={row.config?.baseUrl ?? ""} />
          </label>
        </div>
        <div className={`${recordStyles.row} ${slot("left", 4)}`}>
          <label className={recordStyles.grow}>
            API key
            <QuietInput name="apiKey" type="password" />
            <small className={tab.help}>{hint ? `Set, ending ${hint}. Leave it blank to keep it.` : "Write-only. It is kept encrypted and never shown again."}</small>
          </label>
        </div>
        <div className={`${recordStyles.pair} ${slot("left", 5)}`}>
          <label className={recordStyles.cell}>
            Azure deployment
            <QuietInput name="deployment" defaultValue={row.config?.deployment ?? ""} />
          </label>
          <label className={recordStyles.cell}>
            API version
            <QuietInput name="apiVersion" defaultValue={row.config?.apiVersion ?? ""} />
          </label>
        </div>
        <div className={`${recordStyles.pair} ${slot("right", 2)}`}>
          <label className={recordStyles.cell}>
            Hourly limit
            <QuietInput name="hourly" defaultValue={String(row.user_hourly_limit ?? 30)} inputMode="numeric" />
            <small className={tab.help}>Questions each person can ask in an hour.</small>
          </label>
          <label className={recordStyles.cell}>
            Monthly limit
            <QuietInput name="monthly" defaultValue={row.organisation_monthly_limit ? String(row.organisation_monthly_limit) : ""} inputMode="numeric" />
            <small className={tab.help}>Questions for the organisation in a month. Blank is no limit.</small>
          </label>
        </div>
        <div className={`${tab.column} ${slot("right", 3)}`} style={{ gridRow: "3 / span 3" }}>
          <label className={tab.tick}>
            <input type="checkbox" name="notice" defaultChecked={Boolean(row.data_notice_accepted_at)} />
            Questions, and the organisation&apos;s data needed to answer them, will be sent to {providerName}. Check this meets your data protection obligations.
          </label>
          <AskQulaLogFields logAnswers={Boolean(row.log_answers)} retentionDays={row.answer_retention_days ?? 30} />
          <label className={tab.tick}>
            <input type="checkbox" name="enabled" defaultChecked={row.enabled} />
            Enable
          </label>
          <label className={tab.tick}>
            <input type="checkbox" name="actionsEnabled" defaultChecked={Boolean(row.actions_enabled)} />
            Allow actions
            <small>Ask Qula may propose posting drafts and adding customers or suppliers. Nothing happens until a person confirms. Off by default, and only available while Ask Qula is enabled.</small>
          </label>
        </div>
        <div className={tab.footer}>
          {hint ? (
            <button className={`${styles.quiet} ${tab.footerStart}`} type="submit" form="clear-ai-key">
              Remove key
            </button>
          ) : null}
          <button className={styles.quiet} type="submit" formAction={testAiConnection}>
            Test connection
          </button>
          <button className={styles.primary} type="submit">
            Save
          </button>
        </div>
      </form>
      {hint ? (
        <form id="clear-ai-key" action={clearSecret}>
          <input type="hidden" name="kind" value="ai_api_key" />
          <input type="hidden" name="organisation_id" value={organisationId} />
          <input type="hidden" name="tab" value="ask-qula" />
        </form>
      ) : null}
      <div className={tab.table}>
        <p className={tab.tableHead}>
          This month
          <span>{usage.length === 0 ? "No questions yet" : `${usage.length} ${usage.length === 1 ? "person" : "people"}`}</span>
        </p>
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
            {usage.length === 0 ? (
              <tr>
                <td colSpan={4}>No questions yet.</td>
              </tr>
            ) : usage.map((item) => (
              <tr key={item.user}>
                <td>{item.user}</td>
                <td className={styles.num}>{item.questions}</td>
                <td className={styles.num}>{item.tokens}</td>
                <td className={styles.num}>{item.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={tab.table}>
        <p className={tab.tableHead}>
          Feedback
          <span>{ratings.total === 0 ? "No ratings yet" : `${ratings.up} helpful, ${ratings.down} not helpful (latest ${ratings.total})`}</span>
        </p>
        {ratings.low.length === 0 ? (
          <p className={tab.help}>Answers rated not helpful will show here. {row.log_answers ? `The question and answer are kept with each rating for ${row.answer_retention_days ?? 30} days, then deleted. The rating is kept.` : "Only the rating and any comment are kept, because keeping the question and answer is switched off above."}</p>
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
              {ratings.low.map((item) => (
                <tr key={item.at}>
                  <td>{item.when}</td>
                  <td>{item.comment}</td>
                  <td>{item.question}</td>
                  <td>{item.answer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className={tab.table}>
        <p className={tab.tableHead}>
          Actions Ask Qula proposed
          <span>{actions.length === 0 ? "None yet" : `Latest ${actions.length}`}</span>
        </p>
        {actions.length === 0 ? (
          <p className={tab.help}>When someone confirms an action Ask Qula proposed, such as posting a draft, it is recorded here.</p>
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
              {actions.map((item) => (
                <tr key={`${item.at}-${item.summary}`}>
                  <td>{item.when}</td>
                  <td>{item.person}</td>
                  <td>{item.summary}</td>
                  <td>{item.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
