"use client";

import { LinkedDocumentsDialog } from "@/components/OrderDialogs";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { createCreditNote, postDocument, voidDocument } from "@/lib/document-actions";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { DOCUMENT_FORM } from "./shared";
import type { DocumentFormState } from "./useDocumentForm";

/** Asks for a reason, then voids a posted purchase document. */
export function VoidDialog({ form }: { form: DocumentFormState }) {
  const { header, typeCode, voidOpen, setVoidOpen, canVoidDocument } = form;
  return (
    voidOpen && canVoidDocument && header ? (
      <FormModal title="Void document" onClose={() => setVoidOpen(false)} className={styles.lineDialog}>
        <form className={styles.modalForm} action={voidDocument} autoComplete="off">
          <input type="hidden" name="id" value={header.id} />
          {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
          <p className={styles.panelMeta}>
            Voiding {header.transactionTypeCode} {header.documentNumber} cannot be undone. The document stays on record, marked void, with the reason you give.
          </p>
          <label className={styles.field}>
            Void reason
            <QuietInput name="reason" required maxLength={500} placeholder="Why this document is being voided" />
          </label>
          <div className={styles.modalActions}>
            <button className={styles.quiet} type="button" onClick={() => setVoidOpen(false)}>
              Cancel
            </button>
            <button className={styles.danger} type="submit">
              Void document
            </button>
          </div>
        </form>
      </FormModal>
    ) : null
  );
}

/** The credit notes raised from a posted sales invoice, and the form that raises another. */
export function CreditNotesDialog({ form }: { form: DocumentFormState }) {
  const { header, choices, typeCode, creditOpen, setCreditOpen, region, showCreditNote } = form;
  return (
    creditOpen && showCreditNote && header ? (
      <LinkedDocumentsDialog
        title="Credit notes"
        sources={[]}
        followOns={header.credits}
        followOnLabel="Credit notes for this invoice"
        region={region}
        note={
          choices.creditNoteTypes.length === 0
            ? "Add a Sales credit note type under Transaction types before raising a credit note."
            : `Remaining that can be credited: ${header.remainingAmount}`
        }
        create={
          choices.creditNoteTypes.length > 0 ? (
            <form action={createCreditNote} className={documentStyles.dialogCreate}>
              <input type="hidden" name="id" value={header.id} />
              {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
              {choices.creditNoteTypes.length > 1 ? (
                <label className={styles.field}>
                  Credit note type
                  <select name="credit_type_id" required defaultValue="">
                    <option value="">Choose a type</option>
                    {choices.creditNoteTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.code} — {type.description}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="credit_type_id" value={choices.creditNoteTypes[0]?.id ?? ""} />
              )}
              <div className={styles.modalActions}>
                <button className={styles.quiet} type="button" onClick={() => setCreditOpen(false)}>
                  Close
                </button>
                <button className={styles.primary} type="submit">
                  Create credit note
                </button>
              </div>
            </form>
          ) : undefined
        }
        onClose={() => setCreditOpen(false)}
      />
    ) : null
  );
}

/** Void, Credit notes and Linked documents. */
export function InvoiceActionButtons({ form }: { form: DocumentFormState }) {
  const { voidOpen, creditOpen, linksOpen, showLinks, showCreditNote, canVoidDocument, openPanel } = form;
  return (
    <>
      {canVoidDocument ? (
        <button className={styles.quiet} type="button" aria-expanded={voidOpen} onClick={() => openPanel("void")}>
          Void
        </button>
      ) : null}
      {showCreditNote ? (
        <button className={styles.quiet} type="button" aria-expanded={creditOpen} onClick={() => openPanel("credit")}>
          Credit notes
        </button>
      ) : null}
      {showLinks ? (
        <button className={styles.quiet} type="button" aria-expanded={linksOpen} onClick={() => openPanel("links")}>
          Linked documents
        </button>
      ) : null}
    </>
  );
}

/** Cancel or Close, Save and post, Post, and Save. */
export function SaveButtons({ form }: { form: DocumentFormState }) {
  const { header, typeCode, onClose, locked, pending, dirty, cannotSave, canPostHere } = form;
  return (
    <>
      <button className={styles.quiet} type="button" onClick={onClose}>
        {locked ? "Close" : "Cancel"}
      </button>
      {canPostHere && dirty ? (
        <button className={styles.quiet} type="submit" form={DOCUMENT_FORM} name="then_action" value="post" disabled={cannotSave}>
          Save and post
        </button>
      ) : null}
      {canPostHere && !dirty && header ? (
        <form action={postDocument}>
          <input type="hidden" name="id" value={header.id} />
          {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
          <button className={styles.quiet} type="submit">
            Post
          </button>
        </form>
      ) : null}
      {locked ? null : (
        <button className={styles.primary} type="submit" form={DOCUMENT_FORM} disabled={cannotSave}>
          {pending ? "Saving…" : "Save"}
        </button>
      )}
    </>
  );
}
