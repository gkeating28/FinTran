import { createClient } from "@/lib/supabase/server";

export type AuditEntry = {
  id: string;
  when: string;
  who: string;
  tableName: string;
  action: string;
  summary: string;
};

const TABLE_LABELS: Record<string, string> = {
  organisation_defaults: "Organisation",
  organisation_access: "Access",
  suppliers: "Supplier",
  customers: "Customer",
  vat_rates: "VAT rate",
  gl_codes: "GL code",
  currencies: "Currency",
  transaction_types: "Transaction type",
  transaction_headers: "Document",
};

export async function listAuditLog(organisationId: string): Promise<{ rows: AuditEntry[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, table_name, action, changed_by, changed_at, old_values, new_values")
    .eq("organisation_id", organisationId)
    .order("changed_at", { ascending: false })
    .limit(200);

  if (error) return { rows: [], error: "Change history could not be loaded." };

  const ids = [...new Set((data ?? []).map((row) => row.changed_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, display_name, email").in("id", ids);
    for (const profile of profiles ?? []) {
      names.set(profile.id, profile.display_name || profile.email);
    }
  }

  return {
    rows: (data ?? []).map((row) => ({
      id: String(row.id),
      when: row.changed_at,
      who: row.changed_by ? (names.get(row.changed_by) ?? "Unknown user") : "System",
      tableName: TABLE_LABELS[row.table_name] ?? row.table_name,
      action: row.action === "INSERT" ? "Added" : row.action === "DELETE" ? "Removed" : "Changed",
      summary: summarise(row.action, row.old_values, row.new_values),
    })),
    error: null,
  };
}

function summarise(action: string, oldValues: unknown, newValues: unknown) {
  const next = asRecord(newValues);
  const previous = asRecord(oldValues);
  const source = action === "DELETE" ? previous : next;
  const keys = Object.keys(source).slice(0, 6);
  if (keys.length === 0) return "";
  return keys
    .map((key) => {
      const label = key.replaceAll("_", " ");
      if (action === "UPDATE") return `${label}: ${show(previous[key])} → ${show(next[key])}`;
      return `${label}: ${show(source[key])}`;
    })
    .join("; ");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "blank";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "…";
}
