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
  const drawn = new Map<string, number>();
  for (let start = 0; start < lineIds.length; start += 200) {
    const taken = await supabase
      .from("transaction_lines")
      .select("source_line_id, quantity, transaction_headers!inner(status)")
      .eq("organisation_id", organisationId)
      .in("source_line_id", lineIds.slice(start, start + 200))
      .neq("transaction_headers.status", "void");
    for (const line of (taken.data ?? []) as Row[]) {
      const key = String(line.source_line_id);
      drawn.set(key, (drawn.get(key) ?? 0) + Number(line.quantity ?? 0));
    }
  }

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
