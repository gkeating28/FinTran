"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GRID_PAGE_SIZES, type GridPageSize } from "@/lib/grid-page";
import { formatInteger } from "@/lib/numbers";
import styles from "@/components/OpsPage.module.css";

const PAGE_OPTIONS: { value: GridPageSize; label: string }[] = [
  ...GRID_PAGE_SIZES.map((size) => ({ value: size, label: formatInteger(size) })),
  { value: "all", label: "All" },
];

type MenuPlace = {
  top: number;
  left: number;
  minWidth: number;
};

export default function GridPager({
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
  summary,
  className,
}: {
  page: number;
  pageCount: number;
  pageSize: GridPageSize;
  onPage: (page: number) => void;
  onPageSize: (pageSize: GridPageSize) => void;
  summary?: string;
  className?: string;
}) {
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;

  return (
    <div className={[styles.gridFooter, className].filter(Boolean).join(" ")}>
      <RowsPerPage pageSize={pageSize} onPageSize={onPageSize} />
      <div className={styles.pager}>
        {summary ? <span className="sr-only">{summary}</span> : null}
        <span aria-live="polite">
          Page {formatInteger(page + 1)} of {formatInteger(pageCount)}
        </span>
        <div className={styles.pageButtons}>
          <PageButton label="First page" disabled={atStart} onClick={() => onPage(0)}>
            <PageIcon name="first" />
          </PageButton>
          <PageButton label="Previous page" disabled={atStart} onClick={() => onPage(page - 1)}>
            <PageIcon name="previous" />
          </PageButton>
          <PageButton label="Next page" disabled={atEnd} onClick={() => onPage(page + 1)}>
            <PageIcon name="next" />
          </PageButton>
          <PageButton label="Last page" disabled={atEnd} onClick={() => onPage(Math.max(0, pageCount - 1))}>
            <PageIcon name="last" />
          </PageButton>
        </div>
      </div>
    </div>
  );
}

function RowsPerPage({
  pageSize,
  onPageSize,
}: {
  pageSize: GridPageSize;
  onPageSize: (pageSize: GridPageSize) => void;
}) {
  const labelId = useId();
  const valueId = useId();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<MenuPlace | null>(null);
  const selectedIndex = Math.max(0, PAGE_OPTIONS.findIndex((option) => option.value === pageSize));
  const shown = PAGE_OPTIONS[selectedIndex]?.label ?? "10";

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;

    function placeMenu() {
      if (!button || !menu) return;
      const rect = button.getBoundingClientRect();
      const menuHeight = menu.offsetHeight;
      const menuWidth = Math.max(rect.width, 148);
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const below = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;
      const top = below ? rect.bottom + gap : Math.max(8, rect.top - gap - menuHeight);
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - menuWidth - 8));
      setPlace({ top, left, minWidth: menuWidth });
    }

    placeMenu();
    window.addEventListener("resize", placeMenu);
    document.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      document.removeEventListener("scroll", placeMenu, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setActive(selectedIndex);
    setPlace(null);
    setOpen(true);
  }

  function choose(size: GridPageSize) {
    onPageSize(size);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setActive(selectedIndex);
        setPlace(null);
        setOpen(true);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => Math.min(PAGE_OPTIONS.length - 1, Math.max(0, index + delta)));
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActive(PAGE_OPTIONS.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setActive(selectedIndex);
        setPlace(null);
        setOpen(true);
        return;
      }
      const option = PAGE_OPTIONS[active];
      if (option) choose(option.value);
    }
  }

  function onKeyDownCapture(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          id={listId}
          className={styles.rowsMenu}
          role="listbox"
          aria-labelledby={labelId}
          style={
            place
              ? { top: place.top, left: place.left, minWidth: place.minWidth }
              : { top: 0, left: 0, minWidth: 148, visibility: "hidden" }
          }
        >
          {PAGE_OPTIONS.map((option, index) => {
            const selected = option.value === pageSize;
            return (
              <button
                key={option.label}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                className={styles.rowsOption}
                aria-selected={selected}
                data-active={index === active ? "true" : undefined}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                <span className={styles.rowsCheck} aria-hidden>
                  {selected ? <CheckIcon /> : null}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={styles.rowsPerPage} ref={rootRef}>
      <span id={labelId}>Rows per page</span>
      <button
        ref={buttonRef}
        type="button"
        className={styles.rowsButton}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="none"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={toggle}
        onKeyDown={onKeyDown}
        onKeyDownCapture={onKeyDownCapture}
      >
        <span id={valueId}>{shown}</span>
        <span className={styles.rowsChevron} aria-hidden>
          <ChevronIcon />
        </span>
      </button>
      {menu}
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.pageButton} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6.2 8 10.2 12 6.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 8.2 6.4 11.1 12.5 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PageIcon({ name }: { name: "first" | "previous" | "next" | "last" }) {
  const bar = name === "first" || name === "last";
  const left = name === "first" || name === "previous";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      {bar ? (
        <path
          d={name === "first" ? "M4.25 3.25v9.5" : "M11.75 3.25v9.5"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ) : null}
      <path
        d={left ? "M11.25 3.75 6.75 8l4.5 4.25" : "M4.75 3.75 9.25 8l-4.5 4.25"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
