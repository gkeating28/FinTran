"use client";

import Link from "next/link";
import { useState } from "react";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { formatMoney } from "@/lib/documents";
import { SOURCE_LABELS, sourceHref, type EntryDetail } from "@/lib/ledger";
import { reverseJournal } from "@/lib/ledger-actions";
import styles from "@/components/OpsPage.module.css";

/** One entry with its lines. A posted manual journal can be reversed here, on a date on or after its own. */
export default function EntryView({
  entry,
  today,
  onClose,
  onEdit,
  onDone,
  onOpenEntry,
}: {
  entry: EntryDetail;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onDone: (message: string) => void;
  onOpenEntry: (id: string) => void;
}) {
  const [reversing, setReversing] = useState(false);
  const [date, setDate] = useState(today < entry.date ? entry.date : today);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const href = sourceHref(entry);
  const canReverse = entry.sourceType === "manual" && entry.status === "posted" && !entry.isOpening && !entry.reversal;
  const debit = entry.lines.reduce((sum, line) => sum + Math.round(line.debit * 100), 0) / 100;
  const credit = entry.lines.reduce((sum, line) => sum + Math.round(line.credit * 100), 0) / 100;

  async function reverse() {
    setPending(true);
    setError(null);
    const result = await reverseJournal(entry.id, date, text);
    setPending(false);
    if (result.ok) onDone(result.message ?? "Reversed.");
    else setError(result.error);
  }

  const label = entry.number ? `Journal ${entry.number}` : "Draft journal";
  return (
    <FormModal title={label} onClose={onClose}>
      <div className={styles.modalForm}>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <dl className={styles.partyFields}>
          <div className={styles.field}>
            <dt>Date</dt>
            <dd className={styles.mono}>{entry.date}</dd>
          </div>
          <div className={styles.field}>
            <dt>Source</dt>
            <dd>
              {SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}
              {entry.sourceRef ? `, ${entry.sourceRef}` : ""}
              {href ? (
                <>
                  {" "}
                  <Link href={href}>Open</Link>
                </>
              ) : null}
            </dd>
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <dt>Description</dt>
            <dd>{entry.description}</dd>
          </div>
          {entry.isOpening ? (
            <p className={`${styles.panelMeta} ${styles.wide}`}>This is the opening balance journal. It is dated the day before go-live and cannot be changed or reversed.</p>
          ) : null}
          {entry.reversal ? (
            <p className={`${styles.panelMeta} ${styles.wide}`}>
              Reversed by journal {entry.reversal.number}, dated {entry.reversal.date}.{" "}
              <button className={styles.quiet} type="button" onClick={() => onOpenEntry(entry.reversal?.id ?? "")}>
                Open it
              </button>
            </p>
          ) : null}
          {entry.reversesId ? (
            <p className={`${styles.panelMeta} ${styles.wide}`}>
              Reverses journal {entry.reversesNumber ?? ""}.{" "}
              <button className={styles.quiet} type="button" onClick={() => onOpenEntry(entry.reversesId ?? "")}>
                Open it
              </button>
            </p>
          ) : null}
        </dl>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Line</th>
                <th>Account</th>
                <th>Description</th>
                <th>Department</th>
                <th>Cost centre</th>
                <th className={styles.numeric}>Debit</th>
                <th className={styles.numeric}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => (
                <tr key={line.id}>
                  <td className={styles.mono}>{line.lineNumber}</td>
                  <td>
                    <Link href={`/ledger/accounts/${line.glCodeId}`}>
                      {line.code} {line.codeDescription}
                    </Link>
                  </td>
                  <td>{line.description}</td>
                  <td className={styles.mono}>{line.departmentCode}</td>
                  <td className={styles.mono}>{line.costCentreCode}</td>
                  <td className={`${styles.mono} ${styles.numeric}`}>{line.debit ? formatMoney(line.debit) : ""}</td>
                  <td className={`${styles.mono} ${styles.numeric}`}>{line.credit ? formatMoney(line.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total</td>
                <td className={`${styles.mono} ${styles.numeric}`}>{formatMoney(debit)}</td>
                <td className={`${styles.mono} ${styles.numeric}`}>{formatMoney(credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {reversing ? (
          <div className={styles.partyFields}>
            <label className={styles.field}>
              Reverse on
              <input type="date" name="reverse_date" value={date} min={entry.date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className={styles.field}>
              Description
              <QuietInput name="reverse_description" maxLength={200} value={text} placeholder={`Reversal: ${entry.description}`.slice(0, 200)} onChange={(event) => setText(event.target.value)} />
            </label>
          </div>
        ) : null}
        <div className={styles.modalActions}>
          <span className={styles.actionStart} />
          <button className={styles.quiet} type="button" onClick={onClose}>
            Close
          </button>
          {entry.status === "draft" ? (
            <button className={styles.primary} type="button" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {canReverse && !reversing ? (
            <button className={styles.primary} type="button" onClick={() => setReversing(true)}>
              Reverse
            </button>
          ) : null}
          {reversing ? (
            <button className={styles.primary} type="button" disabled={pending} onClick={() => void reverse()}>
              {pending ? "Reversing…" : "Reverse journal"}
            </button>
          ) : null}
        </div>
      </div>
    </FormModal>
  );
}
