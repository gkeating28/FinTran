"use client";

import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { semanticText } from "@/lib/einvoice/semantic-read";
import { numberValue } from "@/lib/numbers";
import { formatMoney, toHome } from "@/lib/documents";
import { moneyText } from "./format";
import type { ImportFormState } from "./useImportForm";

/** Totals in the invoice currency and the home currency, the amount due and the VAT breakdown. */
export function TotalsSummary({ form }: { form: ImportFormState }) {
  const { nett, vat, gross, due, taxes, rateText, currencyLabel, homeCurrency, showHome } = form;
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
              <th>{currencyLabel || "—"}</th>
              <td className={styles.mono}>{moneyText(nett)}</td>
              <td className={styles.mono}>{moneyText(vat)}</td>
              <td className={styles.mono}>{moneyText(gross)}</td>
            </tr>
            {showHome && homeCurrency ? (
              <tr>
                <th>{homeCurrency.code}</th>
                <td className={styles.mono}>{formatMoney(toHome(numberValue(nett), rateText))}</td>
                <td className={styles.mono}>{formatMoney(toHome(numberValue(vat), rateText))}</td>
                <td className={styles.mono}>{formatMoney(toHome(numberValue(gross), rateText))}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className={styles.panelMeta}>Amount due {moneyText(due)}</p>
        {taxes.length ? (
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
              {taxes.map((row) => {
                const category = semanticText(row["BT-118"]);
                const percent = semanticText(row["BT-119"]);
                return (
                  <tr key={`${category}-${percent}`}>
                    <td className={styles.mono}>{category || "—"}</td>
                    <td className={styles.mono}>{percent ? `${Number(percent).toFixed(2)}%` : "—"}</td>
                    <td className={styles.mono}>{moneyText(semanticText(row["BT-116"]))}</td>
                    <td className={styles.mono}>{moneyText(semanticText(row["BT-117"]))}</td>
                    <td>{semanticText(row["BT-120"]) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </fieldset>
    </div>
  );
}
