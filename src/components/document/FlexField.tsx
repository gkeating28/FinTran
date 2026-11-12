"use client";

import { QuietInput } from "@/components/QuietField";
import styles from "@/components/OpsPage.module.css";

export function FlexField({
  index,
  label,
  value,
  disabled,
  onChange,
}: {
  index: number;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (update: (current: string[]) => string[]) => void;
}) {
  if (!label.trim()) return <div />;
  return (
    <label className={styles.field}>
      {label}
      <QuietInput
        name={`flex${index + 1}`}
        maxLength={200}
        disabled={disabled}
        value={value}
        onChange={(event) =>
          onChange((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
        }
      />
    </label>
  );
}
