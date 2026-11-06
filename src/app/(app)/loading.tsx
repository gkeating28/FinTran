import styles from "@/components/OpsPage.module.css";

/** Shown while a page in the app streams in, so a click gives feedback straight away. */
export default function Loading() {
  return (
    <section className={styles.stack} aria-busy="true" aria-label="Loading">
      <div>
        <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
      </div>
      <div className={styles.panel}>
        <div className={styles.gridToolbar}>
          <div className={`${styles.skeleton} ${styles.skeletonSearch}`} />
        </div>
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className={styles.skeletonRow}>
            <div className={`${styles.skeleton} ${styles.skeletonCell}`} />
            <div className={`${styles.skeleton} ${styles.skeletonCellWide}`} />
            <div className={`${styles.skeleton} ${styles.skeletonCell}`} />
          </div>
        ))}
      </div>
    </section>
  );
}
