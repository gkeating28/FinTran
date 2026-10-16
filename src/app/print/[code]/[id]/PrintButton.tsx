"use client";

import styles from "@/components/PrintForm.module.css";

export default function PrintButton() {
  return (
    <button className={styles.print} type="button" onClick={() => window.print()}>
      Print
    </button>
  );
}
