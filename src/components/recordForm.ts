import type { CSSProperties } from "react";
import recordStyles from "@/components/RecordForm.module.css";

/** Gives a field an exact width (a CSS length) instead of the default. */
export function exact(w: string): CSSProperties {
  return { ["--w" as string]: w };
}

/** Puts a cell of a page form on its row in the left or the right column, so both sides of a row stay level. */
export function slot(side: "left" | "right", row: number, extra?: string) {
  return [recordStyles[side], recordStyles[`r${row}`], extra].filter(Boolean).join(" ");
}

/** A tall box that starts on a row and runs down a number of rows. */
export function tall(start: number, span: number): CSSProperties {
  return { ["--tall-start" as string]: start, ["--tall-span" as string]: span };
}
