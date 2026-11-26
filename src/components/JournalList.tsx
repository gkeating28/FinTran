"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import DataGrid from "@/components/DataGrid";
import EntryView from "@/components/EntryView";
import JournalForm from "@/components/JournalForm";
import { formatMoney } from "@/lib/documents";
import { emptyDraft, SOURCE_LABELS, type EntryDetail, type JournalRow, type ManualDraft } from "@/lib/ledger";
import type { LedgerChoice, Named } from "@/lib/ledger-data";
import styles from "@/components/OpsPage.module.css";

/** The journals grid, and the dialogs that open over it: an entry, a manual journal and the opening balance journal. */
export default function JournalList({
  rows,
  query,
  entry,
  draft,
  newJournal,
  opening,
  openingDate,
  choices,
  today,
}: {
  rows: JournalRow[];
  /** The filters as a query string, kept when a dialog opens or closes. */
  query: string;
  entry: EntryDetail | null;
  draft: ManualDraft | null;
  newJournal: boolean;
  opening: boolean;
  openingDate: string;
  choices: { glCodes: LedgerChoice[]; departments: Named[]; costCentres: Named[] };
  today: string;
}) {
  const router = useRouter();
  const go = (extra = "") => router.push(`/ledger?${[query, extra].filter(Boolean).join("&")}`);
  const done = (message: string) => router.push(`/ledger?${[query, `message=${encodeURIComponent(message)}`].filter(Boolean).join("&")}`);

  return (
    <>
      <DataGrid
        form="ledger-journals"
        rows={rows}
        searchPlaceholder="Search journals"
        searchText={(row) => `${row.number ?? "draft"} ${row.date} ${SOURCE_LABELS[row.sourceType] ?? ""} ${row.sourceRef} ${row.description}`}
        emptyLabel="No journals match."
        initialSort={{ key: "number", direction: "desc" }}
        onOpen={(row) => go(`${row.status === "draft" ? "edit" : "open"}=${row.id}`)}
        toolbar={
          <>
            <Link className={styles.quiet} href="/ledger/trial-balance">
              Trial balance
            </Link>
            <button className={styles.primary} type="button" onClick={() => go("new=1")}>
              New journal
            </button>
          </>
        }
        columns={[
          { key: "number", label: "No.", mono: true, // A draft has no number yet and is work in hand, so it sorts with the newest.
          sortValue: (row) => String(row.number ?? 9_999_999_999).padStart(10, "0"), render: (row) => (row.number ? String(row.number) : "Draft"), exportValue: (row) => row.number },
          { key: "date", label: "Date", mono: true, sortValue: (row) => row.date, render: (row) => row.date },
          { key: "source", label: "Source", sortValue: (row) => SOURCE_LABELS[row.sourceType] ?? row.sourceType, render: (row) => (row.isOpening ? "Opening balances" : (SOURCE_LABELS[row.sourceType] ?? row.sourceType)) },
          { key: "ref", label: "Reference", mono: true, sortValue: (row) => row.sourceRef, render: (row) => row.sourceRef },
          { key: "description", label: "Description", sortValue: (row) => row.description, render: (row) => row.description },
          { key: "total", label: "Total", mono: true, align: "right", sortValue: (row) => String(Math.round(row.total * 100)).padStart(14, "0"), render: (row) => formatMoney(row.total), exportValue: (row) => row.total },
          { key: "state", label: "State", sortValue: (row) => (row.status === "draft" ? "a" : row.reversed ? "c" : "b"), render: (row) => (row.status === "draft" ? "Draft" : row.reversed ? "Reversed" : row.reversesId ? "Reversal" : "Posted") },
        ]}
      />
      {entry ? (
        <EntryView
          key={entry.id}
          entry={entry}
          today={today}
          onClose={() => go()}
          onEdit={() => go(`edit=${entry.id}`)}
          onDone={done}
          onOpenEntry={(id) => go(`open=${id}`)}
        />
      ) : null}
      {draft || newJournal || opening ? (
        <JournalForm
          key={draft?.id ?? (opening ? "opening" : "new")}
          initial={draft ?? emptyDraft(opening ? openingDate : today)}
          glCodes={choices.glCodes}
          departments={choices.departments}
          costCentres={choices.costCentres}
          opening={opening}
          openingDate={openingDate}
          onClose={() => go()}
          onDone={done}
        />
      ) : null}
    </>
  );
}
