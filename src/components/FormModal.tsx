"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSetFormChrome } from "@/components/FormChrome";
import { CloseIcon } from "@/components/icons";
import styles from "@/components/OpsPage.module.css";

/**
 * The first control in a form that a person can type in or choose from. The app's text fields start read-only
 * (see QuietField) and become editable when touched, so a plain "not read-only" test would skip every one of them and
 * land on the first list. Locked fields, disabled ones, fields in a hidden tab and fields in a view-only form
 * (which switches pointer events off) are skipped.
 */
function firstEditable(root: HTMLElement) {
  const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input:not([type='hidden']), select, textarea",
  );
  for (const control of controls) {
    if (control.disabled || control.closest("[hidden]")) continue;
    const typed = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement;
    if (typed && control.readOnly && (control.dataset.quiet !== "true" || control.dataset.locked === "true")) continue;
    if (getComputedStyle(control).pointerEvents === "none") continue;
    return control;
  }
  return null;
}

export default function FormModal({
  title,
  onClose,
  children,
  className,
  fillPage = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  fillPage?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const setFormChrome = useSetFormChrome();
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!fillPage) return;
    setFormChrome({
      title,
      titleId,
      close: () => onCloseRef.current(),
    });
    return () => setFormChrome(null);
  }, [fillPage, setFormChrome, title, titleId]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    if (fillPage) dialog.show();
    else dialog.showModal();
    firstEditable(dialog)?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [fillPage]);

  useLayoutEffect(() => {
    if (!fillPage) return;
    const dialog = dialogRef.current;
    const page = document.querySelector("[data-app-page]");
    if (!dialog || !(page instanceof HTMLElement)) return;

    const place = () => {
      const rect = page.getBoundingClientRect();
      dialog.style.position = "fixed";
      dialog.style.top = `${rect.top}px`;
      dialog.style.left = `${rect.left}px`;
      dialog.style.right = "auto";
      dialog.style.bottom = "auto";
      dialog.style.width = `${rect.width}px`;
      dialog.style.height = `${rect.height}px`;
      dialog.style.margin = "0";
      dialog.style.maxWidth = "none";
      dialog.style.maxHeight = "none";
    };

    // The list underneath must not scroll while the form covers it.
    const pageOverflow = page.style.overflow;
    page.style.overflow = "hidden";

    place();
    const observer = new ResizeObserver(place);
    observer.observe(page);
    window.addEventListener("resize", place);
    return () => {
      page.style.overflow = pageOverflow;
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [fillPage]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!fillPage || event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("keydown", onKey);
    };
  }, [fillPage, onClose]);

  const dialogClass = [styles.dialog, fillPage ? styles.pageDialog : "", className].filter(Boolean).join(" ");

  return (
    <dialog
      ref={dialogRef}
      className={dialogClass}
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      {fillPage ? null : (
        <div className={styles.dialogHead}>
          <h2 id={titleId}>{title}</h2>
          <button className={styles.dialogClose} type="button" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
      )}
      {children}
    </dialog>
  );
}
