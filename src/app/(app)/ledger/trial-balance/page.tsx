import Link from "next/link";
import { redirect } from "next/navigation";
import TrialBalanceExport from "@/components/TrialBalanceExport";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { formatMoney } from "@/lib/documents";
import { drCr, fromCents, groupTrialBalance, trialBalanceAgrees, yearToDate } from "@/lib/ledger";
import { getLedgerChoices, getReconciliation, getTrialBalance } from "@/lib/ledger-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Trial balance" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; dept?: string; cc?: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  if (!canManage(workspace.current.role)) redirect("/");

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const range = yearToDate(today);
  const from = DATE.test(params.from ?? "") ? (params.from as string) : range.from;
  const to = DATE.test(params.to ?? "") ? (params.to as string) : range.to;
  const departmentId = UUID.test(params.dept ?? "") ? (params.dept as string) : "";
  const costCentreId = UUID.test(params.cc ?? "") ? (params.cc as string) : "";

  const [trial, reconciliation, choices] = await Promise.all([getTrialBalance({ from, to, departmentId, costCentreId }), getReconciliation(), getLedgerChoices()]);
  const { sections, totals } = groupTrialBalance(trial.rows);
  const agrees = trialBalanceAgrees(totals);
  const clean = reconciliation.rows.length > 0 && reconciliation.rows.every((row) => row.difference === 0);
  const error = trial.error ?? reconciliation.error ?? choices.error;
  const filters = new URLSearchParams({ from, to, ...(departmentId ? { dept: departmentId } : {}), ...(costCentreId ? { cc: costCentreId } : {}) }).toString();

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Trial balance</h1>
        <p className={styles.lede}>
          {workspace.current.organisationName}, {from} to {to}. Balances are debits less credits.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>Reconciliation</div>
        {clean ? (
          <p className={styles.notice} role="status">
            ✓ The ledger agrees with debtors, creditors and every bank account.
          </p>
        ) : (
          <div className={styles.alert} role="alert">
            <strong>The ledger and the subledgers differ.</strong>
            <ul>
              {reconciliation.rows
                .filter((row) => row.difference !== 0)
                .map((row) => (
                  <li key={row.check}>
                    {row.check}: ledger {formatMoney(row.ledger)}, subledger {formatMoney(row.subledger)}, difference {formatMoney(row.difference)}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
      <form className={styles.partyFields} method="get" action="/ledger/trial-balance">
        <label className={styles.field}>
          From
          <input type="date" name="from" defaultValue={from} required />
        </label>
        <label className={styles.field}>
          To
          <input type="date" name="to" defaultValue={to} required />
        </label>
        <label className={styles.field}>
          Department
          <select name="dept" defaultValue={departmentId}>
            <option value="">All</option>
            {choices.departments.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} {entry.description}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Cost centre
          <select name="cc" defaultValue={costCentreId}>
            <option value="">All</option>
            {choices.costCentres.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} {entry.description}
              </option>
            ))}
          </select>
        </label>
        <div className={`${styles.modalActions} ${styles.wide}`}>
          <span className={styles.actionStart} />
          <Link className={styles.quiet} href="/ledger">
            Journals
          </Link>
          <TrialBalanceExport rows={trial.rows} from={from} to={to} />
          <button className={styles.primary} type="submit">
            Show
          </button>
        </div>
      </form>
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="Trial balance">
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th className={styles.numeric}>Opening</th>
              <th className={styles.numeric}>Debit</th>
              <th className={styles.numeric}>Credit</th>
              <th className={styles.numeric}>Closing</th>
            </tr>
          </thead>
          {sections.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={6}>Nothing has been posted up to {to}.</td>
              </tr>
            </tbody>
          ) : (
            sections.map((section) => (
              <tbody key={section.title}>
                <tr>
                  <th colSpan={6}>{section.title}</th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.glCodeId}>
                    <td className={styles.mono}>{row.code}</td>
                    <td>
                      <Link href={`/ledger/accounts/${row.glCodeId}?${filters}`}>{row.description}</Link>
                    </td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{drCr(Math.round(row.opening * 100))}</td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{formatMoney(row.debit)}</td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{formatMoney(row.credit)}</td>
                    <td className={`${styles.mono} ${styles.numeric}`}>{drCr(Math.round(row.closing * 100))}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={2}>
                    <strong>Total {section.title.toLowerCase()}</strong>
                  </td>
                  <td className={`${styles.mono} ${styles.numeric}`}>{drCr(section.opening)}</td>
                  <td className={`${styles.mono} ${styles.numeric}`}>{formatMoney(fromCents(section.debit))}</td>
                  <td className={`${styles.mono} ${styles.numeric}`}>{formatMoney(fromCents(section.credit))}</td>
                  <td className={`${styles.mono} ${styles.numeric}`}>{drCr(section.closing)}</td>
                </tr>
              </tbody>
            ))
          )}
          <tfoot>
            <tr>
              <td colSpan={2}>
                <strong>Total</strong> {agrees ? "(agrees)" : "(does not agree)"}
              </td>
              <td className={`${styles.mono} ${styles.numeric}`}>{drCr(totals.opening)}</td>
              <td className={`${styles.mono} ${styles.numeric}`} data-testid="tb-debit">
                {formatMoney(fromCents(totals.debit))}
              </td>
              <td className={`${styles.mono} ${styles.numeric}`} data-testid="tb-credit">
                {formatMoney(fromCents(totals.credit))}
              </td>
              <td className={`${styles.mono} ${styles.numeric}`}>{drCr(totals.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
