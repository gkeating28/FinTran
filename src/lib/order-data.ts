import type { SupabaseClient } from "@supabase/supabase-js";
import { orderProgress, type OrderProgress } from "@/lib/order-progress";

/** An open order with how far it has been invoiced. Amounts are nett, in the home currency. */
export type OpenOrder = {
  id: string;
  number: string;
  typeCode: string;
  direction: "Purchases" | "Sales";
  party: string;
  date: string;
  ordered: number;
  invoiced: number;
  remaining: number;
  state: OrderProgress["state"];
};

type Row = Record<string, unknown>;

const ORDER_LIMIT = 500;

function one(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Row | undefined;
}

export type OrderLineUsage = { invoiced: number; reserved: number };

/**
 * How much of each order line is used, from the `order_line_usage` view, which is the one place the rule lives.
 * Invoiced is posted invoice quantity less returned credit quantity. Reserved is draft invoice quantity.
 * Pass line ids to read only those lines, or none for every order line of the organisation.
 */
export async function loadOrderLineUsage(supabase: SupabaseClient, organisationId: string, lineIds?: string[]): Promise<Map<string, OrderLineUsage>> {
  const usage = new Map<string, OrderLineUsage>();
  const read = async (ids?: string[]) => {
    let query = supabase.from("order_line_usage").select("line_id, invoiced, reserved").eq("organisation_id", organisationId);
    if (ids) query = query.in("line_id", ids);
    const { data } = await query;
    for (const row of (data ?? []) as Row[]) {
      usage.set(String(row.line_id), { invoiced: Number(row.invoiced ?? 0), reserved: Number(row.reserved ?? 0) });
    }
  };
  if (!lineIds) await read();
  else for (let start = 0; start < lineIds.length; start += 200) await read(lineIds.slice(start, start + 200));
  return usage;
}

/** Reads the open orders of an organisation, oldest first, with what is invoiced and what is left on each. */
export async function listOpenOrders(supabase: SupabaseClient, organisationId: string): Promise<{ orders: OpenOrder[]; truncated: boolean }> {
  const { data, error } = await supabase
    .from("transaction_headers")
    .select(
      "id, document_number, party_name, transaction_date, exchange_rate, transaction_types!inner(type, code, document_kind), transaction_lines!transaction_lines_header_id_fkey(id, quantity, nett_amount)",
    )
    .eq("organisation_id", organisationId)
    .eq("status", "open")
    .eq("transaction_types.document_kind", "order")
    .order("transaction_date")
    .limit(ORDER_LIMIT);
  if (error) return { orders: [], truncated: false };

  const headers = (data ?? []) as Row[];
  const lineIds = headers.flatMap((header) => ((header.transaction_lines as Row[] | null) ?? []).map((line) => String(line.id)));
  const usage = await loadOrderLineUsage(supabase, organisationId, lineIds);
  const drawn = new Map([...usage].map(([id, used]) => [id, used.invoiced + used.reserved]));

  const orders = headers.flatMap((header): OpenOrder[] => {
    const type = one(header.transaction_types);
    if (type?.type !== "Purchases" && type?.type !== "Sales") return [];
    const rate = Number(header.exchange_rate) > 0 ? Number(header.exchange_rate) : 1;
    const progress = orderProgress(
      ((header.transaction_lines as Row[] | null) ?? []).map((line) => ({
        quantity: Number(line.quantity ?? 0),
        nett: Number(line.nett_amount ?? 0) / rate,
        drawn: drawn.get(String(line.id)) ?? 0,
      })),
    );
    return [
      {
        id: String(header.id),
        number: String(header.document_number ?? ""),
        typeCode: String(type.code ?? ""),
        direction: type.type,
        party: String(header.party_name ?? ""),
        date: String(header.transaction_date ?? ""),
        ordered: progress.ordered,
        invoiced: progress.invoiced,
        remaining: progress.remaining,
        state: progress.state,
      },
    ];
  });
  return { orders, truncated: headers.length >= ORDER_LIMIT };
}

/** An order a person closed that still has quantity nobody has invoiced. */
export type ClosedOrderLeft = { id: string; number: string; typeCode: string; party: string; left: number };

/** A draft invoice that draws on an active order, and so holds some of its quantity. */
export type HoldingDraft = { id: string; number: string; typeCode: string; party: string; created: string; held: number };

/**
 * Orders closed by hand that still have something left to invoice. An order the system closed reopens by itself, so
 * only hand-closed ones can be left like this.
 */
export async function listClosedOrdersWithQuantityLeft(supabase: SupabaseClient, organisationId: string): Promise<ClosedOrderLeft[]> {
  const { data } = await supabase
    .from("transaction_headers")
    .select("id, document_number, party_name, transaction_types!inner(code, document_kind)")
    .eq("organisation_id", organisationId)
    .eq("status", "closed")
    .eq("closed_by_system", false)
    .eq("transaction_types.document_kind", "order")
    .order("transaction_date")
    .limit(ORDER_LIMIT);
  const headers = (data ?? []) as Row[];
  if (headers.length === 0) return [];
  const left = new Map<string, number>();
  const ids = headers.map((header) => String(header.id));
  for (let start = 0; start < ids.length; start += 200) {
    const usage = await supabase.from("order_line_usage").select("header_id, remaining").eq("organisation_id", organisationId).in("header_id", ids.slice(start, start + 200)).gt("remaining", 0);
    for (const row of (usage.data ?? []) as Row[]) left.set(String(row.header_id), (left.get(String(row.header_id)) ?? 0) + Number(row.remaining ?? 0));
  }
  return headers.flatMap((header) => {
    const quantity = left.get(String(header.id)) ?? 0;
    return quantity > 0 ? [{ id: String(header.id), number: String(header.document_number ?? ""), typeCode: String(one(header.transaction_types)?.code ?? ""), party: String(header.party_name ?? ""), left: quantity }] : [];
  });
}

/** Every draft invoice that draws on an active order, oldest first, with the quantity it holds. */
export async function listDraftsHoldingOrders(supabase: SupabaseClient, organisationId: string): Promise<HoldingDraft[]> {
  const { data } = await supabase
    .from("transaction_lines")
    .select("quantity, source_line_id, transaction_headers!transaction_lines_header_id_fkey!inner(id, document_number, reference, party_name, created_at, status, transaction_types(code, document_kind))")
    .eq("organisation_id", organisationId)
    .not("source_line_id", "is", null)
    .eq("transaction_headers.status", "draft")
    .limit(2000);
  const lines = ((data ?? []) as Row[]).filter((line) => one(one(line.transaction_headers)?.transaction_types)?.document_kind === "invoice");
  if (lines.length === 0) return [];
  // Only quantity held on an order that is still active matters.
  const sourceIds = [...new Set(lines.map((line) => String(line.source_line_id)))];
  const active = new Set<string>();
  for (let start = 0; start < sourceIds.length; start += 200) {
    const sources = await supabase
      .from("transaction_lines")
      .select("id, transaction_headers!transaction_lines_header_id_fkey!inner(status)")
      .eq("organisation_id", organisationId)
      .in("id", sourceIds.slice(start, start + 200))
      .eq("transaction_headers.status", "open");
    for (const row of (sources.data ?? []) as Row[]) active.add(String(row.id));
  }
  const drafts = new Map<string, HoldingDraft>();
  for (const line of lines) {
    if (!active.has(String(line.source_line_id))) continue;
    const header = one(line.transaction_headers);
    if (!header) continue;
    const id = String(header.id);
    const draft = drafts.get(id) ?? {
      id,
      number: String(header.document_number ?? header.reference ?? "") || "Draft",
      typeCode: String(one(header.transaction_types)?.code ?? ""),
      party: String(header.party_name ?? ""),
      created: String(header.created_at ?? ""),
      held: 0,
    };
    draft.held += Number(line.quantity ?? 0);
    drafts.set(id, draft);
  }
  return [...drafts.values()].sort((left, right) => left.created.localeCompare(right.created));
}
