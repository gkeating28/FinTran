import Link from "next/link";
import { redirect } from "next/navigation";
import JournalBatchList from "@/components/JournalBatchList";
import styles from "@/components/OpsPage.module.css";
import { formatMoney } from "@/lib/documents";
import { getWorkspace } from "@/lib/data";
import { createJournalBatch } from "@/lib/journal-actions";
import { getJournalPreview, listJournalBatches } from "@/lib/journal-data";
import { groupJournals, journalsOlderThanAYear, parseUpTo, problemLink } from "@/lib/journal";
import { canManage } from "@/lib/types";

export const metadata = { title: "Journal export" };

export default async function JournalExportPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; upTo?: string; error?: string; message?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  // The journal is for owners and admins. A member is sent back to Admin.
  if (!canManage(workspace.current.role)) redirect("/admin");

  const params = await searchParams;
  const opening = params.new === "1";
  const today = new Date().toISOString().slice(0, 10);
  const upTo = parseUpTo(params.upTo, today);

  const [batches, preview] = await Promise.all([listJournalBatches(), opening ? getJournalPreview(upTo) : null]);
  const journals = preview ? groupJournals(preview.lines) : [];
  const lineCount = preview?.lines.length ?? 0;
  const older = preview && !preview.startDate ? journalsOlderThanAYear(journals, upTo) : 0;
  const debit = journals.reduce((total, journal) => total + journal.debit, 0);
  const credit = journals.reduce((total, journal) => total + journal.credit, 0);
  const status = params.error ?? batches.error ?? preview?.error ?? params.message ?? null;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Journal export</h1>
        <p className={styles.lede}>
          Send what has been posted in {workspace.current.organisationName} to your accounting system as a journal file. A batch holds everything not yet exported up to a date, and cannot be changed
          afterwards. The accounts it uses are on the <Link href="/accounting">Accounting</Link> screen.
        </p>
      </div>
      {status ? (
        <p className={params.error || batches.error || preview?.error ? styles.alert : styles.notice} role={params.error || batches.error || preview?.error ? "alert" : "status"}>
          {status}
        </p>
      ) : null}
      {opening && preview ? (
        <div className={styles.panel}>
          <div className={styles.panelHead}>New export</div>
          <form className={styles.partyFields} method="get" action="/journal-export">
            <input type="hidden" name="new" value="1" />
            <label className={styles.field}>
              Export up to
              <input type="date" name="upTo" defaultValue={upTo} required />
            </label>
            <div className={`${styles.modalActions} ${styles.wide}`}>
              <span className={styles.actionStart} />
              <Link className={styles.quiet} href="/journal-export">
                Close
              </Link>
              <button className={styles.quiet} type="submit">
                Show
              </button>
            </div>
          </form>
          {preview.problems.length > 0 ? (
            <div className={styles.alert} role="alert">
              <strong>Fix these before a batch can be made.</strong>
              <ul>
                {preview.problems.map((problem) => {
                  const link = problemLink(problem);
                  return (
                    <li key={`${problem.sourceId}-${problem.message}`}>
                      {problem.sourceNumber ? `${problem.sourceKind} ${problem.sourceNumber}` : problem.sourceKind}
                      {problem.party ? ` (${problem.party})` : ""}: {problem.message}. <Link href={link.href}>{link.label}</Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {older > 0 ? (
            <p className={styles.notice} role="status">
              {older === 1 ? "1 journal is" : `${older} journals are`} dated more than a year before this date. There is no start date on the Accounting screen, so the first batch takes everything ever posted.
            </p>
          ) : null}
          {journals.length === 0 && preview.problems.length === 0 ? (
            <p className={styles.notice} role="status">
              Nothing is waiting to be exported up to {upTo}.
            </p>
          ) : null}
          {journals.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Journal</th>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Account</th>
                  <th>Description</th>
                  <th className="numeric">Debit</th>
                  <th className="numeric">Credit</th>
                </tr>
              </thead>
              <tbody>
                {journals.flatMap((journal) =>
                  journal.lines.map((line, index) => (
                    <tr key={`${journal.journalNumber}-${line.lineNumber}`}>
                      <td>{index === 0 ? journal.journalNumber : ""}</td>
                      <td>{index === 0 ? journal.journalDate : ""}</td>
                      <td>{index === 0 ? `${journal.stage === "reversal" ? "Reversal of " : ""}${journal.sourceKind} ${journal.sourceNumber ?? ""}`.trim() : ""}</td>
                      <td>
                        {line.accountCode} {line.accountName}
                      </td>
                      <td>{line.description}</td>
                      <td className={`${styles.mono} numeric`}>{Number(line.debit) ? formatMoney(line.debit) : ""}</td>
                      <td className={`${styles.mono} numeric`}>{Number(line.credit) ? formatMoney(line.credit) : ""}</td>
                    </tr>
                  )),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className={`${styles.mono} numeric`}>{formatMoney(debit.toFixed(2))}</td>
                  <td className={`${styles.mono} numeric`}>{formatMoney(credit.toFixed(2))}</td>
                </tr>
              </tfoot>
            </table>
          ) : null}
          {journals.length > 0 && preview.problems.length === 0 ? (
            <form className={styles.partyFields} action={createJournalBatch}>
              <input type="hidden" name="up_to" value={upTo} />
              <div className={`${styles.modalActions} ${styles.wide}`}>
                <span className={styles.actionStart} />
                <button className={styles.primary} type="submit">
                  {`Create batch of ${journals.length} ${journals.length === 1 ? "journal" : "journals"} and ${lineCount} lines`}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
      <JournalBatchList rows={batches.rows} />
    </section>
  );
}
