import { createClient } from "@/lib/supabase/server";

export type HomeOverview = {
  draftDocuments: number | null;
  postedThisMonth: number | null;
  eDocumentsReady: number | null;
  eDocumentsNeedReview: number | null;
};

/** Counts for the home page. A count that could not be read is null, so the page shows a dash. */
export async function getHomeOverview(organisationId: string): Promise<HomeOverview> {
  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [drafts, posted, ready, review] = await Promise.all([
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
  ]);

  return {
    draftDocuments: drafts.error ? null : (drafts.count ?? 0),
    postedThisMonth: posted.error ? null : (posted.count ?? 0),
    eDocumentsReady: ready.error ? null : (ready.count ?? 0),
    eDocumentsNeedReview: review.error ? null : (review.count ?? 0),
  };
}
