"use client";

import { useEffect, useState } from "react";
import { GridLinesIcon } from "@/components/icons";
import styles from "@/components/OpsPage.module.css";

/** Which lines a grid draws. Rows only is the standard look. */
const GRID_LINES = ["rows", "both", "columns", "none"] as const;
export type GridLines = (typeof GRID_LINES)[number];

const LABEL: Record<GridLines, string> = {
  rows: "Row lines",
  both: "Row and column lines",
  columns: "Column lines",
  none: "No lines",
};

function storageKey(form: string) {
  return `fintran.grid-lines.${form}`;
}

/**
 * The grid lines choice for one grid, remembered in the browser under the grid's form name.
 * Put `lines` on the table as `data-lines` and `button` in the footer beside rows per page.
 */
export function useGridLines(form: string) {
  const [lines, setLines] = useState<GridLines>("rows");

  useEffect(() => {
    // Read after mount so the server and first client render agree.
    void Promise.resolve().then(() => {
      try {
        const saved = window.localStorage.getItem(storageKey(form));
        setLines(GRID_LINES.find((item) => item === saved) ?? "rows");
      } catch {
        // The choice is only a convenience.
      }
    });
  }, [form]);

  function next() {
    const chosen = GRID_LINES[(GRID_LINES.indexOf(lines) + 1) % GRID_LINES.length];
    setLines(chosen);
    try {
      window.localStorage.setItem(storageKey(form), chosen);
    } catch {
      // The choice is only a convenience.
    }
  }

  const button = (
    <div className={styles.exportMenu}>
      <button
        className={styles.quiet}
        type="button"
        onClick={next}
        aria-label={`Grid lines: ${LABEL[lines]}. Change`}
        title={`${LABEL[lines]}. Click to change.`}
      >
        <GridLinesIcon size={16} />
      </button>
    </div>
  );

  return { lines, button };
}
