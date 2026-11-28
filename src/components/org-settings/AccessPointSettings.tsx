import { QuietInput } from "@/components/QuietField";
import tab from "@/components/org-settings/SettingsTab.module.css";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { exact, slot } from "@/components/recordForm";
import { mockAccessPoint } from "@/lib/access-point/adapter";
import { lookupParticipant, registerParticipant, saveAccessPoint, testAccessPoint } from "@/lib/settings-actions";
import { createClient } from "@/lib/supabase/server";

type Row = { provider_code?: string; environment?: string; status?: string; participant_registered?: boolean; config?: { accountId?: string; baseUrl?: string } };

/** The Peppol connection of an organisation. It is the Access Point tab of the organisation edit. */
export default async function AccessPointSettings({
  organisationId,
  status,
  failed,
}: {
  organisationId: string;
  organisationName?: string;
  status: string | null;
  failed: boolean;
}) {
  const supabase = await createClient();
  const settings = await supabase.from("access_point_settings").select("provider_code, environment, status, participant_registered, config").eq("organisation_id", organisationId).maybeSingle();
  return <AccessPointView organisationId={organisationId} row={(settings.data ?? {}) as Row} status={status} failed={failed} />;
}

export function AccessPointView({ organisationId, row, status, failed }: { organisationId: string; row: Row; status: string | null; failed: boolean }) {
  const accountField = mockAccessPoint().fields().find((field) => field.name === "accountId");
  const statusText = status
    ?? `${row.status === "verified" ? "Verified" : row.status === "suspended" ? "Suspended" : row.status === "configured" ? "Configured" : "Not configured"}${row.participant_registered ? " · Peppol ID registered" : ""}`;

  return (
    <div className={tab.tab}>
      <div className={styles.statusRow}>
        <p className={failed ? styles.alert : styles.notice} role={failed ? "alert" : "status"} title={statusText}>
          {statusText}
        </p>
      </div>
      <form className={`${recordStyles.layout} ${tab.section}`} action={saveAccessPoint} autoComplete="off">
        <input type="hidden" name="organisation_id" value={organisationId} />
        <p className={`${recordStyles.sectionHeading} ${slot("left", 1)}`}>Connection</p>
        <p className={`${recordStyles.sectionHeading} ${slot("right", 1)}`}>Credentials</p>
        <div className={`${recordStyles.pair} ${slot("left", 2)}`}>
          <label className={recordStyles.cell}>
            Provider
            <select name="provider" defaultValue={row.provider_code ?? "mock"}>
              <option value="mock">Mock</option>
            </select>
          </label>
          <label className={recordStyles.cell}>
            Environment
            <select name="environment" defaultValue={row.environment ?? "sandbox"}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </label>
        </div>
        <div className={`${recordStyles.row} ${slot("left", 3)}`}>
          <label className={recordStyles.grow}>
            {accountField?.label ?? "Account ID"}
            <QuietInput name="accountId" defaultValue={row.config?.accountId ?? ""} />
          </label>
        </div>
        <div className={`${recordStyles.row} ${slot("left", 4)}`}>
          <label className={recordStyles.grow}>
            Base URL
            <QuietInput name="baseUrl" defaultValue={row.config?.baseUrl ?? ""} />
          </label>
        </div>
        <div className={`${recordStyles.row} ${slot("right", 2)}`}>
          <label className={recordStyles.grow}>
            API key
            <QuietInput name="apiKey" type="password" />
            <small className={tab.help}>Write-only. Leave it blank to keep the key that is saved.</small>
          </label>
        </div>
        <div className={`${recordStyles.row} ${slot("right", 3)}`}>
          <label className={recordStyles.grow}>
            Webhook secret
            <QuietInput name="webhookSecret" type="password" />
            <small className={tab.help}>Write-only. Leave it blank to keep the secret that is saved.</small>
          </label>
        </div>
        <label className={`${tab.tick} ${slot("right", 4)}`}>
          <input type="checkbox" name="forceFailure" />
          Force a failed test
          <small>Makes Test connection fail, to see what a failed test shows.</small>
        </label>
        <div className={tab.footer}>
          <button className={styles.quiet} type="submit" formAction={testAccessPoint}>
            Test connection
          </button>
          <button className={styles.primary} type="submit">
            Save
          </button>
        </div>
      </form>
      <form className={`${recordStyles.layout} ${tab.section}`} action={lookupParticipant} autoComplete="off">
        <input type="hidden" name="organisation_id" value={organisationId} />
        <p className={`${recordStyles.sectionHeading} ${slot("left", 1)}`}>Participant</p>
        <p className={`${recordStyles.sectionHeading} ${slot("right", 1)}`}>{row.participant_registered ? "Registered" : "Not registered"}</p>
        <div className={`${recordStyles.row} ${slot("left", 2)}`}>
          <label className={recordStyles.fixed} style={exact("8ch")}>
            Scheme
            <QuietInput name="scheme" defaultValue="9935" className={styles.mono} />
          </label>
          <label className={recordStyles.grow}>
            Participant
            <QuietInput name="participant" className={styles.mono} />
          </label>
        </div>
        <p className={`${tab.help} ${slot("right", 2)}`}>Look a participant up on the Peppol network. Register Peppol ID needs a verified connection.</p>
        <div className={tab.footer}>
          <button className={styles.quiet} type="submit">
            Look up participant
          </button>
          <button className={styles.primary} type="submit" formAction={registerParticipant} disabled={row.status !== "verified"}>
            Register Peppol ID
          </button>
        </div>
      </form>
    </div>
  );
}
