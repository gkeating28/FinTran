"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useSetFormChrome } from "@/components/FormChrome";
import styles from "@/components/OpsPage.module.css";

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
    dialog
      .querySelector<HTMLElement>(
        "input:not([type='hidden']):not([readonly]):not(:disabled), select:not(:disabled), textarea:not([readonly]):not(:disabled)",
      )
      ?.focus();
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
            ×
          </button>
        </div>
      )}
      {children}
    </dialog>
  );
}
