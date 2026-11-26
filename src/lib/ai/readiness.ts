import type { SupabaseClient } from "@supabase/supabase-js";

/** The e-invoice readiness messages for one document, with what the ledger needs, split into what blocks a sales posting and what does not. */
export async function readinessMessages(supabase: SupabaseClient, headerId: string) {
  const [rules, ledger] = await Promise.all([
    supabase.rpc("en16931_readiness", { p_header_id: headerId }),
    supabase.rpc("ledger_readiness", { p_header_id: headerId }),
  ]);
  const rows = [...(rules.data ?? []), ...(ledger.data ?? [])] as { severity: string; message: string }[];
  return {
    errors: rows.filter((row) => row.severity === "error").map((row) => row.message),
    warnings: rows.filter((row) => row.severity === "warning").map((row) => row.message),
  };
}
