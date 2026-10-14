import { getWorkspace } from "@/lib/data";
import {
  parseTransactionTypeKind,
  type TransactionTypeRow,
} from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";

export async function listTransactionTypes(): Promise<{
  rows: TransactionTypeRow[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_types")
    .select("id, code, description, last_reference, type, flex1_label, flex2_label, flex3_label, flex4_label, flex5_label")
    .eq("organisation_id", workspace.current.organisationId)
    .order("code");

  if (error) return { rows: [], error: "Transaction types could not be loaded." };

  return {
    rows: (data ?? []).flatMap((row) => {
      const type = parseTransactionTypeKind(row.type);
      if (!type) return [];
      return [
        {
          id: row.id,
          code: row.code,
          description: row.description,
          lastReference: row.last_reference,
          type,
          flexLabels: [
            row.flex1_label ?? "",
            row.flex2_label ?? "",
            row.flex3_label ?? "",
            row.flex4_label ?? "",
            row.flex5_label ?? "",
          ],
        },
      ];
    }),
    error: null,
  };
}
