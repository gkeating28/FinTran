"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "@/components/OpsPage.module.css";
import lookupStyles from "@/components/Lookup.module.css";

const ROWS = 8;

type Place = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export type LookupOption = { value: string; label: string };

/**
 * A pick list with a search box, for lists too long for a plain select: Peppol schemes and GL codes. It posts its choice under
 * `name`. It is controlled when it has `value` and keeps its own choice when it has only `defaultValue`.
 */
export default function OptionLookup({
  options: all,
  name,
  value,
  defaultValue = "",
  onChange,
  label,
  searchLabel = `Search ${label.toLowerCase()}`,
  emptyText = "Nothing matches.",
  noneLabel = "None",
}: {
  options: LookupOption[];
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Names the list for assistive technology, such as "Peppol scheme". */
  label: string;
  searchLabel?: string;
  emptyText?: string;
  /** The label of the option that clears the choice. Null leaves it out. */
  noneLabel?: string | null;
}) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const [menuRoot, setMenuRoot] = useState<Element | null>(null);
  const [activeKey, setActiveKey] = useState("|false");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const matches = needle ? all.filter((option) => option.label.toLowerCase().includes(needle)) : all;
  const selected = all.find((option) => option.value === current);
  const ordered = !needle && selected ? [selected, ...matches.filter((option) => option.value !== selected.value)] : matches;
  const showNone = noneLabel !== null && (!needle || noneLabel.toLowerCase().startsWith(needle));
  const options = [...(showNone ? [{ value: "", label: noneLabel ?? "" }] : []), ...ordered];

  // The highlighted option goes back to the top whenever the search text or the menu changes.
  const nextActiveKey = `${query}|${open}`;
  if (nextActiveKey !== activeKey) {
    setActiveKey(nextActiveKey);
    setActive(0);
  }

  useLayoutEffect(() => {
    if (!open) return;
    function updatePlace() {
      const button = rootRef.current?.querySelector("button");
      if (!button) return;
      const buttonRect = button.getBoundingClientRect();
      const dialog = button.closest("dialog");
      const bounds = dialog?.getBoundingClientRect();
      const limitTop = bounds?.top ?? 8;
      const limitBottom = bounds?.bottom ?? window.innerHeight - 8;
      const spaceBelow = limitBottom - buttonRect.bottom - 8;
      const spaceAbove = buttonRect.top - limitTop - 8;
      const below = spaceBelow >= 220 || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(160, Math.min(320, below ? spaceBelow : spaceAbove));
      const top = below ? buttonRect.bottom + 4 : Math.max(limitTop, buttonRect.top - maxHeight - 4);
      const origin = dialog?.getBoundingClientRect();
      const pad = 16;
      const width = Math.max(buttonRect.width, 280);
      const left = dialog && origin
        ? Math.min(Math.max(pad, buttonRect.left - origin.left), Math.max(pad, dialog.clientWidth - width - pad))
        : buttonRect.left;
      setPlace({
        top: dialog && origin ? top - origin.top + dialog.scrollTop : top,
        left,
        width,
        maxHeight,
      });
    }
    updatePlace();
    window.addEventListener("resize", updatePlace);
    document.addEventListener("scroll", updatePlace, true);
    return () => {
      window.removeEventListener("resize", updatePlace);
      document.removeEventListener("scroll", updatePlace, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>("[data-active='true']");
    option?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(next: string) {
    setInner(next);
    onChange?.(next);
    setQuery("");
    setOpen(false);
  }

  const buttonLabel = selected ? selected.label : current || noneLabel || "";
  const menu =
    open && place && menuRoot
      ? createPortal(
          <div
            ref={menuRef}
            className={lookupStyles.lookupPopover}
            role="listbox"
            aria-label={label}
            style={{ top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight }}
          >
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((current) => Math.min(current + 1, Math.max(options.length - 1, 0)));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((current) => Math.max(current - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const option = options[active];
                  if (option) choose(option.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
              aria-label={searchLabel}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <div
              ref={listRef}
              className={lookupStyles.lookupList}
              style={{ maxHeight: Math.min(ROWS * 34, Math.max(place.maxHeight - 52, 34)) }}
            >
              {options.length === 0 ? <p className={lookupStyles.lookupEmpty}>{emptyText}</p> : null}
              {options.map((option, index) => {
                return (
                  <button
                    key={option.value || "none"}
                    type="button"
                    role="option"
                    title={option.label}
                    aria-selected={option.value === current}
                    data-active={index === active ? "true" : "false"}
                    className={`${lookupStyles.lookupOption} ${lookupStyles.lookupSchemeOption}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>,
          menuRoot,
        )
      : null;

  return (
    <div className={lookupStyles.lookup} ref={rootRef} data-lookup={name}>
      <input type="hidden" name={name} value={current} />
      <button
        type="button"
        className={styles.lookupButton}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          // The menu is drawn inside the surrounding dialog when there is one, so it stays on top of it.
          setMenuRoot(rootRef.current?.closest("dialog") ?? document.body);
          setOpen((current) => !current);
        }}
      >
        <span>{buttonLabel}</span>
      </button>
      {menu}
    </div>
  );
}
