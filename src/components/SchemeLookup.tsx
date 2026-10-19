"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CodeName } from "@/lib/code-lists";
import styles from "@/components/OpsPage.module.css";

const SCHEME_ROWS = 8;

type SchemePlace = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export default function SchemeLookup({
  schemes,
  value,
  onChange,
}: {
  schemes: CodeName[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<SchemePlace | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? schemes.filter((scheme) => `${scheme.code} ${scheme.name}`.toLowerCase().includes(needle))
    : schemes;
  const selected = schemes.find((scheme) => scheme.code === value);
  const ordered = !needle && selected ? [selected, ...matches.filter((scheme) => scheme.code !== selected.code)] : matches;
  const showNone = !needle || "none".startsWith(needle);
  const options = [...(showNone ? [{ code: "", name: "None" }] : []), ...ordered];
  const menuRoot = open ? rootRef.current?.closest("dialog") ?? document.body : null;

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
      const width = dialog ? Math.max(buttonRect.width, dialog.clientWidth - pad * 2) : Math.max(buttonRect.width, 720);
      const left = dialog ? pad + dialog.scrollLeft : buttonRect.left;
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
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>("[data-active='true']");
    option?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(code: string) {
    onChange(code);
    setQuery("");
    setOpen(false);
  }

  const buttonLabel = selected ? `${selected.code} — ${selected.name}` : value || "None";
  const menu =
    open && place && menuRoot
      ? createPortal(
          <div
            ref={menuRef}
            className={styles.lookupPopover}
            role="listbox"
            aria-label="Peppol scheme"
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
                  if (option) choose(option.code);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
              placeholder="Search schemes"
              aria-label="Search Peppol schemes"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <div
              ref={listRef}
              className={styles.lookupList}
              style={{ maxHeight: Math.min(SCHEME_ROWS * 34, Math.max(place.maxHeight - 52, 34)) }}
            >
              {options.length === 0 ? <p className={styles.lookupEmpty}>No schemes match.</p> : null}
              {options.map((option, index) => {
                const label = option.code ? `${option.code} — ${option.name}` : "None";
                return (
                  <button
                    key={option.code || "none"}
                    type="button"
                    role="option"
                    title={label}
                    aria-selected={option.code === value}
                    data-active={index === active ? "true" : "false"}
                    className={`${styles.lookupOption} ${styles.lookupSchemeOption}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option.code)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>,
          menuRoot,
        )
      : null;

  return (
    <div className={styles.lookup} ref={rootRef}>
      <input type="hidden" name="peppol_scheme" value={value} />
      <button
        type="button"
        className={styles.lookupButton}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{buttonLabel}</span>
      </button>
      {menu}
    </div>
  );
}
