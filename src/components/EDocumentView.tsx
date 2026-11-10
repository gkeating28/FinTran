import styles from "@/components/OpsPage.module.css";
import view from "@/components/EDocument.module.css";
import { semanticAt, semanticRecord, semanticRows, semanticText, sellerIban } from "@/lib/einvoice/semantic-read";
import { formatMoney } from "@/lib/purchase-invoices";

/** 2026-10-26 as 26 Oct 2026. Anything else is shown as it was sent. */
export function formatEDocumentDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function money(value: string) {
  return value ? formatMoney(value) || value : "";
}

function quantity(value: string) {
  return /^\d+\.\d+$/.test(value) ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function Party({ title, party, nameKey, addressKey, vatKey }: { title: string; party: Record<string, unknown> | null; nameKey: string; addressKey: string; vatKey: string }) {
  const address = semanticRecord(party?.[addressKey]);
  const lines = [
    semanticText(address?.["BT-35"]),
    semanticText(address?.["BT-36"]),
    semanticText(address?.["BT-162"]),
    [semanticText(address?.["BT-37"]), semanticText(address?.["BT-38"])].filter(Boolean).join(" "),
    semanticText(address?.["BT-39"]),
    semanticText(address?.["BT-40"]),
  ].filter(Boolean);
  const name = semanticText(party?.[nameKey]);
  const vat = semanticText(party?.[vatKey]);
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>{title}</div>
      <div className={view.body}>
        {name ? <p className={view.partyName}>{name}</p> : <p className={view.muted}>No name in the e-invoice.</p>}
        {lines.map((line, index) => (
          <p key={`${line}-${index}`}>{line}</p>
        ))}
        {vat ? <p className={view.muted}>VAT {vat}</p> : null}
      </div>
    </div>
  );
}

/** The stored invoice, read-only: facts, the two parties, the lines and the totals. */
export function EDocumentView({ semantic }: { semantic: Record<string, unknown> | null }) {
  if (!semantic) return <p className={styles.panelMeta}>This e-invoice has no stored invoice.</p>;
  const lines = semanticRows(semantic["BG-25"]);
  const taxes = semanticRows(semantic["BG-23"]);
  const totals = semanticRecord(semantic["BG-22"]);
  const currency = semanticText(semantic["BT-5"]);
  const iban = sellerIban(semantic);
  const facts = [
    ["Number", semanticText(semantic["BT-1"])],
    ["Issue date", formatEDocumentDate(semanticText(semantic["BT-2"]))],
    ["Due date", formatEDocumentDate(semanticText(semantic["BT-9"]))],
    ["Currency", currency],
    ["Buyer reference", semanticText(semantic["BT-10"])],
    ["Order number", semanticText(semantic["BT-13"])],
    ["Payment terms", semanticText(semantic["BT-20"])],
    ["Seller IBAN", iban],
  ].filter(([, value]) => value);

  return (
    <>
      <div className={styles.panel}>
        <div className={styles.panelHead}>Invoice</div>
        <dl className={view.facts}>
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className={view.pair}>
        <Party title="Seller" party={semanticRecord(semantic["BG-4"])} nameKey="BT-27" addressKey="BG-5" vatKey="BT-31" />
        <Party title="Buyer" party={semanticRecord(semantic["BG-7"])} nameKey="BT-44" addressKey="BG-8" vatKey="BT-48" />
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>Lines</div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Description</th>
              <th className={styles.numeric}>Qty</th>
              <th>Unit</th>
              <th className={styles.numeric}>Price</th>
              <th className={styles.numeric}>VAT %</th>
              <th className={styles.numeric}>Nett</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  No lines.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => (
                <tr key={`${semanticText(line["BT-126"])}-${index}`}>
                  <td>{semanticAt(line, "BG-31", "BT-153") || "Item"}</td>
                  <td className={styles.numeric}>{quantity(semanticText(line["BT-129"]))}</td>
                  <td>{semanticText(line["BT-130"])}</td>
                  <td className={styles.numeric}>{money(semanticAt(line, "BG-29", "BT-146"))}</td>
                  <td className={styles.numeric}>{quantity(semanticAt(line, "BG-30", "BT-152"))}</td>
                  <td className={styles.numeric}>{money(semanticText(line["BT-131"]))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <dl className={view.totals}>
          <dt>Nett</dt>
          <dd>{money(semanticAt(totals, "BT-109")) || "-"}</dd>
          {taxes.map((row, index) => (
            <FragmentRow
              key={index}
              label={`VAT ${quantity(semanticText(row["BT-119"]))}% on ${money(semanticText(row["BT-116"]))}`}
              value={money(semanticText(row["BT-117"]))}
            />
          ))}
          {taxes.length === 0 ? <FragmentRow label="VAT" value={money(semanticAt(totals, "BT-110")) || "-"} /> : null}
          <dt className={view.strong}>Total {currency}</dt>
          <dd className={view.strong}>{money(semanticAt(totals, "BT-112")) || "-"}</dd>
          <dt>Amount due</dt>
          <dd>{money(semanticAt(totals, "BT-115")) || "-"}</dd>
        </dl>
      </div>
      {iban ? <p className={styles.panelMeta}>The seller IBAN is not saved on the supplier.</p> : null}
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
