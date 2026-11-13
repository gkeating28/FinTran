"use client";

import GridPager from "@/components/GridPager";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { formatInteger } from "@/lib/numbers";
import { clickOpensRow } from "@/lib/row-click";
import { moneyText, namedCode, presentedLine, vatCode } from "./format";
import type { ImportFormState } from "./useImportForm";

/** The e-invoice lines, which open to choose their VAT code and codes. */
export function LinesPane({ form }: { form: ImportFormState }) {
  const { rates, glCodes, linePageSize, setLinePageIndex, lineGridLines, lines, nett, vat, linePage, choiceFor, changeLinePageSize, openEditor } = form;
  return (
    <div className={styles.linesPane}>
      <div className={styles.gridToolbar}>
        <span className={styles.paneLabel}>
          Lines ({lines.length})
          {lines.length > 0 ? <span className={documentStyles.lineHint}>Select a line to see its details.</span> : null}
        </span>
      </div>
      <div className={documentStyles.lineScroll}>
        <table className={styles.lineTable} data-lines={lineGridLines.lines}>
          <thead>
            <tr>
              <th>Line</th>
              <th>Product</th>
              <th>Description</th>
              <th>Unit</th>
              <th>GL</th>
              <th>VAT</th>
              <th className={styles.num}>Qty</th>
              <th className={styles.num}>Nett</th>
              <th className={styles.num}>VAT amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={9}>No lines yet.</td>
              </tr>
            ) : (
              linePage.rows.map((line) => {
                const view = presentedLine(line);
                const selectedLine = choiceFor(line);
                return (
                  <tr
                    key={view.number}
                    className={documentStyles.lineClick}
                    tabIndex={0}
                    role="button"
                    aria-label={`View line ${view.number}`}
                    onClick={(event) => {
                      if (clickOpensRow(event.target)) openEditor(line);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openEditor(line);
                    }}
                  >
                    <td className={styles.mono}>{view.number}</td>
                    <td className={styles.mono}>{view.sellerItem}</td>
                    <td>{view.description}</td>
                    <td className={styles.mono}>{view.unit}</td>
                    <td className={styles.mono}>{namedCode(glCodes, selectedLine.glCodeId)}</td>
                    <td className={styles.mono}>{vatCode(rates, selectedLine.vatRateId)}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{moneyText(view.quantity)}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{moneyText(view.nett)}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{view.vatAmount || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={7}>Total</th>
              <td className={`${styles.mono} ${styles.num}`}>{moneyText(nett)}</td>
              <td className={`${styles.mono} ${styles.num}`}>{moneyText(vat)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <GridPager
        className={documentStyles.linePager}
        start={lineGridLines.button}
        page={linePage.page}
        pageCount={linePage.pageCount}
        pageSize={linePageSize}
        onPage={setLinePageIndex}
        onPageSize={changeLinePageSize}
        summary={
          lines.length === 0
            ? "No lines"
            : `Showing ${formatInteger(linePage.from)} to ${formatInteger(linePage.to)} of ${formatInteger(lines.length)}`
        }
      />
    </div>
  );
}
