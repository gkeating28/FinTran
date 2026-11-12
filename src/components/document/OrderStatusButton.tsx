"use client";

import ConfirmSubmitButton from "@/components/ConfirmDialog";
import { setOrderStatus } from "@/lib/document-actions";
import { DOCUMENT_FORM } from "./shared";

/** One button that opens, closes, reopens or cancels an order. */
export function OrderStatusButton({
  id,
  action,
  label,
  typeCode,
  confirm,
  className,
  saveFirst = false,
  disabled = false,
}: {
  id: string;
  action: "open" | "close" | "reopen" | "cancel";
  label: string;
  typeCode?: string;
  confirm?: { title: string; message: string };
  className: string;
  /** The open document has unsaved changes, so the button saves it first and then acts, in one step. */
  saveFirst?: boolean;
  disabled?: boolean;
}) {
  if (saveFirst) {
    // "Activate order" becomes "Save and activate order". The document form carries the action with it.
    const saveLabel = `Save and ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    return confirm ? (
      <ConfirmSubmitButton
        className={className}
        form={DOCUMENT_FORM}
        name="then_action"
        value={action}
        disabled={disabled}
        title={confirm.title}
        message={`Your changes are saved first. ${confirm.message}`}
        confirmLabel={saveLabel}
      >
        {saveLabel}
      </ConfirmSubmitButton>
    ) : (
      <button className={className} type="submit" form={DOCUMENT_FORM} name="then_action" value={action} disabled={disabled}>
        {saveLabel}
      </button>
    );
  }
  return (
    <form action={setOrderStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="order_action" value={action} />
      {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
      {confirm ? (
        <ConfirmSubmitButton className={className} title={confirm.title} message={confirm.message} confirmLabel={label}>
          {label}
        </ConfirmSubmitButton>
      ) : (
        <button className={className} type="submit">
          {label}
        </button>
      )}
    </form>
  );
}
