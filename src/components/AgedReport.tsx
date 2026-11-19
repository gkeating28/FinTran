"use client";

import Link from "next/link";
import { useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { AGED_BANDS, type AgedParty, type AgedReport as Report } from "@/lib/aged";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/documents";
import { useRegion } from "@/components/useRegion";

/** Aged debtors (Sales) and aged creditors (Purchases): what is owed, by party, in bands of how late it is. */
export default function AgedReport({
  direction,
  report,
  truncated,
  loadError,
  organisationName,
}: {
  direction: "Sales" | "Purchases";
  report: Report;
  truncated: boolean;
  loadError: string | null;
  organisationName: string;
}) {
  const debtors = direction === "Sales";
  const region = useRegion();
  const [open, setOpen] = useState<AgedParty | null>(null);
  const money = (value: number) => formatMoney(value.toFixed(2));
  const heading = debtors ? "Aged debtors" : "Aged creditors";

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{heading}</h1>
        <p className={styles.lede}>
          {debtors ? "What customers owe" : "What is owed to suppliers"} {organisationName}, in euro, by how late it is on the ageing date. Credit notes and money not yet applied
          are taken off. Balances are as they stand now: changing the date moves amounts between the bands and does not rewind payments.
        </p>
      </div>
      <form method="get" className={styles.panel}>
        <label className={styles.field}>
          Ageing date
          <input type="date" name="asOf" defaultValue={report.asOf} />
        </label>
        <button className={styles.primary} type="submit">
          Show
        </button>
      </form>
      {loadError ? (
        <p className={styles.alert} role="alert">
          {loadError}
        </p>
      ) : null}
      {truncated ? (
        <p className={styles.notice} role="status">
          Only the first 5,000 documents are included, so these figures may be short.
        </p>
      ) : null}
      <p className={styles.panelMeta} aria-label="Totals">
        Total {money(report.totals.total)}. {AGED_BANDS.map((band) => `${band.label} ${money(report.totals[band.key])}`).join(". ")}. On account {money(report.totals.onAccount)}.
      </p>
      <DataGrid
        form={debtors ? "aged-debtors" : "aged-creditors"}
        onOpen={(row) => setOpen(row)}
        rows={report.parties}
        searchPlaceholder={debtors ? "Search customers" : "Search suppliers"}
        searchText={(row) => row.party}
        emptyLabel={debtors ? "No customer owes anything on this date." : "Nothing is owed to suppliers on this date."}
        columns={[
          { key: "party", label: debtors ? "Customer" : "Supplier", sortValue: (row) => row.party, render: (row) => row.party },
          ...AGED_BANDS.map((band) => ({
            key: band.key,
            label: band.label,
            mono: true,
            align: "right" as const,
            sortValue: (row: AgedParty) => String(row[band.key] + 1e9).padStart(16, "0"),
            render: (row: AgedParty) => money(row[band.key]),
            exportValue: (row: AgedParty) => row[band.key],
          })),
          {
            key: "onAccount",
            label: "On account",
            mono: true,
            align: "right" as const,
            sortValue: (row: AgedParty) => String(row.onAccount + 1e9).padStart(16, "0"),
            render: (row: AgedParty) => money(row.onAccount),
            exportValue: (row: AgedParty) => row.onAccount,
          },
          {
            key: "total",
            label: "Total",
            mono: true,
            align: "right" as const,
            sortValue: (row: AgedParty) => String(row.total + 1e9).padStart(16, "0"),
            render: (row: AgedParty) => money(row.total),
            exportValue: (row: AgedParty) => row.total,
          },
        ]}
        actions={(row) => (
          <button className={styles.quiet} type="button" onClick={() => setOpen(row)}>
            Documents
          </button>
        )}
      />
      {open ? (
        <FormModal title={`${open.party}: ${heading.toLowerCase()}`} onClose={() => setOpen(null)} className={recordStyles.dialogMedium}>
          <div className={styles.modalForm}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th className={styles.numeric}>Days late</th>
                  <th>Band</th>
                  <th className={styles.numeric}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {open.lines.map((line) => (
                  <tr key={`${line.kind}-${line.id}`}>
                    <td>
                      {line.kind === "on_account" ? (
                        `${line.typeCode} ${line.number} (not applied)`
                      ) : (
                        <Link href={`/transactions/${line.typeCode}?open=${line.id}`}>
                          {line.typeCode} {line.number}
                          {line.kind === "credit_note" ? " (credit note)" : ""}
                        </Link>
                      )}
                    </td>
                    <td>{formatDate(line.date, region)}</td>
                    <td>{line.dueDate ? formatDate(line.dueDate, region) : ""}</td>
                    <td className={styles.numeric}>{line.band === "on_account" ? "" : Math.max(line.days, 0)}</td>
                    <td>{line.band === "on_account" ? "On account" : (AGED_BANDS.find((band) => band.key === line.band)?.label ?? "")}</td>
                    <td className={styles.numeric}>{money(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.modalActions}>
              <button className={styles.quiet} type="button" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        </FormModal>
      ) : null}
    </section>
  );
}
