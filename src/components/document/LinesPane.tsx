"use client";

import GridPager from "@/components/GridPager";
import { formatInteger, numberValue } from "@/lib/numbers";
import { clickOpensRow } from "@/lib/row-click";
import { formatMoney } from "@/lib/documents";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { blankLine } from "./shared";
import type { DocumentFormState } from "./useDocumentForm";

/** The line grid, its pager and the Add line button. */
export function LinesPane({ form }: { form: DocumentFormState }) {
  const { choices, invoiceLines, linePageSize, setLinePageIndex, setLineDraft, setLineMessage, locked, lineGridLines, totals, showDrawn, showReturns, showSource, linePage, replaceLines, changeLinePageSize } = form;
  return (
    <div className={styles.linesPane}>
      <div className={styles.gridToolbar}>
        <span className={styles.paneLabel}>
          Lines ({invoiceLines.length})
          {locked && invoiceLines.length > 0 ? <span className={documentStyles.lineHint}>Select a line to see its details.</span> : null}
        </span>
        {locked ? null : (
          <button
            className={styles.primary}
            type="button"
            onClick={() => {
              setLineMessage(null);
              setLineDraft(blankLine());
            }}
          >
            Add line
          </button>
        )}
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
                {showDrawn ? <th className={styles.num} title="Posted invoice quantity, less quantity returned by credit notes">Invoiced</th> : null}
                {showDrawn ? <th className={styles.num} title="Quantity held by draft invoices">Reserved</th> : null}
                {showDrawn ? <th className={styles.num} title="Order quantity less Invoiced and Reserved">Left</th> : null}
                {showReturns ? <th>Return to order</th> : null}
                <th className={styles.num}>Nett</th>
                <th className={styles.num}>VAT amount</th>
                {showSource ? <th>Order</th> : null}
                {locked ? null : <th className={styles.actions}>&nbsp;</th>}
              </tr>
            </thead>
            <tbody>
              {invoiceLines.length === 0 ? (
                <tr>
                  <td colSpan={(locked ? 9 : 10) + (showDrawn ? 3 : 0) + (showReturns ? 1 : 0) + (showSource ? 1 : 0)}>No lines yet.</td>
                </tr>
              ) : (
                linePage.rows.map((line) => (
                  <tr
                    key={line.lineNumber}
                    className={documentStyles.lineClick}
                    tabIndex={locked ? 0 : undefined}
                    role={locked ? "button" : undefined}
                    aria-label={locked ? `View line ${line.lineNumber}` : undefined}
                    onClick={(event) => {
                      if (!clickOpensRow(event.target)) return;
                      setLineMessage(null);
                      setLineDraft(line);
                    }}
                    onKeyDown={
                      locked
                        ? (event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setLineMessage(null);
                            setLineDraft(line);
                          }
                        : undefined
                    }
                  >
                    <td className={styles.mono}>{line.lineNumber}</td>
                    <td className={styles.mono}>{line.productCode}</td>
                    <td>{line.description}</td>
                    <td className={styles.mono}>{line.unitCode || "C62"}</td>
                    <td className={styles.mono}>{choices.glCodes.find((code) => code.id === line.glCodeId)?.code ?? ""}</td>
                    <td className={styles.mono}>{choices.vatRates.find((rate) => rate.id === line.vatRateId)?.code ?? ""}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{line.quantity}</td>
                    {showDrawn ? <td className={`${styles.mono} ${styles.num}`}>{line.invoicedQuantity || "0.00"}</td> : null}
                    {showDrawn ? <td className={`${styles.mono} ${styles.num}`}>{line.reservedQuantity || "0.00"}</td> : null}
                    {showDrawn ? (
                      <td className={`${styles.mono} ${styles.num}`}>
                        {formatMoney(Math.max(0, numberValue(line.quantity) - numberValue(line.drawnQuantity)))}
                      </td>
                    ) : null}
                    {showReturns ? <td>{line.returnsToOrder ? "Yes" : line.canReturnToOrder ? "No" : ""}</td> : null}
                    <td className={`${styles.mono} ${styles.num}`}>{line.nettAmount}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{line.vatAmount}</td>
                    {showSource ? <td className={styles.mono}>{line.sourceDocument ?? ""}</td> : null}
                    {locked ? null : (
                      <td className={styles.actions}>
                        <button className={styles.quiet} type="button" onClick={() => { setLineMessage(null); setLineDraft(line); }}>
                          Edit
                        </button>
                        <button
                          className={styles.quiet}
                          type="button"
                          data-destructive="true"
                          onClick={() =>
                            replaceLines(
                              invoiceLines
                                .filter((item) => item.lineNumber !== line.lineNumber)
                                .map((item, index) => ({ ...item, lineNumber: index + 1 })),
                            )
                          }
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={showDrawn ? 9 : 7}>Total</th>
                <td className={`${styles.mono} ${styles.num}`}>{formatMoney(totals.foreignNett)}</td>
                <td className={`${styles.mono} ${styles.num}`}>{formatMoney(totals.foreignVat)}</td>
                {showSource ? <td /> : null}
                {locked ? null : <td />}
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
            invoiceLines.length === 0
              ? "No lines"
              : `Showing ${formatInteger(linePage.from)} to ${formatInteger(linePage.to)} of ${formatInteger(invoiceLines.length)}`
          }
        />
    </div>
  );
}
