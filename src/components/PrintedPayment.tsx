import { PAGE_SIZE_OPTIONS } from "@/lib/form-layout";
import type { PaymentPrintView } from "@/lib/payment-print";
import styles from "@/components/PrintForm.module.css";

/** A payment, receipt or refund on paper. It has one fixed layout, on A4, and uses the same paper as a printed document. */
export default function PrintedPayment({ view }: { view: PaymentPrintView }) {
  const page = PAGE_SIZE_OPTIONS.A4;
  return (
    <article
      className={styles.paper}
      style={{ ["--page-width" as string]: page.width, ["--page-height" as string]: page.height }}
    >
      <style>{`@page { size: ${page.css}; margin: 14mm; }`}</style>
      {view.watermark ? <div className={styles.watermark}>{view.watermark}</div> : null}
      <div className={styles.sheetBody}>
        <header className={styles.top}>
          <div>
            {view.organisationName ? <h1 className={styles.orgName}>{view.organisationName}</h1> : null}
            {view.organisationLines.length > 0 ? (
              <p className={styles.orgLines}>
                {view.organisationLines.map((line, index) => (
                  <span key={`${line}-${index}`}>
                    {line}
                    <br />
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          {view.logoUrl ? <img src={view.logoUrl} alt="" className={styles.logo} /> : null}
        </header>

        <h2 className={styles.title}>{view.title}</h2>
        {view.voidNote ? <p className={styles.partyLines}>{view.voidNote}</p> : null}

        <div className={styles.billRow}>
          <div>
            <p className={styles.kicker}>{view.partyLabel}</p>
            <p className={styles.partyLines}>
              <strong>{view.partyName}</strong>
              <br />
              {view.partyLines.map((line, index) => (
                <span key={`${line}-${index}`}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
          </div>
          <dl className={styles.meta}>
            {view.details.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <table className={styles.lines}>
          <thead>
            <tr>
              {view.headers.map((header) => (
                <th key={header.key} className={header.align === "right" ? styles.numeric : undefined}>
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.length === 0 ? (
              <tr>
                <td colSpan={view.headers.length}>Not applied to any document.</td>
              </tr>
            ) : (
              view.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={cell.align === "right" ? styles.numeric : undefined}>
                      {cell.text || " "}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className={styles.totals}>
          {view.totals.map((line) => (
            <div key={line.label} className={`${styles.totalRow} ${line.strong ? styles.balance : ""}`}>
              <span>{line.label}</span>
              <span>{line.value}</span>
            </div>
          ))}
        </div>

        {view.notes ? <p className={styles.partyLines}>{view.notes}</p> : null}
      </div>

      <div className={styles.sheetFooter}>
        <p className={styles.pageMark}>Page 1 of 1</p>
      </div>
    </article>
  );
}
