import type { SupabaseClient } from "@supabase/supabase-js";
import { emailAdapter, type EmailAdapter } from "./adapter";

type Queued = { id: string; recipient_email: string; recipient_name: string; subject: string; body: string; link_path: string };

/**
 * Hands the emails the person queued for a document to the adapter and records the result of each. A failure marks that
 * email failed and goes no further: the approval, the decision and posting never depend on it.
 */
export async function deliverQueuedEmails(supabase: SupabaseClient, headerId: string, origin: string, adapter: EmailAdapter = emailAdapter()) {
  const { data, error } = await supabase.rpc("queued_emails", { p_header_id: headerId });
  if (error) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const row of (data ?? []) as Queued[]) {
    let problem: string | null = null;
    try {
      const link = origin ? `${origin.replace(/\/$/, "")}${row.link_path}` : row.link_path;
      await adapter.send({ email: row.recipient_email, name: row.recipient_name }, row.subject, `${row.body}\n\nOpen it: ${link}`);
    } catch (thrown) {
      problem = (thrown instanceof Error && thrown.message ? thrown.message : "The email could not be sent").slice(0, 500);
    }
    await supabase.rpc("record_email_result", problem ? { p_id: row.id, p_error: problem } : { p_id: row.id });
    if (problem) failed += 1;
    else sent += 1;
  }
  return { sent, failed };
}
