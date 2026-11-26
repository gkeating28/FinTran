"use client";

import { useState } from "react";
import { downloadCsv } from "@/lib/export/download";
import { ledgerExport } from "@/lib/ledger-actions";
import styles from "@/components/OpsPage.module.css";

/** The chart of accounts and every posted entry as CSV, in both modes, so an accountant can take the data away. */
export default function LedgerDownloads() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function download(file: "accounts" | "entries") {
    setBusy(file);
    setError(null);
    const result = await ledgerExport(file);
    setBusy(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    downloadCsv(`${result.file.name}.csv`, result.file.columns, result.file.rows);
  }

  return (
    <>
      <button className={styles.quiet} type="button" disabled={busy !== null} onClick={() => void download("accounts")}>
        {busy === "accounts" ? "Preparing…" : "Download chart of accounts"}
      </button>
      <button className={styles.quiet} type="button" disabled={busy !== null} onClick={() => void download("entries")}>
        {busy === "entries" ? "Preparing…" : "Download all entries"}
      </button>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
