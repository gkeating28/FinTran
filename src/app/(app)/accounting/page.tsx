import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { saveAccountingSettings } from "@/lib/journal-actions";
import { getAccountingSettings } from "@/lib/journal-data";
import { ACCOUNTING_ACCOUNTS } from "@/lib/journal";
import { canManage } from "@/lib/types";

export const metadata = { title: "Accounting" };

export default async function AccountingPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  // These settings are for owners and admins. A member is sent back to Admin.
  if (!canManage(workspace.current.role)) redirect("/admin");

  const [{ settings, glCodes, banksWithoutGl, error }, params] = await Promise.all([getAccountingSettings(), searchParams]);
  const status = params.error ?? error ?? params.message ?? null;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Accounting</h1>
        <p className={styles.lede}>
          The accounts {workspace.current.organisationName} uses when it sends its postings to an accounting system. The <Link href="/journal-export">Journal export</Link> screen makes the file.
        </p>
      </div>
      {status ? (
        <p className={params.error || error ? styles.alert : styles.notice} role={params.error || error ? "alert" : "status"}>
          {status}
        </p>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>Accounts</div>
        <form className={styles.partyFields} action={saveAccountingSettings} autoComplete="off">
          {ACCOUNTING_ACCOUNTS.map((account) => (
            <label key={account.key} className={styles.field}>
              {account.label}
              <select name={account.column} defaultValue={settings[account.key]}>
                <option value="">Not set</option>
                {glCodes.map((code) => (
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
      <div className={styles.panel}>
        <div className={styles.panelHead}>Bank accounts without a GL code</div>
        {banksWithoutGl.length === 0 ? (
          <p className={styles.notice} role="status">
            Every active bank account has a GL code.
          </p>
        ) : (
          <ul>
            {banksWithoutGl.map((bank) => (
              <li key={bank.id}>
                <Link href="/bank-accounts">
                  {bank.code} {bank.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
