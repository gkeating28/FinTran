import { createClient } from "@/lib/supabase/server";

export type HomeOverview = {
  draftDocuments: number | null;
  postedThisMonth: number | null;
  eDocumentsReady: number | null;
  eDocumentsNeedReview: number | null;
  /** Documents posted in each of the last six weeks, oldest first. A week that could not be read is null. */
  weeklyPosted: { label: string; count: number | null }[];
};

const WEEKS = 6;

/** Monday 00:00 UTC of the week that holds the date. */
function weekStart(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

/** Counts for the home page. A count that could not be read is null, so the page shows a dash. */
export async function getHomeOverview(organisationId: string): Promise<HomeOverview> {
  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const thisWeek = weekStart(new Date());
  const weeks = Array.from({ length: WEEKS }, (_, index) => {
    const from = new Date(thisWeek);
    from.setUTCDate(from.getUTCDate() - 7 * (WEEKS - 1 - index));
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 7);
    return { from, to };
  });
  const weekly = Promise.all(
    weeks.map(({ from, to }) =>
      supabase
        .from("transaction_headers")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .eq("status", "posted")
        .gte("posted_at", from.toISOString())
        .lt("posted_at", to.toISOString()),
    ),
  );

  const [drafts, posted, ready, review, weeklyResults] = await Promise.all([
    supabase
      .from("transaction_headers")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("status", "draft"),
    supabase
      .from("transaction_headers")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("status", "posted")
      .gte("posted_at", monthStart.toISOString()),
    supabase
      .from("e_documents")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("direction", "inbound")
      .eq("status", "valid"),
    supabase
      .from("e_documents")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("direction", "inbound")
      .in("status", ["duplicate", "invalid"]),
    weekly,
  ]);

  return {
    draftDocuments: drafts.error ? null : (drafts.count ?? 0),
    postedThisMonth: posted.error ? null : (posted.count ?? 0),
    eDocumentsReady: ready.error ? null : (ready.count ?? 0),
    eDocumentsNeedReview: review.error ? null : (review.count ?? 0),
    weeklyPosted: weeklyResults.map((result, index) => ({
      label: weeks[index].from.toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" }),
      count: result.error ? null : (result.count ?? 0),
    })),
  };
}
