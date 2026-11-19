import { agedBasis, agedDate, buildAged, type AgedDirection, type AgedItem, type AgedReport } from "@/lib/aged";
import { getOrganisationScope } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const LIMIT = 5000;

type Row = Record<string, unknown>;

function embedded(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Row | undefined;
}

/**
 * What is owed by customers (Sales) or to suppliers (Purchases), from posted documents with something still due and from
 * posted receipts or payments with something not yet applied, all in the home currency. Balances are as they stand now;
 * the ageing date only moves the line between "not yet due" and the late bands.
 */
export async function getAgedReport(direction: AgedDirection, asOfParam?: string, basisParam?: string): Promise<{ report: AgedReport; truncated: boolean; error: string | null }> {
  const asOf = agedDate(asOfParam);
  const basis = agedBasis(basisParam);
  const empty = buildAged([], asOf, basis);
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { report: empty, truncated: false, error: null };

  const supabase = await createClient();
  const [documents, payments] = await Promise.all([
    supabase
      .from("transaction_headers")
      .select("id, document_number, reference, party_name, supplier_id, customer_id, transaction_date, due_date, home_amount_due, transaction_types!inner(type, code, document_kind)")
      .eq("organisation_id", organisationId)
      .eq("status", "posted")
      .neq("home_amount_due", 0)
      .eq("transaction_types.type", direction)
      .limit(LIMIT),
    supabase
      .from("payments")
      .select("id, document_number, payment_date, party_name, supplier_id, customer_id, home_unallocated_amount, transaction_types!inner(type, code, document_kind)")
      .eq("organisation_id", organisationId)
      .eq("status", "posted")
      .gt("home_unallocated_amount", 0)
      .eq("transaction_types.type", direction)
      .limit(LIMIT),
  ]);
  if (documents.error || payments.error) return { report: empty, truncated: false, error: "The report could not be loaded." };

  const items: AgedItem[] = [];
  for (const row of (documents.data ?? []) as Row[]) {
    const type = embedded(row.transaction_types);
    const kind = type?.document_kind;
    if (kind !== "invoice" && kind !== "credit_note") continue;
    const amount = Number(row.home_amount_due ?? 0);
    items.push({
      id: String(row.id),
      kind: kind === "credit_note" ? "credit_note" : "invoice",
      typeCode: String(type?.code ?? ""),
      number: String(row.document_number ?? row.reference ?? "Draft"),
      partyId: String(row.supplier_id ?? row.customer_id ?? ""),
      party: String(row.party_name ?? ""),
      date: String(row.transaction_date ?? ""),
      dueDate: row.due_date ? String(row.due_date) : null,
      // A credit note's amount due is the balance it still has to give, which reduces what is owed.
      amount: kind === "credit_note" ? -amount : amount,
    });
  }
  for (const row of (payments.data ?? []) as Row[]) {
    const type = embedded(row.transaction_types);
    if (type?.document_kind !== "payment" && type?.document_kind !== "receipt") continue;
    items.push({
      id: String(row.id),
      kind: "on_account",
      typeCode: String(type?.code ?? ""),
      number: String(row.document_number ?? "Payment"),
      partyId: String(row.supplier_id ?? row.customer_id ?? ""),
      party: String(row.party_name ?? ""),
      date: String(row.payment_date ?? ""),
      dueDate: null,
      amount: -Number(row.home_unallocated_amount ?? 0),
    });
  }
  const truncated = (documents.data?.length ?? 0) >= LIMIT || (payments.data?.length ?? 0) >= LIMIT;
  return { report: buildAged(items, asOf, basis), truncated, error: null };
}
