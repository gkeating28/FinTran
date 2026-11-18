"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import FormModal from "@/components/FormModal";
import styles from "@/components/OpsPage.module.css";
import { QuietInput } from "@/components/QuietField";
import { useRegion } from "@/components/useRegion";
import paymentStyles from "@/components/payment/Payment.module.css";
import { RemoveAllocationDialog } from "@/components/payment/PaymentDialogs";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/documents";
import { applyAllocations, loadDocumentPaymentsTab, type PaymentActionState } from "@/lib/payment-actions";
import {
  allocateOnDoubleTap,
  allocationTotals,
  distributeOldestFirst,
  parseAllocationAmount,
  supplierStatedPaidMessage,
  type DocumentAllocation,
  type DocumentPayments,
  type OpenItem,
} from "@/lib/payments";

/**
 * The tab sits inside the document's form, and a form cannot hold another. A dialog is drawn on the page body instead,
 * and its edits are kept from the document form, which would count them as changes to the document.
 */
function Outside({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      onInput={(event) => event.stopPropagation()}
      onChange={(event) => event.stopPropagation()}
      // React sends events from a portal up to the form the tab sits in, which would treat this form's submit as its own.
      onSubmit={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * What has settled a posted invoice or credit note: the receipts or payments applied to it, or, for a credit note, what it
 * was applied to. It only shows them. Receipts, payments and refunds are recorded on their own screens, and a credit note's
 * balance can be applied to an invoice from here. It reads its figures when it opens, and again after a change.
 */
export function PaymentsTab({ headerId, active }: { headerId: string; active: boolean }) {
  const region = useRegion();
  const [data, setData] = useState<DocumentPayments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [removing, setRemoving] = useState<DocumentAllocation | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    loadDocumentPaymentsTab(headerId).then((result) => {
      if (cancelled) return;
      setData(result.data);
      setError(result.error);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [headerId]);

  useEffect(() => {
    if (!active) return;
    return reload();
  }, [active, reload]);

  if (!loaded) return <p className={styles.panelMeta}>{error ?? "Loading payments…"}</p>;
  if (!data) return <p className={error ? styles.alert : styles.panelMeta}>{error ?? "Payments can be recorded once the document is posted."}</p>;

  const creditNote = data.kind === "credit_note";
  const open = Number(data.open);
  const effective = data.allocations.filter((item) => !item.removedAt);
  const removed = data.allocations.filter((item) => item.removedAt);
  const sales = data.direction === "Sales";
  // A sales invoice is settled by receipts, a purchase invoice by payments, and a credit note by being applied or refunded.
  const noun = creditNote ? "applied" : sales ? "receipt" : "payment";
  const statedPaid = supplierStatedPaidMessage(data.supplierStatedPaid, data.currencyCode);

  return (
    <div className={paymentStyles.itemsScroll}>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {statedPaid && open > 0 ? <p className={styles.notice}>{statedPaid}</p> : null}
      <table className={styles.lineTable} data-lines="both">
        <tbody>
          <tr>
            <th>Total</th>
            <td className={`${styles.num} ${styles.mono}`}>
              {data.total} {data.currencyCode}
            </td>
          </tr>
          <tr>
            <th>{creditNote ? "Applied" : "Paid"}</th>
            <td className={`${styles.num} ${styles.mono}`}>{data.paid}</td>
          </tr>
          <tr>
            <th>{creditNote ? "Balance" : "Open"}</th>
            <td className={`${styles.num} ${styles.mono}`}>{formatMoney(open)}</td>
          </tr>
        </tbody>
      </table>
      {open > 0 ? (
        <div className={styles.modalActions}>
          {creditNote && data.openInvoices.length > 0 ? (
            <button className={styles.primary} type="button" onClick={() => setApplying(true)}>
              Apply to an invoice
            </button>
          ) : null}
          {data.recordTypes.length > 0 ? (
            <p className={styles.panelMeta}>
              {creditNote ? "A refund is recorded on the " : sales ? "A receipt is recorded on the " : "A payment is recorded on the "}
              {data.recordTypes.map((type, index) => (
                <span key={type.id}>
                  {index > 0 ? " or " : ""}
                  <Link href={`/transactions/${type.code}`}>{type.description}</Link>
                </span>
              ))}{" "}
              screen.
            </p>
          ) : (
            <p className={styles.panelMeta}>Add a {creditNote ? "refund" : sales ? "receipt" : "payment"} type under Transactions to record one.</p>
          )}
        </div>
      ) : null}
      <p className={paymentStyles.subheading}>{creditNote ? "Applied and refunded" : sales ? "Receipts" : "Payments"}</p>
      <table className={styles.lineTable} data-lines="both">
        <thead>
          <tr>
            <th>{creditNote ? "Applied to or from" : sales ? "Receipt" : "Payment"}</th>
            <th>Date</th>
            <th className={styles.num}>Amount</th>
            <th className={styles.num}>Exchange difference</th>
            <th>By</th>
            <th className={styles.actions}>&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {effective.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.empty}>
                {creditNote ? "Nothing has been applied yet." : `No ${noun}s yet.`}
              </td>
            </tr>
          ) : (
            effective.map((item) => (
              <tr key={item.id}>
                <td className={styles.mono}>
                  {creditNote ? (item.role === "applied-to" ? "To " : "From ") : ""}
                  <OtherDocument item={item} />
                </td>
                <td>{formatDate(item.date, region)}</td>
                <td className={`${styles.num} ${styles.mono}`}>{item.amount}</td>
                <td className={`${styles.num} ${styles.mono}`}>{item.exchangeDifference}</td>
                <td>{item.byName ? `${item.byName}, ${formatDate(item.createdAt.slice(0, 10), region)}` : ""}</td>
                <td className={styles.actions}>
                  {item.role === "applied-to" ? (
                    <button className={styles.quiet} type="button" onClick={() => setRemoving(item)}>
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {removed.length > 0 ? (
        <>
          <p className={paymentStyles.subheading}>Removed</p>
          <table className={styles.lineTable} data-lines="both">
            <thead>
              <tr>
                <th>From or to</th>
                <th className={styles.num}>Amount</th>
                <th>Removed</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {removed.map((item) => (
                <tr key={item.id}>
                  <td className={styles.mono}>
                    {creditNote ? (item.role === "applied-to" ? "To " : "From ") : ""}
                    <OtherDocument item={item} />
                  </td>
                  <td className={`${styles.num} ${styles.mono}`}>{item.amount}</td>
                  <td>{[item.removedByName, formatDate(item.removedAt.slice(0, 10), region)].filter(Boolean).join(", ")}</td>
                  <td>{item.removalReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {applying ? (
        <Outside>
          <ApplyCreditNoteDialog
            data={data}
            onClose={() => setApplying(false)}
            onApplied={() => {
              setApplying(false);
              reload();
            }}
          />
        </Outside>
      ) : null}
      {removing ? (
        <Outside>
        <RemoveAllocationDialog
          allocation={{
            id: removing.id,
            documentId: removing.otherId,
            documentNumber: removing.otherNumber,
            documentDate: "",
            date: removing.date,
            amount: removing.amount,
            exchangeDifference: removing.exchangeDifference,
            pending: false,
            removedAt: "",
            removalReason: "",
            removedByName: "",
            byName: removing.byName,
          }}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            reload();
          }}
        />
        </Outside>
      ) : null}
    </div>
  );
}

/** The number of the receipt, payment or document on the other side, as a link to open it when it can be opened. */
function OtherDocument({ item }: { item: DocumentAllocation }) {
  const label = item.otherNumber || (item.otherKind === "payment" ? "payment" : "document");
  if (!item.otherTypeCode || !item.otherId) return <>{label}</>;
  return <Link href={`/transactions/${item.otherTypeCode}?open=${item.otherId}`}>{label}</Link>;
}

/** Applies what is left of a posted credit note to the party's open invoices. */
function ApplyCreditNoteDialog({ data, onClose, onApplied }: { data: DocumentPayments; onClose: () => void; onApplied: () => void }) {
  const [state, action, pending] = useActionState(applyAllocations, {} as PaymentActionState);
  const [boxes, setBoxes] = useState<Record<string, string>>({});
  const [tapMessage, setTapMessage] = useState<string | null>(null);
  useEffect(() => {
    if (state.message) onApplied();
  }, [state.message, onApplied]);

  const balance = Number(data.open);
  const typed = data.openInvoices.map((item) => parseAllocationAmount(boxes[item.id] ?? ""));
  const invalid = typed.some((value) => value === undefined);
  const totals = allocationTotals(balance, typed.map((value) => (typeof value === "number" ? value : 0)));
  /** A double tap on an invoice applies everything still open on it, if that fits in what is left of the balance. */
  function applyWhole(item: OpenItem, event: MouseEvent) {
    if ((event.target as HTMLElement).closest("input")) return;
    const own = parseAllocationAmount(boxes[item.id] ?? "");
    const result = allocateOnDoubleTap({
      open: Number(item.open),
      amount: balance,
      amountBlank: false,
      allocatedElsewhere: totals.allocated - (typeof own === "number" ? own : 0),
    });
    setTapMessage(result.kind === "refuse" ? result.message : null);
    if (result.kind === "allocate") setBoxes((current) => ({ ...current, [item.id]: result.box }));
  }

  const allocations = JSON.stringify(
    data.openInvoices.flatMap((item) => ((boxes[item.id] ?? "").trim() ? [{ targetHeaderId: item.id, amount: boxes[item.id] }] : [])),
  );

  return (
    <FormModal title="Apply to an invoice" onClose={onClose} className={styles.lineDialog}>
      <form className={styles.modalForm} action={action} autoComplete="off">
        <input type="hidden" name="credit_note_id" value={data.documentId} />
        <input type="hidden" name="allocations" value={allocations} />
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <p className={styles.panelMeta}>
          Balance to apply: {formatMoney(balance)} {data.currencyCode}.{" "}
          <button className={styles.quiet} type="button" onClick={() => setBoxes(distributeOldestFirst(data.openInvoices, balance))}>
            Allocate oldest first
          </button>{" "}
          <button className={styles.quiet} type="button" onClick={() => setBoxes({})}>
            Clear
          </button>
        </p>
        <p className={styles.panelMeta}>Double click an invoice to apply everything still open on it.</p>
        <div className={paymentStyles.itemsScroll}>
          <table className={styles.lineTable} data-lines="both">
            <thead>
              <tr>
                <th>Number</th>
                <th>Due</th>
                <th className={styles.num}>Open</th>
                <th className={styles.num}>Apply</th>
              </tr>
            </thead>
            <tbody>
              {data.openInvoices.map((item) => (
                <tr
                  key={item.id}
                  title="Double click to apply everything still open"
                  style={{ touchAction: "manipulation" }}
                  onMouseDown={(event) => {
                    // A second click is a double click, which would otherwise select the word under it.
                    if (event.detail > 1 && !(event.target as HTMLElement).closest("input")) event.preventDefault();
                  }}
                  onDoubleClick={(event) => applyWhole(item, event)}
                >
                  <td className={styles.mono}>{item.documentNumber}</td>
                  <td>{item.dueDate}</td>
                  <td className={`${styles.num} ${styles.mono}`}>{formatMoney(item.open)}</td>
                  <td className={styles.num}>
                    <QuietInput
                      inputMode="decimal"
                      aria-label={`Apply to ${item.documentNumber}`}
                      value={boxes[item.id] ?? ""}
                      onChange={(event) => setBoxes((current) => ({ ...current, [item.id]: event.target.value }))}
                      className={`${styles.mono} ${paymentStyles.allocateInput}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tapMessage ? (
          <p className={styles.alert} role="alert">
            {tapMessage}
          </p>
        ) : null}
        {invalid ? (
          <p className={styles.alert} role="alert">
            Enter each amount with at most 2 decimal places.
          </p>
        ) : totals.over ? (
          <p className={styles.alert} role="alert">
            That is more than the balance of the credit note.
          </p>
        ) : null}
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} type="submit" disabled={pending || invalid || totals.over || totals.allocated <= 0}>
            {pending ? "Applying…" : "Apply"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
