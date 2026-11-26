import Link from "next/link";
import { redirect } from "next/navigation";
import JournalList from "@/components/JournalList";
import LedgerDownloads from "@/components/LedgerDownloads";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { todayInZone } from "@/lib/dates";
import { SOURCE_LABELS, SOURCE_TYPES } from "@/lib/ledger";
import { getDraft, getEntry, getJournals, getLedgerChoices, getLedgerSettings } from "@/lib/ledger-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Ledger" };

type Params = { from?: string; to?: string; source?: string; gl?: string; open?: string; edit?: string; new?: string; opening?: string; message?: string; error?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Params> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  // The ledger is for owners and admins. A member is sent home, and never sees the menu item.
  if (!canManage(workspace.current.role)) redirect("/");

  const params = await searchParams;
  const from = DATE.test(params.from ?? "") ? params.from : "";
  const to = DATE.test(params.to ?? "") ? params.to : "";
  const source = (SOURCE_TYPES as readonly string[]).includes(params.source ?? "") ? params.source : "";
  const gl = UUID.test(params.gl ?? "") ? params.gl : "";
  const query = new URLSearchParams(Object.entries({ from, to, source, gl }).filter(([, value]) => value) as [string, string][]).toString();
  const today = todayInZone();

  const [journals, choices, settings, entry, draft] = await Promise.all([
    getJournals({ from, to, source, glCodeId: gl }),
    getLedgerChoices(),
    getLedgerSettings(workspace.current.organisationId),
    UUID.test(params.open ?? "") ? getEntry(params.open as string) : null,
    UUID.test(params.edit ?? "") ? getDraft(params.edit as string) : null,
  ]);
  const error = params.error ?? journals.error ?? choices.error ?? settings.error ?? entry?.error ?? draft?.error ?? null;
  const startDate = settings.settings?.startDate ?? "";
  const openingDate = startDate ? new Date(new Date(`${startDate}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : "";
  const wantsOpening = params.opening === "1";
  const openingProblem = wantsOpening
    ? !startDate
      ? "Set the go-live date on the Organisations screen before posting the opening balance journal."
      : settings.settings?.openingPosted
        ? "The opening balance journal has already been posted."
        : null
    : null;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Ledger</h1>
        <p className={styles.lede}>
          Every posting in {workspace.current.organisationName}.{" "}
          {settings.settings?.mode === "book" ? "Qula Plus is the book of record." : "Qula Plus feeds your accounting system."}
        </p>
      </div>
      {error || openingProblem || params.message ? (
        <p className={error || openingProblem ? styles.alert : styles.notice} role={error || openingProblem ? "alert" : "status"}>
          {error ?? openingProblem ?? params.message}
        </p>
      ) : null}
      <form className={styles.partyFields} method="get" action="/ledger">
        <label className={styles.field}>
          From
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label className={styles.field}>
          To
          <input type="date" name="to" defaultValue={to} />
        </label>
        <label className={styles.field}>
          Source
          <select name="source" defaultValue={source}>
            <option value="">All</option>
            {SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SOURCE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Account
          <select name="gl" defaultValue={gl}>
            <option value="">All</option>
            {choices.allCodes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.code} {code.description}
              </option>
            ))}
          </select>
        </label>
        <div className={`${styles.modalActions} ${styles.wide}`}>
          <span className={styles.actionStart} />
          <LedgerDownloads />
          <Link className={styles.quiet} href="/ledger">
            Clear
          </Link>
          <button className={styles.quiet} type="submit">
            Show
          </button>
        </div>
      </form>
      {journals.total > journals.rows.length ? (
        <p className={styles.panelMeta}>
          Showing the latest {journals.rows.length} of {journals.total}. Narrow the dates to see the rest.
        </p>
      ) : null}
      <JournalList
        rows={journals.rows}
        query={query}
        entry={entry?.entry ?? null}
        draft={draft?.draft ?? null}
        newJournal={params.new === "1"}
        opening={wantsOpening && !openingProblem}
        openingDate={openingDate}
        choices={{ glCodes: choices.glCodes, departments: choices.departments, costCentres: choices.costCentres }}
        today={today}
      />
    </section>
  );
}
