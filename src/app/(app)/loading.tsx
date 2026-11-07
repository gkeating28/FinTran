import styles from "@/components/OpsPage.module.css";
import skeletonStyles from "@/components/Skeleton.module.css";

/** Shown while a page in the app streams in, so a click gives feedback straight away. */
export default function Loading() {
  return (
    <section className={styles.stack} aria-busy="true" aria-label="Loading">
      <div>
        <div className={`${skeletonStyles.skeleton} ${skeletonStyles.skeletonTitle}`} />
        <div className={`${skeletonStyles.skeleton} ${skeletonStyles.skeletonLine}`} />
      </div>
      <div className={styles.panel}>
        <div className={styles.gridToolbar}>
          <div className={`${skeletonStyles.skeleton} ${skeletonStyles.skeletonSearch}`} />
        </div>
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className={skeletonStyles.skeletonRow}>
            <div className={`${skeletonStyles.skeleton} ${skeletonStyles.skeletonCell}`} />
            <div className={`${skeletonStyles.skeleton} ${skeletonStyles.skeletonCellWide}`} />
            <div className={`${skeletonStyles.skeleton} ${skeletonStyles.skeletonCell}`} />
          </div>
        ))}
      </div>
    </section>
  );
}
