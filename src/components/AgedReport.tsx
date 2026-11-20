"use client";

import Link from "next/link";
import { useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import styles from "@/components/OpsPage.module.css";
import agedStyles from "@/components/AgedReport.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { AGED_BASIS_LABELS, agedBands, type AgedBasis, type AgedParty, type AgedReport as Report } from "@/lib/aged";
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
  const bands = agedBands(report.basis);
  const byDue = report.basis === "due";

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{heading}</h1>
        <p className={styles.lede}>
          {debtors ? "What customers owe" : "What is owed to suppliers"} {organisationName}, in euro, by {byDue ? "how late it is" : "how old it is"} on the ageing date. Credit notes and money not yet applied are taken off.
        </p>
      </div>
      <form method="get" className={`${styles.panel} ${agedStyles.filters}`} style={{ padding: "12px 14px" }}>
        <label>
          Age from
          <select name="basis" defaultValue={report.basis}>
            {(Object.keys(AGED_BASIS_LABELS) as AgedBasis[]).map((basis) => (
              <option key={basis} value={basis}>
                {AGED_BASIS_LABELS[basis]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ageing date
          <input type="date" name="asOf" defaultValue={report.asOf} />
        </label>
        <button className={styles.primary} type="submit">
          Show
        </button>
        <p className={agedStyles.hint}>{byDue ? "Bands count the days past each due date." : "Bands count the days since each transaction date."} Balances are as they stand now. A different date moves amounts between the bands and does not rewind payments.</p>
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
      <dl className={agedStyles.summary} aria-label="Totals">
        <div className={agedStyles.total}>
          <dt>Total owed</dt>
          <dd>{money(report.totals.total)}</dd>
        </div>
        {bands.map((band) => (
          <div key={band.key} className={band.key === "current" ? undefined : agedStyles.late}>
            <dt>{band.label}</dt>
            <dd>{money(report.totals[band.key])}</dd>
          </div>
        ))}
        <div className={agedStyles.credit}>
          <dt>On account</dt>
          <dd>{money(report.totals.onAccount)}</dd>
        </div>
      </dl>
      <DataGrid
        form={debtors ? "aged-debtors" : "aged-creditors"}
        onOpen={(row) => setOpen(row)}
        rows={report.parties}
        searchPlaceholder={debtors ? "Search customers" : "Search suppliers"}
        searchText={(row) => row.party}
        emptyLabel={debtors ? "No customer owes anything on this date." : "Nothing is owed to suppliers on this date."}
        columns={[
          { key: "party", label: debtors ? "Customer" : "Supplier", sortValue: (row) => row.party, render: (row) => row.party },
          ...bands.map((band) => ({
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
        footer={(shown) => {
          const sum = (pick: (party: AgedParty) => number) => shown.reduce((total, party) => total + Math.round(pick(party) * 100), 0) / 100;
          return (
            <tr>
              <td>{shown.length === report.parties.length ? "Total" : `Total of ${shown.length} shown`}</td>
              {bands.map((band) => (
                <td key={band.key} className={`${styles.mono} ${styles.numeric}`}>
                  {money(sum((party) => party[band.key]))}
                </td>
              ))}
              <td className={`${styles.mono} ${styles.numeric}`}>{money(sum((party) => party.onAccount))}</td>
              <td className={`${styles.mono} ${styles.numeric}`}>{money(sum((party) => party.total))}</td>
              <td />
            </tr>
          );
        }}
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
                  <th className={styles.numeric}>{byDue ? "Days late" : "Days old"}</th>
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
                    <td className={styles.numeric}>{line.band === "on_account" ? "" : byDue ? Math.max(line.days, 0) : line.days}</td>
                    <td>{line.band === "on_account" ? "On account" : (bands.find((band) => band.key === line.band)?.label ?? "")}</td>
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
