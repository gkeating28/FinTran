"use client";

import styles from "@/components/OpsPage.module.css";

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section>
      <h1 className={styles.heading}>This page could not be loaded</h1>
      <p className={styles.lede}>The organisation data did not come back. Try the page again.</p>
      <button className={styles.primary} type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
