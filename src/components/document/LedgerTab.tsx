"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "@/components/OpsPage.module.css";
import { formatMoney } from "@/lib/documents";
import { SOURCE_LABELS, type JournalRow } from "@/lib/ledger";
import { loadSourceLedger } from "@/lib/ledger-actions";

/** The journal entries a posted document or payment made, and the reversal of any of them. Owners and admins only. */
export function LedgerTab({ kind, id, active }: { kind: "document" | "payment"; id: string; active: boolean }) {
  const [rows, setRows] = useState<JournalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || rows !== null) return;
    let cancelled = false;
    loadSourceLedger(kind, id)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setError(result.error);
      })
      .catch(() => {
        if (!cancelled) setError("The ledger entries could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [active, rows, kind, id]);

  if (error) {
    return (
      <p className={styles.alert} role="alert">
        {error}
      </p>
    );
  }
  if (rows === null) return <p className={styles.panelMeta}>Loading…</p>;
  if (rows.length === 0) return <p className={styles.panelMeta}>This has made no ledger entries.</p>;
  return (
    <table className={styles.table} aria-label="Ledger entries">
      <thead>
        <tr>
          <th>No.</th>
          <th>Date</th>
          <th>Entry</th>
          <th className={styles.numeric}>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={styles.mono}>
              <Link href={`/ledger?open=${row.id}`}>{row.number}</Link>
            </td>
            <td className={styles.mono}>{row.date}</td>
            <td>
              {SOURCE_LABELS[row.sourceType] ?? row.sourceType}
              {row.reversed ? " (reversed)" : ""}
            </td>
            <td className={`${styles.mono} ${styles.numeric}`}>{formatMoney(row.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
