import { redirect } from "next/navigation";
import JournalList from "@/components/JournalList";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { todayInZone } from "@/lib/dates";
import { getDraft, getEntry, getJournals, getLedgerChoices } from "@/lib/ledger-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Journals" };

type Params = { open?: string; edit?: string; new?: string; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The manual journals: accruals, adjustments and the opening balances. Owners and admins only. */
export default async function JournalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  // A member is sent back to Transactions, where the Journals tile is not shown to them.
  if (!canManage(workspace.current.role)) redirect("/transactions");

  const params = await searchParams;
  const [journals, choices, entry, draft] = await Promise.all([
    getJournals({ source: "manual" }),
    getLedgerChoices(),
    UUID.test(params.open ?? "") ? getEntry(params.open as string) : null,
    UUID.test(params.edit ?? "") ? getDraft(params.edit as string) : null,
  ]);
  const error = journals.error ?? choices.error ?? entry?.error ?? draft?.error ?? null;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Journals</h1>
        <p className={styles.lede}>Manual journals for {workspace.current.organisationName}.</p>
      </div>
      {error || params.message ? (
        <p className={error ? styles.alert : styles.notice} role={error ? "alert" : "status"}>
          {error ?? params.message}
        </p>
      ) : null}
      <JournalList
        rows={journals.rows}
        basePath="/transactions/journals"
        allowNew
        query=""
        entry={entry?.entry ?? null}
        draft={draft?.draft ?? null}
        newJournal={params.new === "1"}
        opening={false}
        openingDate=""
        choices={{ glCodes: choices.glCodes, departments: choices.departments, costCentres: choices.costCentres }}
        today={todayInZone()}
      />
    </section>
  );
}
