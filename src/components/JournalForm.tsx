"use client";

import { useState } from "react";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { SPLIT_MIN } from "@/components/document/shared";
import { useSplitLayout } from "@/components/document/useSplitLayout";
import { deleteJournal, postOpeningJournal, saveJournal } from "@/lib/ledger-actions";
import { EMPTY_LINE, fromCents, journalTotals, type ManualDraft, type ManualLine } from "@/lib/ledger";
import type { LedgerChoice, Named } from "@/lib/ledger-data";
import { formatMoney } from "@/lib/documents";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";

function codeLabel(row: { code: string; description: string }) {
  return row.description ? `${row.code} — ${row.description}` : row.code;
}

/**
 * A manual journal in the document shell: the header on the left, the lines on the right, the totals and the difference in the
 * status row, and the buttons along the bottom. The opening balance journal is the same form with its date fixed by go-live.
 */
export default function JournalForm({
  initial,
  glCodes,
  departments,
  costCentres,
  opening = false,
  openingDate = "",
  onClose,
  onDone,
}: {
  initial: ManualDraft;
  glCodes: LedgerChoice[];
  departments: Named[];
  costCentres: Named[];
  opening?: boolean;
  openingDate?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [draft, setDraft] = useState<ManualDraft>(initial);
  const [message, setMessage] = useState<{ tone: "alert" | "notice"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const { splitRef, headerWidth, sideBySide, splitStyle, splitMax, dragSplit, nudgeSplit } = useSplitLayout();
  const totals = journalTotals(draft.lines);
  const balanced = totals.difference === 0;

  function setLine(index: number, patch: Partial<ManualLine>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) }));
  }

  async function run(work: () => ReturnType<typeof saveJournal>) {
    setPending(true);
    setMessage(null);
    const result = await work();
    setPending(false);
    if (result.ok) {
      onDone(result.message ?? "Saved.");
      return;
    }
    // A draft that was saved but not posted keeps its id, so the next save replaces it instead of making another.
    if (result.id) setDraft((current) => ({ ...current, id: result.id ?? current.id }));
    setMessage({ tone: "alert", text: result.error });
  }

  async function remove() {
    if (!draft.id) return;
    setPending(true);
    const result = await deleteJournal(draft.id);
    setPending(false);
    if (result.ok) onDone(result.message ?? "Deleted.");
    else setMessage({ tone: "alert", text: result.error });
  }

  const title = opening ? "opening balance journal" : "journal";
  return (
    <FormModal title={draft.id ? `Edit ${title}` : `Add ${title}`} onClose={onClose} fillPage>
      <div className={styles.modalForm}>
        <form
          id="manual-journal"
          className={styles.documentFields}
          autoComplete="off"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => (opening ? postOpeningJournal(draft) : saveJournal(draft, false)));
          }}
        >
          <div className={styles.statusRow}>
            {message ? (
              <p className={message.tone === "alert" ? styles.alert : styles.notice} role={message.tone === "alert" ? "alert" : "status"} title={message.text}>
                {message.text}
              </p>
            ) : (
              <span />
            )}
            <p className={styles.panelMeta} aria-live="polite" data-testid="journal-totals">
              Debit {formatMoney(fromCents(totals.debit))}, credit {formatMoney(fromCents(totals.credit))},{" "}
              <strong data-balanced={balanced}>{balanced ? "balanced" : `out by ${formatMoney(fromCents(Math.abs(totals.difference)))}`}</strong>
            </p>
          </div>
          <div className={`${styles.invoiceSplit} ${sideBySide ? "" : styles.invoiceStacked}`} ref={splitRef} style={splitStyle}>
            <div className={styles.headerPane}>
              <div className={styles.partyFields}>
                <label className={styles.field}>
                  Date
                  {opening ? (
                    <QuietInput value={openingDate} readOnly />
                  ) : (
                    <input type="date" name="journal_date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
                  )}
                  {opening ? <small>The day before go-live.</small> : null}
                </label>
                <label className={`${styles.field} ${styles.wide}`}>
                  Description
                  <QuietInput name="journal_description" maxLength={200} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                </label>
                {opening ? (
                  <p className={`${styles.panelMeta} ${styles.wide}`}>
                    Enter the balances brought forward. Opening debtors and creditors are entered as ordinary documents dated before go-live, so this
                    journal cannot use the debtors or creditors control accounts. It is posted once.
                  </p>
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
                <span className={styles.paneLabel}>Lines ({draft.lines.length})</span>
                <button className={styles.primary} type="button" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { ...EMPTY_LINE }] })}>
                  Add line
                </button>
              </div>
              <div className={documentStyles.lineScroll}>
                <table className={styles.lineTable}>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>GL code</th>
                      <th className={styles.num}>Debit</th>
                      <th className={styles.num}>Credit</th>
                      <th>Department</th>
                      <th>Cost centre</th>
                      <th>Description</th>
                      <th className={styles.actions}>&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((line, index) => (
                      <tr key={index}>
                        <td className={styles.mono}>{index + 1}</td>
                        <td>
                          <select aria-label={`GL code, line ${index + 1}`} value={line.glCodeId} onChange={(event) => setLine(index, { glCodeId: event.target.value })}>
                            <option value="">Choose a GL code</option>
                            {glCodes.map((code) => (
                              <option key={code.id} value={code.id}>
                                {codeLabel(code)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={styles.num}>
                          <QuietInput
                            aria-label={`Debit, line ${index + 1}`}
                            className={styles.mono}
                            inputMode="decimal"
                            value={line.debit}
                            onChange={(event) => setLine(index, { debit: event.target.value, credit: event.target.value ? "" : line.credit })}
                          />
                        </td>
                        <td className={styles.num}>
                          <QuietInput
                            aria-label={`Credit, line ${index + 1}`}
                            className={styles.mono}
                            inputMode="decimal"
                            value={line.credit}
                            onChange={(event) => setLine(index, { credit: event.target.value, debit: event.target.value ? "" : line.debit })}
                          />
                        </td>
                        <td>
                          <select aria-label={`Department, line ${index + 1}`} value={line.departmentId} onChange={(event) => setLine(index, { departmentId: event.target.value })}>
                            <option value="">None</option>
                            {departments.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {codeLabel(entry)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select aria-label={`Cost centre, line ${index + 1}`} value={line.costCentreId} onChange={(event) => setLine(index, { costCentreId: event.target.value })}>
                            <option value="">None</option>
                            {costCentres.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {codeLabel(entry)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <QuietInput aria-label={`Description, line ${index + 1}`} maxLength={200} value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} />
                        </td>
                        <td className={styles.actions}>
                          <button
                            className={styles.quiet}
                            type="button"
                            aria-label={`Remove line ${index + 1}`}
                            disabled={draft.lines.length <= 2}
                            onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, at) => at !== index) })}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2}>Total</th>
                      <td className={`${styles.mono} ${styles.num}`}>{formatMoney(fromCents(totals.debit))}</td>
                      <td className={`${styles.mono} ${styles.num}`}>{formatMoney(fromCents(totals.credit))}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </form>
        <div className={styles.modalActions}>
          <div className={documentStyles.actionCluster}>
            {draft.id && !opening ? (
              <button className={styles.danger} type="button" disabled={pending} onClick={() => void remove()}>
                Delete
              </button>
            ) : null}
          </div>
          <div className={documentStyles.actionCluster}>
            <button className={styles.quiet} type="button" onClick={onClose}>
              Cancel
            </button>
            {opening ? (
              <button className={styles.primary} type="submit" form="manual-journal" disabled={pending || !balanced}>
                {pending ? "Posting…" : "Post opening balances"}
              </button>
            ) : (
              <>
                <button className={styles.quiet} type="submit" form="manual-journal" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </button>
                <button className={styles.primary} type="button" disabled={pending || !balanced} onClick={() => void run(() => saveJournal(draft, true))}>
                  Save and post
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </FormModal>
  );
}
