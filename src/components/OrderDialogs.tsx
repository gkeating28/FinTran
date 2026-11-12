"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import FormModal from "@/components/FormModal";
import { formatDate, type Region } from "@/lib/dates";
import { numberValue } from "@/lib/numbers";
import { formatMoney, type LinkedDocument, type OrderSource } from "@/lib/documents";
import { documentStatusLabel, type DocumentStatus } from "@/lib/transaction-types";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";

function statusTone(status: DocumentStatus) {
  if (status === "posted" || status === "closed") return "ready";
  if (status === "void" || status === "cancelled") return "error";
  if (status === "open") return "warning";
  return undefined;
}

function DocumentTable({ documents, region, onNavigate }: { documents: LinkedDocument[]; region: Region; onNavigate: () => void }) {
  return (
    <table className={styles.lineTable}>
      <thead>
        <tr>
          <th>Document</th>
          <th>Date</th>
          <th>Status</th>
          <th className={styles.num}>Total</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((item) => (
          <tr key={item.id}>
            <td className={styles.mono}>
              <Link href={`/transactions/${item.typeCode}?open=${item.id}`} onClick={onNavigate}>
                {item.typeCode} {item.documentNumber || "draft"}
              </Link>
            </td>
            <td>{formatDate(item.transactionDate, region)}</td>
            <td>
              <span className={documentStyles.statusTag} data-status={statusTone(item.status)}>
                {documentStatusLabel(item.status)}
              </span>
            </td>
            <td className={`${styles.mono} ${styles.num}`}>{item.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What a document was made from and what has been made from it, with the way to make the next one. */
export function LinkedDocumentsDialog({
  title = "Linked documents",
  sources,
  followOns,
  followOnLabel,
  region,
  note,
  create,
  onClose,
}: {
  title?: string;
  sources: LinkedDocument[];
  /** Null when this kind of document is not turned into another. */
  followOns: LinkedDocument[] | null;
  followOnLabel: string;
  region: Region;
  /** Why nothing can be created, when that is the case. */
  note?: string;
  /** The form that creates the next document, when one can be created. */
  create?: ReactNode;
  onClose: () => void;
}) {
  return (
    <FormModal title={title} onClose={onClose} className={styles.lineDialog}>
      <div className={styles.modalForm}>
        {sources.length > 0 ? (
          <section className={documentStyles.dialogSection}>
            <h3 className={styles.sectionLabel}>Created from</h3>
            <DocumentTable documents={sources} region={region} onNavigate={onClose} />
          </section>
        ) : null}
        {followOns ? (
          <section className={documentStyles.dialogSection}>
            <h3 className={styles.sectionLabel}>{followOnLabel}</h3>
            {followOns.length > 0 ? (
              <DocumentTable documents={followOns} region={region} onNavigate={onClose} />
            ) : (
              <p className={styles.panelMeta}>None yet.</p>
            )}
          </section>
        ) : null}
        {note ? <p className={styles.panelMeta}>{note}</p> : null}
        {create ?? (
          <div className={styles.modalActions}>
            <button className={styles.quiet} type="button" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </FormModal>
  );
}

/** Chooses lines from the active orders of one supplier or customer to bring into an invoice. */
export function BringInDialog({
  orders,
  takenLineIds,
  partyNoun,
  hasParty,
  region,
  onBringIn,
  onClose,
}: {
  orders: OrderSource[];
  /** Order lines already on this invoice. */
  takenLineIds: Set<string>;
  partyNoun: "supplier" | "customer";
  hasParty: boolean;
  region: Region;
  onBringIn: (chosen: { order: OrderSource; lineIds: Set<string> }[]) => void;
  onClose: () => void;
}) {
  const available = orders.flatMap((order) => order.lines.flatMap((line) => (line.id && !takenLineIds.has(line.id) ? [line.id] : [])));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(available));
  const count = available.filter((id) => chosen.has(id)).length;

  function toggle(ids: string[], on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  return (
    <FormModal title="Bring in from an order" onClose={onClose} className={styles.lineDialog}>
      <div className={styles.modalForm}>
        {!hasParty ? (
          <p className={styles.panelMeta}>Choose a {partyNoun} first.</p>
        ) : orders.length === 0 ? (
          <p className={styles.panelMeta}>This {partyNoun} has no active order with anything left to invoice.</p>
        ) : (
          <>
            <p className={styles.panelMeta}>
              Tick the lines to bring in. Each comes in with what is left on the order, and you can change the quantity afterwards for a part invoice.
            </p>
            {orders.map((order) => {
              const open = order.lines.flatMap((line) => (line.id && !takenLineIds.has(line.id) ? [line.id] : []));
              const allOn = open.length > 0 && open.every((id) => chosen.has(id));
              return (
                <section key={order.id} className={documentStyles.dialogSection}>
                  <label className={styles.checkLine}>
                    <input type="checkbox" checked={allOn} disabled={open.length === 0} onChange={(event) => toggle(open, event.target.checked)} />
                    <span className={documentStyles.dialogOrder}>
                      {order.typeCode} {order.documentNumber}
                    </span>
                    <span>{formatDate(order.transactionDate, region)}</span>
                  </label>
                  <table className={`${styles.lineTable} ${documentStyles.dialogPicks}`}>
                    <thead>
                      <tr>
                        <th aria-label="Bring in" />
                        <th>Description</th>
                        <th className={styles.num}>Left</th>
                        <th>Unit</th>
                        <th className={styles.num}>Price</th>
                        <th className={styles.num}>Nett</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.lines.map((line) => {
                        const id = line.id ?? "";
                        const taken = takenLineIds.has(id);
                        const whole = numberValue(line.quantity);
                        const share = whole > 0 ? numberValue(line.remainingQuantity) / whole : 1;
                        return (
                          <tr key={id}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Bring in ${line.description}`}
                                checked={!taken && chosen.has(id)}
                                disabled={taken}
                                onChange={(event) => toggle([id], event.target.checked)}
                              />
                            </td>
                            <td>
                              {line.description}
                              {taken ? <span className={documentStyles.lineHint}>On this invoice</span> : null}
                            </td>
                            <td className={`${styles.mono} ${styles.num}`}>{line.remainingQuantity}</td>
                            <td className={styles.mono}>{line.unitCode}</td>
                            <td className={`${styles.mono} ${styles.num}`}>{line.price}</td>
                            <td className={`${styles.mono} ${styles.num}`}>{formatMoney(Math.round(numberValue(line.nettAmount) * share * 100) / 100)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </>
        )}
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.primary}
            type="button"
            disabled={count === 0}
            onClick={() => onBringIn(orders.map((order) => ({ order, lineIds: chosen })))}
          >
            {count === 0 ? "Bring in" : `Bring in ${count} line${count === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </FormModal>
  );
}
