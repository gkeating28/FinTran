"use client";

import { formatMoney } from "@/lib/documents";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import type { DocumentFormState } from "./useDocumentForm";

/** Foreign and home totals, the amount due, and the VAT breakdown. */
export function TotalsSummary({ form }: { form: DocumentFormState }) {
  const { supplierCurrency, homeCurrency, totals } = form;
  return (
    <div className={styles.headerSummary}>
      <fieldset className={documentStyles.amountBox}>
        <legend>Totals</legend>
        <table>
          <thead>
            <tr>
              <th />
              <th>Nett</th>
              <th>VAT</th>
              <th>Gross</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>{supplierCurrency || "—"}</th>
              <td className={styles.mono}>{formatMoney(totals.foreignNett)}</td>
              <td className={styles.mono}>{formatMoney(totals.foreignVat)}</td>
              <td className={styles.mono}>{formatMoney(totals.foreignTotal)}</td>
            </tr>
            {supplierCurrency.toUpperCase() === homeCurrency.toUpperCase() ? null : (
              <tr>
                <th>{homeCurrency || "—"}</th>
                <td className={styles.mono}>{formatMoney(totals.homeNett)}</td>
                <td className={styles.mono}>{formatMoney(totals.homeVat)}</td>
                <td className={styles.mono}>{formatMoney(totals.homeTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className={styles.panelMeta}>Amount due {formatMoney(totals.amountDue)}</p>
        {totals.breakdown.length ? (
          <table className={documentStyles.vatBreakdown}>
            <thead>
              <tr>
                <th>Category</th>
                <th>Rate</th>
                <th>Taxable</th>
                <th>VAT</th>
                <th>Exemption</th>
              </tr>
            </thead>
            <tbody>
              {totals.breakdown.map((row) => (
                <tr key={`${row.category}-${row.rate}`}>
                  <td className={styles.mono}>{row.category}</td>
                  <td className={styles.mono}>{row.rate.toFixed(2)}%</td>
                  <td className={styles.mono}>{formatMoney(row.taxable)}</td>
                  <td className={styles.mono}>{formatMoney(row.vat)}</td>
                  <td>{row.exemption || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </fieldset>
    </div>
  );
}
