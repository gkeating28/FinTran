import styles from "@/components/OpsPage.module.css";
import { semanticAt, semanticRecord, semanticRows, semanticText, sellerIban } from "@/lib/einvoice/semantic-read";

function partyLines(party: Record<string, unknown> | null, addressKey: string) {
  if (!party) return [];
  const address = semanticRecord(party[addressKey]);
  return [
    semanticText(party["BT-27"] || party["BT-44"]),
    semanticText(address?.["BT-35"]),
    semanticText(address?.["BT-36"]),
    semanticText(address?.["BT-162"]),
    [semanticText(address?.["BT-37"]), semanticText(address?.["BT-38"])].filter(Boolean).join(" "),
    semanticText(address?.["BT-40"]),
  ].filter(Boolean);
}

export function EDocumentBody({ semantic }: { semantic: Record<string, unknown> | null }) {
  if (!semantic) return <p className={styles.panelMeta}>This e-invoice has no stored invoice.</p>;
  const seller = semanticRecord(semantic["BG-4"]);
  const buyer = semanticRecord(semantic["BG-7"]);
  const lines = semanticRows(semantic["BG-25"]);
  const taxes = semanticRows(semantic["BG-23"]);
  const totals = semanticRecord(semantic["BG-22"]);
  const iban = sellerIban(semantic);
  const sellerAddress = partyLines(seller, "BG-5");
  const buyerAddress = partyLines(buyer, "BG-8");

  return (
    <div className={styles.stack}>
      <h2 className={styles.heading}>Invoice</h2>
      <p className={styles.panelMeta}>
        {[semanticText(semantic["BT-1"]), semanticText(semantic["BT-2"]), semanticText(semantic["BT-5"])].filter(Boolean).join(" · ")}
        {semanticText(semantic["BT-9"]) ? ` · due ${semanticText(semantic["BT-9"])}` : ""}
      </p>
      <div className={styles.addressColumns}>
        <div>
          <h3 className={styles.heading}>Seller</h3>
          {sellerAddress.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {semanticText(seller?.["BT-31"]) ? <p>VAT {semanticText(seller?.["BT-31"])}</p> : null}
        </div>
        <div>
          <h3 className={styles.heading}>Buyer</h3>
          {buyerAddress.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {semanticText(buyer?.["BT-48"]) ? <p>VAT {semanticText(buyer?.["BT-48"])}</p> : null}
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Price</th>
            <th>VAT</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4}>No lines.</td>
            </tr>
          ) : (
            lines.map((line) => {
              const tax = semanticRecord(line["BG-30"]);
              const item = semanticRecord(line["BG-31"]);
              const price = semanticRecord(line["BG-29"]);
              return (
                <tr key={semanticText(line["BT-126"])}>
                  <td>{semanticText(item?.["BT-153"]) || "Item"}</td>
                  <td>
                    {semanticText(line["BT-129"])} {semanticText(line["BT-130"])}
                  </td>
                  <td>{semanticText(price?.["BT-146"])}</td>
                  <td>
                    {semanticText(tax?.["BT-151"])} {semanticText(tax?.["BT-152"])}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {taxes.length ? (
        <ul>
          {taxes.map((row) => (
            <li key={`${semanticText(row["BT-118"])}-${semanticText(row["BT-119"])}`}>
              VAT {semanticText(row["BT-118"])} {semanticText(row["BT-119"])}: taxable {semanticText(row["BT-116"])}, tax{" "}
              {semanticText(row["BT-117"])}
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        Nett {semanticAt(totals, "BT-109") || "—"} · VAT {semanticAt(totals, "BT-110") || "—"} · Total{" "}
        {semanticAt(totals, "BT-112") || "—"} · Due {semanticAt(totals, "BT-115") || "—"}
      </p>
      {iban ? <p className={styles.panelMeta}>Seller IBAN {iban}. This account is not saved on the supplier.</p> : null}
      {semanticText(semantic["BT-20"]) ? <p>{semanticText(semantic["BT-20"])}</p> : null}
    </div>
  );
}
