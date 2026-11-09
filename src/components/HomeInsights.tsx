import Link from "next/link";
import homeStyles from "@/components/Home.module.css";
import skeletonStyles from "@/components/Skeleton.module.css";
import { getInsights } from "@/lib/insights";
import { createClient } from "@/lib/supabase/server";

/** The "Worth a look" card. It reads a year of documents, so the home page streams it in after the rest. */
export default async function HomeInsights({ organisationId }: { organisationId: string }) {
  const supabase = await createClient();
  const insights = await getInsights(supabase, organisationId);

  return (
    <section className={homeStyles.card} aria-label="Worth a look">
      <div className={homeStyles.cardHead}>
        <h2 className={homeStyles.cardTitle}>Worth a look</h2>
        {insights.length > 0 ? <span className={homeStyles.cardMeta}>{insights.length}</span> : null}
      </div>
      {insights.length === 0 ? (
        <p className={homeStyles.empty}>Nothing needs attention. Past due documents, drafts that are not ready to send, possible duplicates and unusually large documents will show here.</p>
      ) : (
        <ul className={homeStyles.insights}>
          {insights.map((insight) => (
            <li key={insight.id}>
              <Link prefetch href={insight.href} className={homeStyles.insight} data-tone={insight.tone}>
                <span className={homeStyles.insightDot} aria-hidden="true" />
                <span className={homeStyles.insightText}>
                  <span className={homeStyles.insightTitle}>{insight.title}</span>
                  <span className={homeStyles.insightDetail}>{insight.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomeInsightsSkeleton() {
  return (
    <section className={homeStyles.card} aria-busy="true" aria-label="Worth a look">
      <h2 className={homeStyles.cardTitle}>Worth a look</h2>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={`${skeletonStyles.skeleton} ${skeletonStyles.skeletonCellWide}`} style={{ height: 44, width: "100%" }} />
      ))}
    </section>
  );
}
