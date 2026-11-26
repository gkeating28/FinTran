"use client";

import { downloadXlsx } from "@/lib/export/download";
import type { TrialRow } from "@/lib/ledger";
import styles from "@/components/OpsPage.module.css";

/** The trial balance as an Excel file, through the shared export helpers. */
export default function TrialBalanceExport({ rows, from, to }: { rows: TrialRow[]; from: string; to: string }) {
  return (
    <button
      className={styles.quiet}
      type="button"
      onClick={() =>
        downloadXlsx(`trial-balance-${from}-to-${to}.xlsx`, {
          sheet: "Trial balance",
          columns: [
            { label: "Code", type: "text" },
            { label: "Account", type: "text" },
            { label: "Type", type: "text" },
            { label: "Opening", type: "money" },
            { label: "Debit", type: "money" },
            { label: "Credit", type: "money" },
            { label: "Closing", type: "money" },
          ],
          rows: rows.map((row) => [row.code, row.description, row.accountType, row.opening, row.debit, row.credit, row.closing]),
        })
      }
    >
      Download Excel
    </button>
  );
}
