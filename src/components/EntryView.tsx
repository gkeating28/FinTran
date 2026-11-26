"use client";

import Link from "next/link";
import { useState } from "react";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { SPLIT_MIN } from "@/components/document/shared";
import { useSplitLayout } from "@/components/document/useSplitLayout";
import { formatMoney } from "@/lib/documents";
import { SOURCE_LABELS, sourceHref, type EntryDetail } from "@/lib/ledger";
import { reverseJournal } from "@/lib/ledger-actions";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";

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
  const { splitRef, headerWidth, sideBySide, splitStyle, splitMax, dragSplit, nudgeSplit } = useSplitLayout();
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
  const source = `${SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}${entry.sourceRef ? `, ${entry.sourceRef}` : ""}`;
  return (
    <FormModal title={label} onClose={onClose} fillPage>
      <div className={styles.modalForm}>
        <div className={styles.documentFields}>
          <div className={styles.statusRow}>
            {error ? (
              <p className={styles.alert} role="alert" title={error}>
                {error}
              </p>
            ) : (
              <span />
            )}
            <p className={styles.panelMeta}>
              {entry.status === "draft" ? "Draft" : "Posted"}, debit {formatMoney(debit)}, credit {formatMoney(credit)}
            </p>
          </div>
          <div className={`${styles.invoiceSplit} ${sideBySide ? "" : styles.invoiceStacked}`} ref={splitRef} style={splitStyle}>
            <div className={styles.headerPane}>
              <div className={styles.partyFields}>
                <label className={styles.field}>
                  Date
                  <QuietInput value={entry.date} readOnly />
                </label>
                <label className={styles.field}>
                  Source
                  <QuietInput value={source} readOnly />
                  {href ? <Link href={href}>Open the source</Link> : null}
                </label>
                <label className={`${styles.field} ${styles.wide}`}>
                  Description
                  <QuietInput value={entry.description} readOnly />
                </label>
                {entry.isOpening ? (
                  <p className={`${styles.panelMeta} ${styles.wide}`}>The opening balance journal. It is dated the day before go-live and cannot be changed or reversed.</p>
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
                {reversing ? (
                  <>
                    <label className={styles.field}>
                      Reverse on
                      <input type="date" name="reverse_date" value={date} min={entry.date} onChange={(event) => setDate(event.target.value)} />
                    </label>
                    <label className={`${styles.field} ${styles.wide}`}>
                      Reversal description
                      <QuietInput name="reverse_description" maxLength={200} value={text} placeholder={`Reversal: ${entry.description}`.slice(0, 200)} onChange={(event) => setText(event.target.value)} />
                    </label>
                  </>
                ) : null}
              </div>
            </div>
            <button
              className={styles.splitHandle}
              type="button"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize header and lines"
              aria-valuemin={SPLIT_MIN}
              aria-valuemax={splitMax}
              aria-valuenow={headerWidth ?? Math.round(splitMax / 2)}
              tabIndex={sideBySide ? 0 : -1}
              onPointerDown={dragSplit}
              onKeyDown={nudgeSplit}
            />
            <div className={styles.linesPane}>
              <div className={styles.gridToolbar}>
                <span className={styles.paneLabel}>Lines ({entry.lines.length})</span>
              </div>
              <div className={documentStyles.lineScroll}>
                <table className={styles.lineTable}>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Account</th>
                      <th className={styles.num}>Debit</th>
                      <th className={styles.num}>Credit</th>
                      <th>Department</th>
                      <th>Cost centre</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((line) => (
                      <tr key={line.id}>
                        <td className={styles.mono}>{line.lineNumber}</td>
                        <td>
                          <Link href={`/reports/trial-balance/${line.glCodeId}`}>
                            {line.code} {line.codeDescription}
                          </Link>
                        </td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.debit ? formatMoney(line.debit) : ""}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.credit ? formatMoney(line.credit) : ""}</td>
                        <td className={styles.mono}>{line.departmentCode}</td>
                        <td className={styles.mono}>{line.costCentreCode}</td>
                        <td>{line.description}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2}>Total</th>
                      <td className={`${styles.mono} ${styles.num}`}>{formatMoney(debit)}</td>
                      <td className={`${styles.mono} ${styles.num}`}>{formatMoney(credit)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.modalActions}>
          <div className={documentStyles.actionCluster} />
          <div className={documentStyles.actionCluster}>
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
      </div>
    </FormModal>
  );
}
