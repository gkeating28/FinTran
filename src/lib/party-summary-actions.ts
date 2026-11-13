"use server";

import { loadOrderLineUsage } from "@/lib/order-data";
import { orderProgress } from "@/lib/order-progress";
import { OrganisationAccessError, requireCurrentOrganisation } from "@/lib/organisation-guard";
import type { PartyKind } from "@/lib/parties";
import { buildPartySummary, type PartyDocument, type PartyPayment, type PartySummary } from "@/lib/party-summary";
import { targetKindFor } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_STATUSES, isPaymentKind, parseTransactionTypeKind, type DocumentStatus } from "@/lib/transaction-types";

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
  const [paymentRows, { data, error }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, document_number, status, payment_date, amount, unallocated_amount, transaction_types!inner(code, type, document_kind)")
      .eq("organisation_id", current.organisationId)
      .eq(kind === "customers" ? "customer_id" : "supplier_id", id)
      .eq("status", "posted")
      .order("payment_date", { ascending: false })
      .limit(DOCUMENT_LIMIT),
    supabase
    .from("transaction_headers")
    .select("id, document_number, status, transaction_date, due_date, foreign_total_amount, amount_due, transaction_types!inner(code, document_kind)")
    .eq("organisation_id", current.organisationId)
    .eq(kind === "customers" ? "customer_id" : "supplier_id", id)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(DOCUMENT_LIMIT),
  ]);
  if (error || paymentRows.error) return null;

  const payments = ((paymentRows.data ?? []) as Row[]).flatMap((row): PartyPayment[] => {
    const type = one(row.transaction_types);
    const direction = parseTransactionTypeKind(String(type?.type ?? ""));
    const paymentKind = type?.document_kind;
    if (!type || !direction || !isPaymentKind(String(paymentKind))) return [];
    return [
      {
        id: String(row.id),
        typeCode: String(type.code ?? ""),
        number: String(row.document_number ?? ""),
        status: "posted",
        date: String(row.payment_date ?? ""),
        amount: Number(row.amount ?? 0),
        unallocated: Number(row.unallocated_amount ?? 0),
        settlesInvoices: targetKindFor(paymentKind as "payment" | "receipt", direction) === "invoice",
      },
    ];
  });

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
    const usage = await loadOrderLineUsage(supabase, current.organisationId, lineRows.map((line) => String(line.id)));
    const drawn = new Map([...usage].map(([id, used]) => [id, used.invoiced + used.reserved]));
    toInvoice = orderProgress(
      lineRows.map((line) => ({
        quantity: Number(line.quantity ?? 0),
        nett: Number(line.nett_amount ?? 0),
        drawn: drawn.get(String(line.id)) ?? 0,
      })),
    ).remaining;
  }

  return buildPartySummary(documents, new Date().toISOString().slice(0, 10), toInvoice, payments);
}
