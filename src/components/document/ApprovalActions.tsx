"use client";

import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { approveDocument, rejectDocument, requestApproval } from "@/lib/approval-actions";
import styles from "@/components/OpsPage.module.css";
import { DOCUMENT_FORM } from "./shared";
import type { DocumentFormState } from "./useDocumentForm";

/** Request approval, Approve and Refuse, for a draft that needs approval before it can be posted or activated. */
export function ApprovalButtons({ form }: { form: DocumentFormState }) {
  const { header, typeCode, approval, approvalNeeded, dirty, cannotSave, setApprovalOpen } = form;
  if (!header || !approval || !approvalNeeded) return null;
  const returnTo = typeCode ? `/transactions/${typeCode}` : "";
  const canAsk = approval.state === "required" || approval.state === "rejected";
  return (
    <>
      {canAsk && dirty ? (
        <button className={styles.quiet} type="submit" form={DOCUMENT_FORM} name="then_action" value="request_approval" disabled={cannotSave}>
          Save and request approval
        </button>
      ) : null}
      {canAsk && !dirty ? (
        <form action={requestApproval}>
          <input type="hidden" name="id" value={header.id} />
          {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
          <button className={styles.quiet} type="submit">
            Request approval
          </button>
        </form>
      ) : null}
      {approval.state === "requested" && approval.canDecide && !dirty ? (
        <>
          <button className={styles.quiet} type="button" onClick={() => setApprovalOpen("reject")}>
            Refuse
          </button>
          <form action={approveDocument}>
            <input type="hidden" name="id" value={header.id} />
            {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
            <button className={styles.quiet} type="submit">
              Approve
            </button>
          </form>
        </>
      ) : null}
    </>
  );
}

/** Asks for the reason before a request is refused. */
export function RefuseDialog({ form }: { form: DocumentFormState }) {
  const { header, typeCode, approvalOpen, setApprovalOpen } = form;
  if (approvalOpen !== "reject" || !header) return null;
  return (
    <FormModal title="Refuse approval" onClose={() => setApprovalOpen(null)} className={styles.lineDialog}>
      <form className={styles.modalForm} action={rejectDocument} autoComplete="off">
        <input type="hidden" name="id" value={header.id} />
        {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
        <p className={styles.panelMeta}>The person who asked sees the reason and can change the document and ask again.</p>
        <label className={styles.field}>
          Reason
          <QuietInput name="reason" required maxLength={500} placeholder="Why this is refused" />
        </label>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={() => setApprovalOpen(null)}>
            Cancel
          </button>
          <button className={styles.danger} type="submit">
            Refuse
          </button>
        </div>
      </form>
    </FormModal>
  );
}
