import { redirect } from "next/navigation";
import { mockAccessPoint } from "@/lib/access-point/adapter";
import { lookupParticipant, registerParticipant, saveAccessPoint, testAccessPoint } from "@/lib/settings-actions";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import styles from "@/components/OpsPage.module.css";

export const metadata = { title: "Access Point" };

export default async function AccessPointPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") redirect("/");
  const params = await searchParams;
  const manage = canManage(workspace.current.role);
  const supabase = await createClient();
  const settings = await supabase.from("access_point_settings").select("provider_code, environment, status, participant_registered, config").eq("organisation_id", workspace.current.organisationId).maybeSingle();
  const row = (settings.data ?? {}) as { provider_code?: string; environment?: string; status?: string; participant_registered?: boolean; config?: { accountId?: string; baseUrl?: string } };
  const fields = mockAccessPoint().fields();

  return (
    <section className={styles.stack}>
      <h1 className={styles.heading}>Access Point</h1>
      <p className={styles.lede}>Status: {row.status ?? "Not configured"}{row.participant_registered ? " · Peppol ID registered" : ""}</p>
      {params.error ? <p className={styles.alert} role="alert">{params.error}</p> : null}
      {params.message ? <p className={styles.panelMeta}>{params.message}</p> : null}
      {manage ? (
        <form className={styles.partyFields} action={saveAccessPoint}>
          <label className={styles.field}>Provider
            <select name="provider" defaultValue={row.provider_code ?? "mock"}><option value="mock">Mock</option></select>
          </label>
          <label className={styles.field}>Environment
            <select name="environment" defaultValue={row.environment ?? "sandbox"}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </label>
          {fields.filter((field) => !field.secret).map((field) => (
            <label key={field.name} className={styles.field}>{field.label}
              <input name={field.name} defaultValue={field.name === "accountId" ? row.config?.accountId ?? "" : row.config?.baseUrl ?? ""} />
            </label>
          ))}
          <label className={styles.field}>API key
            <input name="apiKey" type="password" autoComplete="off" placeholder="Write-only" />
          </label>
          <label className={styles.field}>Webhook secret
            <input name="webhookSecret" type="password" autoComplete="off" placeholder="Write-only" />
          </label>
          <label className={styles.checkLine}><input type="checkbox" name="forceFailure" /> Force a failed test</label>
          <div className={styles.modalActions}>
            <button className={styles.quiet} type="submit" formAction={testAccessPoint}>Test connection</button>
            <button className={styles.primary} type="submit">Save</button>
          </div>
          <label className={styles.field}>Scheme
            <input name="scheme" defaultValue="9935" />
          </label>
          <label className={styles.field}>Participant
            <input name="participant" />
          </label>
          <div className={styles.modalActions}>
            <button className={styles.quiet} type="submit" formAction={lookupParticipant}>Look up participant</button>
            <button className={styles.primary} type="submit" formAction={registerParticipant} disabled={row.status !== "verified"}>Register Peppol ID</button>
          </div>
        </form>
      ) : (
        <p className={styles.panelMeta}>Owners and admins configure the Access Point. Members can see this status.</p>
      )}
    </section>
  );
}
