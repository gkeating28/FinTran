import type { ApprovalRuleRow, ApprovalTypeChoice, ApproverRole } from "@/lib/approval-rules";
import { getOrganisationScope } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

/** The rules of the open organisation and the purchase invoice and order types they can be for. */
export async function listApprovalRules(): Promise<{
  rows: ApprovalRuleRow[];
  types: ApprovalTypeChoice[];
  error: string | null;
}> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { rows: [], types: [], error: null };

  const supabase = await createClient();
  const [rules, types] = await Promise.all([
    supabase
      .from("approval_rules")
      .select("id, transaction_type_id, amount, required_role, active")
      .eq("organisation_id", organisationId)
      .order("amount"),
    supabase
      .from("transaction_types")
      .select("id, code, description, document_kind")
      .eq("organisation_id", organisationId)
      .eq("type", "Purchases")
      .eq("is_system", false)
      .in("document_kind", ["invoice", "order"])
      .order("code"),
  ]);
  if (rules.error || types.error) return { rows: [], types: [], error: "Approval rules could not be loaded." };

  const choices: ApprovalTypeChoice[] = (types.data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    description: row.description,
    kind: row.document_kind === "order" ? "order" : "invoice",
  }));
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  const rows: ApprovalRuleRow[] = (rules.data ?? []).flatMap((row) => {
    const type = byId.get(row.transaction_type_id);
    if (!type) return [];
    return [
      {
        id: row.id,
        typeId: row.transaction_type_id,
        typeCode: type.code,
        typeDescription: type.description,
        kind: type.kind,
        amount: Number(row.amount).toFixed(2),
        role: (row.required_role === "owner" ? "owner" : "admin") as ApproverRole,
        active: row.active,
      },
    ];
  });
  rows.sort((a, b) => a.typeCode.localeCompare(b.typeCode) || Number(a.amount) - Number(b.amount));
  return { rows, types: choices, error: null };
}
