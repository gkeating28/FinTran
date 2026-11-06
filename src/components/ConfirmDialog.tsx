"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "@/components/OpsPage.module.css";
import confirmStyles from "@/components/Confirm.module.css";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // Cancel is the safe default for a destructive question.
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancelEvent = (event: Event) => {
      event.preventDefault();
      onCancel();
    };
    dialog.addEventListener("cancel", onCancelEvent);
    return () => dialog.removeEventListener("cancel", onCancelEvent);
  }, [onCancel]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={confirmStyles.confirmDialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) onCancel();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={confirmStyles.confirmBody}>
        <h2 id={titleId} className={confirmStyles.confirmTitle}>
          {title}
        </h2>
        <p id={messageId} className={confirmStyles.confirmMessage}>
          {message}
        </p>
      </div>
      <div className={confirmStyles.confirmActions}>
        <button ref={cancelRef} className={styles.quiet} type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className={styles.danger} type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * A button inside a form that asks before it submits that form. It replaces the browser's
 * window.confirm so the question matches the rest of the app and can be read by screen readers.
 */
export default function ConfirmSubmitButton({
  message,
  title = "Remove this row?",
  confirmLabel = "Remove",
  className,
  children,
}: {
  message: ReactNode;
  title?: string;
  confirmLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={buttonRef} className={className} type="button" data-destructive="true" onClick={() => setAsking(true)}>
        {children}
      </button>
      {asking ? (
        <ConfirmDialog
          title={title}
          message={message}
          confirmLabel={confirmLabel}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            buttonRef.current?.form?.requestSubmit();
          }}
        />
      ) : null}
    </>
  );
}
