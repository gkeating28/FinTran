import type { PrintView } from "@/lib/form-document";
import { PAGE_SIZE_OPTIONS } from "@/lib/form-layout";
import styles from "@/components/PrintForm.module.css";

export default function PrintedForm({ view }: { view: PrintView }) {
  const page = PAGE_SIZE_OPTIONS[view.pageSize];
  return (
    <article
      className={styles.paper}
      style={{ ["--page-width" as string]: page.width, ["--page-height" as string]: page.height }}
    >
      <style>{`@page { size: ${page.css}; margin: 14mm; }`}</style>
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

      <div className={styles.billRow}>
        <div>
          {view.partyLines.length > 0 ? (
            <>
              <p className={styles.kicker}>Bill to</p>
              <p className={styles.partyLines}>
                {view.partyLines.map((line, index) => (
                  <span key={`${line}-${index}`}>
                    {line}
                    <br />
                  </span>
                ))}
              </p>
            </>
          ) : null}
        </div>
        {view.headerLines.length > 0 ? (
          <dl className={styles.meta}>
            {view.headerLines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <table className={styles.lines}>
        <thead>
          <tr>
            {view.lineHeaders.map((header) => (
              <th key={`${header.label}-${header.span}`} colSpan={header.span} className={header.align === "right" ? styles.right : undefined}>
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.lineRows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, view.lineHeaders.reduce((sum, header) => sum + header.span, 0))}>&nbsp;</td>
            </tr>
          ) : (
            view.lineRows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={cell.align === "right" ? styles.right : undefined}>
                    {cell.text || "\u00a0"}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>Subtotal</span>
          <span>{view.subtotal}</span>
        </div>
        <div className={styles.totalRow}>
          <span>Tax</span>
          <span>{view.tax}</span>
        </div>
        <div className={styles.totalRow}>
          <span>Total</span>
          <span>{view.total}</span>
        </div>
        {view.paid ? (
          <div className={styles.totalRow}>
            <span>Paid</span>
            <span>{view.paid}</span>
          </div>
        ) : null}
        <div className={`${styles.totalRow} ${styles.balance}`}>
          <span>Balance due</span>
          <span>{view.balance}</span>
        </div>
      </div>

      {view.showVatSummary ? (
        <>
          <h3 className={styles.vatTitle}>VAT summary</h3>
          <table className={styles.vat}>
            <thead>
              <tr>
                <th>Rate</th>
                <th>VAT</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {view.vatRows.map((row) => (
                <tr key={row.rate}>
                  <td>{row.rate}</td>
                  <td>{row.vat}</td>
                  <td>{row.nett}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {view.showFooter ? (
        <footer className={styles.bank}>
          {view.footerTitle ? <strong>{view.footerTitle}</strong> : null}
          {view.footerBody ? <p>{view.footerBody}</p> : null}
        </footer>
      ) : null}

      <p className={styles.pageMark}>Page 1 of 1</p>
    </article>
  );
}
