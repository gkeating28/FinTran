import styles from "@/components/OpsPage.module.css";
import { saveAccountingSettings } from "@/lib/journal-actions";
import { getAccountingSettings } from "@/lib/journal-data";
import { ACCOUNTING_ACCOUNTS } from "@/lib/journal";

/** The accounts the ledger and the journal export use, each a system role on a GL code. It is the Accounting tab of the organisation edit. */
export default async function AccountingSettings({
  organisationId,
  organisationName,
  status,
  failed,
}: {
  organisationId: string;
  organisationName: string;
  status: string | null;
  failed: boolean;
}) {
  const { settings, glCodes, error } = await getAccountingSettings(organisationId);
  const message = failed ? status : (error ?? status);
  const bad = failed || Boolean(error);

  return (
    <div className={styles.stack}>
      <p className={styles.lede}>The accounts {organisationName} posts to and exports to.</p>
      {message ? (
        <p className={bad ? styles.alert : styles.notice} role={bad ? "alert" : "status"}>
          {message}
        </p>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>Accounts</div>
        <form className={styles.partyFields} action={saveAccountingSettings} autoComplete="off">
          <input type="hidden" name="organisation_id" value={organisationId} />
          {ACCOUNTING_ACCOUNTS.map((account) => (
            <label key={account.key} className={styles.field}>
              {account.label}
              <select name={account.column} defaultValue={settings[account.key]}>
                {glCodes
                  .filter((code) => code.accountType === account.accountType && (code.systemRole === null || code.systemRole === account.role))
                  .map((code) => (
                    <option key={code.id} value={code.id}>
                      {code.code} {code.description}
                    </option>
                  ))}
              </select>
              <small>{account.help}</small>
            </label>
          ))}
          <label className={styles.field}>
            Start date
            <input type="date" name="start_date" defaultValue={settings.startDate} />
            <small>Nothing dated before this is exported. Leave it blank to export all history.</small>
          </label>
          <div className={`${styles.modalActions} ${styles.wide}`}>
            <span className={styles.actionStart} />
            <button className={styles.primary} type="submit">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
