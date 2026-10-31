"use client";

import { useId } from "react";
import { QuietInput } from "@/components/QuietField";
import { CODE_LOCKED_ERROR } from "@/lib/immutable-code";
import styles from "@/components/OpsPage.module.css";

export function CodeField({
  locked,
  value,
  onChange,
  maxLength,
  placeholder,
  autoFocus = false,
}: {
  locked: boolean;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const hintId = useId();

  return (
    <label className={styles.field}>
      Code
      <QuietInput
        name="code"
        required
        readOnly={locked}
        aria-describedby={locked ? hintId : undefined}
        maxLength={maxLength}
        autoFocus={autoFocus && !locked}
        value={value}
        onChange={locked ? undefined : (event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={locked ? `${styles.mono} ${styles.locked}` : styles.mono}
        style={{ textTransform: "uppercase" }}
      />
      {locked ? (
        <span id={hintId} className={styles.panelMeta}>
          {CODE_LOCKED_ERROR}
        </span>
      ) : null}
    </label>
  );
}
