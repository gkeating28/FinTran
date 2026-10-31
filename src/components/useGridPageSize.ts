"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_GRID_PAGE_SIZE,
  gridRowsStorageKey,
  parseGridPageSize,
  type GridPageSize,
} from "@/lib/grid-page";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith("fintran.form.")) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readGridPageSize(form: string, fallback: GridPageSize) {
  try {
    return parseGridPageSize(window.localStorage.getItem(gridRowsStorageKey(form)), fallback);
  } catch {
    return fallback;
  }
}

function writeGridPageSize(form: string, size: GridPageSize) {
  try {
    window.localStorage.setItem(gridRowsStorageKey(form), size === "all" ? "all" : String(size));
  } catch {
    // The choice still applies for this view when storage is blocked.
  }
  emit();
}

export function useGridPageSize(form: string, fallback: GridPageSize = DEFAULT_GRID_PAGE_SIZE) {
  const pageSize = useSyncExternalStore(
    subscribe,
    () => readGridPageSize(form, fallback),
    () => fallback,
  );
  const setPageSize = useCallback(
    (size: GridPageSize) => {
      writeGridPageSize(form, size);
    },
    [form],
  );
  return [pageSize, setPageSize] as const;
}
