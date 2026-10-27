"use server";

import { getWorkspace } from "@/lib/data";
import type { ReadinessItem } from "@/lib/purchase-invoices";
import { createClient } from "@/lib/supabase/server";

const HEADER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadTransactionReadiness(ids: string[]): Promise<Record<string, ReadinessItem[]>> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return {};

  const wanted = [...new Set(ids.filter((id) => HEADER_ID.test(id)))].slice(0, 500);
  if (wanted.length === 0) return {};

  const supabase = await createClient();
  const owned = await supabase
    .from("transaction_headers")
    .select("id")
    .eq("organisation_id", workspace.current.organisationId)
    .in("id", wanted);
  if (owned.error) return {};

  const entries = await Promise.all(
    (owned.data ?? []).map(async (header) => {
      const result = await supabase.rpc("en16931_readiness", { p_header_id: header.id });
      if (result.error) {
        return [
          header.id,
          [
            {
              ruleId: "FINTRAN",
              severity: "warning" as const,
              businessTerm: "BT-1",
              message: "Readiness could not be loaded.",
            },
          ],
        ] as const;
      }
      const readiness = (result.data ?? []).flatMap((item: { rule_id: string; severity: string; business_term: string; message: string }) => {
        const severity = item.severity === "error" || item.severity === "warning" ? item.severity : null;
        if (!severity) return [];
        return [
          {
            ruleId: item.rule_id,
            severity,
            businessTerm: item.business_term,
            message: item.message,
          },
        ];
      });
      return [header.id, readiness] as const;
    }),
  );

  return Object.fromEntries(entries);
}
