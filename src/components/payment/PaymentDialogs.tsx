"use client";

import { useActionState, useEffect } from "react";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { removeAllocation, voidPayment, type PaymentActionState } from "@/lib/payment-actions";
import type { AllocationLine, PaymentRow } from "@/lib/payments";
import styles from "@/components/OpsPage.module.css";

/** Asks for a reason, then voids a posted payment. Every allocation it made is removed with the same reason. */
export function VoidPaymentDialog({ payment, noun, onClose, onVoided }: { payment: PaymentRow; noun: string; onClose: () => void; onVoided: () => void }) {
  const [state, action, pending] = useActionState(voidPayment, {} as PaymentActionState);
  useEffect(() => {
    if (state.message) onVoided();
  }, [state.message, onVoided]);
  return (
    <FormModal title={`Void ${noun}`} onClose={onClose} className={styles.lineDialog}>
      <form className={styles.modalForm} action={action} autoComplete="off">
        <input type="hidden" name="id" value={payment.id} />
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <p className={styles.panelMeta}>
          Voiding {payment.documentNumber} cannot be undone. It stays on record, marked void, and every document it paid is open again.
        </p>
        <label className={styles.field}>
          Void reason
          <QuietInput name="reason" required maxLength={500} placeholder={`Why this ${noun} is being voided`} />
        </label>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.danger} type="submit" disabled={pending}>
            {pending ? "Voiding…" : `Void ${noun}`}
          </button>
        </div>
      </form>
    </FormModal>
  );
}

/** Asks for a reason, then removes one allocation. The row stays on record with the reason. */
export function RemoveAllocationDialog({ allocation, onClose, onRemoved }: { allocation: AllocationLine; onClose: () => void; onRemoved: () => void }) {
  const [state, action, pending] = useActionState(removeAllocation, {} as PaymentActionState);
  useEffect(() => {
    if (state.message) onRemoved();
  }, [state.message, onRemoved]);
  return (
    <FormModal title="Remove allocation" onClose={onClose} className={styles.lineDialog}>
      <form className={styles.modalForm} action={action} autoComplete="off">
        <input type="hidden" name="allocation_id" value={allocation.id} />
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <p className={styles.panelMeta}>
          Removing {allocation.amount} from {allocation.documentNumber} makes it due again. The allocation stays on record with the reason you give.
        </p>
        <label className={styles.field}>
          Reason
          <QuietInput name="reason" required maxLength={500} placeholder="Why this allocation is being removed" />
        </label>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.danger} type="submit" disabled={pending}>
            {pending ? "Removing…" : "Remove allocation"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
