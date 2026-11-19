"use client";

import Link from "next/link";
import { useState } from "react";
import DataGrid from "@/components/DataGrid";
import styles from "@/components/OpsPage.module.css";
import { downloadCsv } from "@/lib/export/download";
import { formatMoney } from "@/lib/documents";
import { journalBatchCsv } from "@/lib/journal-actions";
import type { JournalBatchRow } from "@/lib/journal";

function batchName(number: number) {
  return `JB-${String(number).padStart(4, "0")}`;
}

export default function JournalBatchList({ rows }: { rows: JournalBatchRow[] }) {
  const [error, setError] = useState<string | null>(null);

  async function download(row: JournalBatchRow) {
    setError(null);
    const result = await journalBatchCsv(row.id);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    downloadCsv(`${result.name}.csv`, result.columns, result.rows);
  }

  return (
    <>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <DataGrid
        form="journal-batches"
        rows={rows}
        searchPlaceholder="Search export batches"
        searchText={(row) => `${batchName(row.number)} ${row.upTo} ${row.createdByName ?? ""}`}
        emptyLabel="Nothing has been exported yet."
        toolbar={
          <Link className={styles.primary} href="/journal-export?new=1">
            Add
          </Link>
        }
        columns={[
          { key: "number", label: "Batch", mono: true, sortValue: (row) => String(row.number).padStart(6, "0"), render: (row) => batchName(row.number) },
          { key: "upTo", label: "Up to", mono: true, sortValue: (row) => row.upTo, render: (row) => row.upTo },
          { key: "journals", label: "Journals", mono: true, align: "right", sortValue: (row) => String(row.journalCount).padStart(8, "0"), render: (row) => String(row.journalCount) },
          { key: "lines", label: "Lines", mono: true, align: "right", sortValue: (row) => String(row.lineCount).padStart(8, "0"), render: (row) => String(row.lineCount) },
          { key: "debit", label: "Total debit", mono: true, align: "right", sortValue: (row) => row.totalDebit.padStart(18, "0"), render: (row) => formatMoney(row.totalDebit) },
          { key: "credit", label: "Total credit", mono: true, align: "right", sortValue: (row) => row.totalCredit.padStart(18, "0"), render: (row) => formatMoney(row.totalCredit) },
          { key: "made", label: "Made", sortValue: (row) => row.createdAt, render: (row) => `${row.createdAt.slice(0, 10)}${row.createdByName ? `, ${row.createdByName}` : ""}` },
        ]}
        actions={(row) => (
          <button className={styles.quiet} type="button" onClick={() => void download(row)}>
            Download
          </button>
        )}
      />
    </>
  );
}
