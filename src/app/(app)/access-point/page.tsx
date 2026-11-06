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
  const accountField = mockAccessPoint().fields().find((field) => field.name === "accountId");
  const statusText = params.error
    ?? params.message
    ?? `${row.status === "verified" ? "Verified" : row.status === "suspended" ? "Suspended" : row.status === "configured" ? "Configured" : "Not configured"}${row.participant_registered ? " · Peppol ID registered" : ""}`;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Access Point</h1>
        <p className={styles.lede}>
          {manage
            ? `Peppol connection for ${workspace.current.organisationName}.`
            : "Owners and admins configure the Access Point. You can see the current status."}
        </p>
      </div>
      <div className={styles.statusRow}>
        <p className={params.error ? styles.alert : styles.notice} role={params.error ? "alert" : "status"}>
          {statusText}
        </p>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>Connection</div>
        <form className={styles.partyFields} action={saveAccessPoint} autoComplete="off">
          <label className={styles.field}>
            Provider
            <select name="provider" defaultValue={row.provider_code ?? "mock"} disabled={!manage}>
              <option value="mock">Mock</option>
            </select>
          </label>
          <label className={styles.field}>
            Environment
            <select name="environment" defaultValue={row.environment ?? "sandbox"} disabled={!manage}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </label>
          <label className={styles.field}>
            {accountField?.label ?? "Account ID"}
            <input name="accountId" defaultValue={row.config?.accountId ?? ""} disabled={!manage} />
          </label>
          <label className={styles.field}>
            Base URL
            <input name="baseUrl" defaultValue={row.config?.baseUrl ?? ""} placeholder="https://" disabled={!manage} />
          </label>
          <label className={styles.field}>
            API key
            <input name="apiKey" type="password" autoComplete="off" placeholder="Write-only" disabled={!manage} />
          </label>
          <label className={styles.field}>
            Webhook secret
            <input name="webhookSecret" type="password" autoComplete="off" placeholder="Write-only" disabled={!manage} />
          </label>
          {manage ? (
            <label className={`${styles.checkLine} ${styles.wide}`}>
              <input type="checkbox" name="forceFailure" />
              Force a failed test
            </label>
          ) : null}
          {manage ? (
            <div className={`${styles.modalActions} ${styles.wide}`}>
              <span className={styles.actionStart} />
              <button className={styles.quiet} type="submit" formAction={testAccessPoint}>Test connection</button>
              <button className={styles.primary} type="submit">Save</button>
            </div>
          ) : null}
        </form>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          Participant
          <span className={styles.panelMeta}>{row.participant_registered ? "Registered" : "Not registered"}</span>
        </div>
        <form className={styles.partyFields} action={lookupParticipant} autoComplete="off">
          <label className={styles.field}>
            Scheme
            <input name="scheme" defaultValue="9935" disabled={!manage} />
          </label>
          <label className={styles.field}>
            Participant
            <input name="participant" disabled={!manage} />
          </label>
          {manage ? (
            <div className={`${styles.modalActions} ${styles.wide}`}>
              <span className={styles.actionStart} />
              <button className={styles.quiet} type="submit">Look up participant</button>
              <button className={styles.primary} type="submit" formAction={registerParticipant} disabled={row.status !== "verified"}>Register Peppol ID</button>
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
