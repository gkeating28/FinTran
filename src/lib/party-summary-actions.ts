"use server";

import { orderProgress } from "@/lib/order-progress";
import { OrganisationAccessError, requireCurrentOrganisation } from "@/lib/organisation-guard";
import type { PartyKind } from "@/lib/parties";
import { buildPartySummary, type PartyDocument, type PartySummary } from "@/lib/party-summary";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_STATUSES, type DocumentStatus } from "@/lib/transaction-types";

const PARTY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENT_LIMIT = 1000;

type Row = Record<string, unknown>;

function one(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Row | undefined;
}

/** What this organisation has done with one customer or supplier. Null when it could not be read. */
export async function loadPartySummary(kind: PartyKind, id: string): Promise<PartySummary | null> {
  if (!PARTY_ID.test(id)) return null;
  let current;
  try {
    current = await requireCurrentOrganisation();
  } catch (error) {
    if (error instanceof OrganisationAccessError) return null;
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("id, document_number, status, transaction_date, due_date, foreign_total_amount, amount_due, transaction_types!inner(code, document_kind)")
    .eq("organisation_id", current.organisationId)
    .eq(kind === "customers" ? "customer_id" : "supplier_id", id)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(DOCUMENT_LIMIT);
  if (error) return null;

  const documents = ((data ?? []) as Row[]).flatMap((row): PartyDocument[] => {
    const type = one(row.transaction_types);
    const status = DOCUMENT_STATUSES.find((item) => item === row.status) as DocumentStatus | undefined;
    if (!type || !status) return [];
    return [
      {
        id: String(row.id),
        typeCode: String(type.code ?? ""),
        kind: String(type.document_kind ?? ""),
        number: String(row.document_number ?? ""),
        status,
        date: String(row.transaction_date ?? ""),
        dueDate: row.due_date ? String(row.due_date) : null,
        total: Number(row.foreign_total_amount ?? 0),
        amountDue: Number(row.amount_due ?? 0),
      },
    ];
  });

  // What is left to invoice on this party's active orders, measured line by line.
  let toInvoice = 0;
  const activeOrders = documents.filter((document) => document.kind === "order" && document.status === "open").map((document) => document.id);
  if (activeOrders.length > 0) {
    const lines = await supabase
      .from("transaction_lines")
      .select("id, header_id, quantity, nett_amount")
      .eq("organisation_id", current.organisationId)
      .in("header_id", activeOrders.slice(0, 200));
    const lineRows = (lines.data ?? []) as Row[];
    const drawn = new Map<string, number>();
    const lineIds = lineRows.map((line) => String(line.id));
    for (let start = 0; start < lineIds.length; start += 200) {
      const taken = await supabase
        .from("transaction_lines")
        .select("source_line_id, quantity, transaction_headers!inner(status)")
        .eq("organisation_id", current.organisationId)
        .in("source_line_id", lineIds.slice(start, start + 200))
        .neq("transaction_headers.status", "void");
      for (const line of (taken.data ?? []) as Row[]) {
        const key = String(line.source_line_id);
        drawn.set(key, (drawn.get(key) ?? 0) + Number(line.quantity ?? 0));
      }
    }
    toInvoice = orderProgress(
      lineRows.map((line) => ({
        quantity: Number(line.quantity ?? 0),
        nett: Number(line.nett_amount ?? 0),
        drawn: drawn.get(String(line.id)) ?? 0,
      })),
    ).remaining;
  }

  return buildPartySummary(documents, new Date().toISOString().slice(0, 10), toInvoice);
}
