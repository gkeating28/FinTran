import type { SupabaseClient } from "@supabase/supabase-js";
import { listOpenOrders, type OpenOrder } from "@/lib/order-data";

/** Things worth a person's attention, worked out from the documents with plain rules. No AI is involved. */
export type Insight = {
  id: string;
  tone: "attention" | "info";
  title: string;
  detail: string;
  href: string;
};

export type InsightDoc = {
  id: string;
  number: string;
  status: "draft" | "posted" | "void";
  direction: "Purchases" | "Sales";
  typeCode: string;
  party: string;
  partyId: string;
  date: string;
  dueDate: string | null;
  amountDue: number;
  total: number;
  supplierReference: string;
};

const DAY = 86_400_000;
const LARGE_FACTOR = 3;
const LARGE_MIN_PRIOR = 3;
const LARGE_MIN_AMOUNT = 1000;
const RECENT_DAYS = 30;
const DUE_SOON_DAYS = 7;

function days(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

function euro(value: number) {
  return `€${value.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(iso: string) {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : new Date(time).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function openHref(doc: InsightDoc) {
  return `/transactions/${doc.typeCode}?open=${doc.id}`;
}

/** Groups of documents that look like the same invoice entered twice: same party and amount, and the same supplier reference or date. */
export function findDuplicates(docs: InsightDoc[]) {
  const groups = new Map<string, InsightDoc[]>();
  for (const doc of docs) {
    if (doc.status === "void" || doc.total <= 0 || !doc.partyId) continue;
    const reference = doc.supplierReference.trim().toLowerCase();
    const key = `${doc.direction}|${doc.partyId}|${doc.total.toFixed(2)}|${reference ? `ref:${reference}` : `date:${doc.date}`}`;
    const group = groups.get(key) ?? [];
    group.push(doc);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/** Recent documents far above what the same party usually sends or is sent. */
export function findLargeInvoices(docs: InsightDoc[], today: string) {
  const byParty = new Map<string, InsightDoc[]>();
  for (const doc of docs) {
    if (doc.status === "void" || doc.total <= 0 || !doc.partyId) continue;
    const key = `${doc.direction}|${doc.partyId}`;
    const list = byParty.get(key) ?? [];
    list.push(doc);
    byParty.set(key, list);
  }
  const found: { doc: InsightDoc; average: number }[] = [];
  for (const list of byParty.values()) {
    const prior = list.filter((doc) => days(doc.date, today) > RECENT_DAYS);
    if (prior.length < LARGE_MIN_PRIOR) continue;
    const average = prior.reduce((sum, doc) => sum + doc.total, 0) / prior.length;
    for (const doc of list) {
      const age = days(doc.date, today);
      if (age < 0 || age > RECENT_DAYS) continue;
      if (doc.total >= LARGE_MIN_AMOUNT && doc.total > average * LARGE_FACTOR) found.push({ doc, average });
    }
  }
  return found.sort((a, b) => b.doc.total - a.doc.total);
}

export function findOverdue(docs: InsightDoc[], today: string) {
  return docs.filter((doc) => doc.status === "posted" && doc.amountDue > 0 && doc.dueDate && doc.dueDate < today);
}

export function findDueSoon(docs: InsightDoc[], today: string) {
  return docs.filter((doc) => {
    if (doc.status !== "posted" || doc.amountDue <= 0 || !doc.dueDate) return false;
    const left = days(today, doc.dueDate);
    return left >= 0 && left <= DUE_SOON_DAYS;
  });
}

export type NotReady = { id: string; number: string; direction: "Purchases" | "Sales"; typeCode: string; errors: string[] };

export function buildInsights(docs: InsightDoc[], notReady: NotReady[], today: string, openOrders: OpenOrder[] = []): Insight[] {
  const insights: Insight[] = [];

  const overdue = findOverdue(docs, today);
  if (overdue.length > 0) {
    const sales = overdue.filter((doc) => doc.direction === "Sales");
    const purchases = overdue.filter((doc) => doc.direction === "Purchases");
    const parts = [
      sales.length ? `${plural(sales.length, "sales document")} owed to you, ${euro(sales.reduce((sum, doc) => sum + doc.amountDue, 0))}` : "",
      purchases.length ? `${plural(purchases.length, "purchase document")} you owe, ${euro(purchases.reduce((sum, doc) => sum + doc.amountDue, 0))}` : "",
    ].filter(Boolean);
    const oldest = [...overdue].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
    insights.push({
      id: "overdue",
      tone: "attention",
      title: `${plural(overdue.length, "document")} past due`,
      detail: `${parts.join(" and ")}. The oldest is ${oldest.number} for ${oldest.party}, ${plural(days(oldest.dueDate ?? today, today), "day")} late.`,
      href: openHref(oldest),
    });
  }

  if (notReady.length > 0) {
    const first = notReady[0];
    insights.push({
      id: "not-ready",
      tone: "attention",
      title: `${plural(notReady.length, "draft")} cannot be sent as an e-invoice yet`,
      detail: `${first.number} needs: ${first.errors.slice(0, 2).join(" ")}${notReady.length > 1 ? ` The others have similar gaps.` : ""}`,
      href: `/transactions/${first.typeCode}?open=${first.id}`,
    });
  }

  const duplicates = findDuplicates(docs);
  if (duplicates.length > 0) {
    const group = duplicates[0];
    insights.push({
      id: "duplicates",
      tone: "attention",
      title: `${plural(duplicates.length, "possible duplicate")}`,
      detail: `${group.map((doc) => doc.number).join(" and ")} for ${group[0].party} have the same amount, ${euro(group[0].total)}, and the same ${group[0].supplierReference.trim() ? "supplier reference" : "date"}.`,
      href: openHref(group[0]),
    });
  }

  const large = findLargeInvoices(docs, today);
  if (large.length > 0) {
    const { doc, average } = large[0];
    insights.push({
      id: "large",
      tone: "info",
      title: `${plural(large.length, "unusually large document")}`,
      detail: `${doc.number} from ${doc.party} is ${euro(doc.total)}, more than ${LARGE_FACTOR} times their usual ${euro(average)}.`,
      href: openHref(doc),
    });
  }

  const soon = findDueSoon(docs, today);
  if (soon.length > 0) {
    const pay = soon.filter((doc) => doc.direction === "Purchases");
    const collect = soon.filter((doc) => doc.direction === "Sales");
    const parts = [
      pay.length ? `${euro(pay.reduce((sum, doc) => sum + doc.amountDue, 0))} to pay` : "",
      collect.length ? `${euro(collect.reduce((sum, doc) => sum + doc.amountDue, 0))} to collect` : "",
    ].filter(Boolean);
    const next = [...soon].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
    insights.push({
      id: "due-soon",
      tone: "info",
      title: `${plural(soon.length, "document")} due in the next ${DUE_SOON_DAYS} days`,
      detail: `${parts.join(" and ")}. The next is ${next.number} for ${next.party}, due ${shortDate(next.dueDate ?? today)}.`,
      href: openHref(next),
    });
  }

  const toInvoice = openOrders.filter((order) => order.state !== "full" && order.remaining > 0);
  if (toInvoice.length > 0) {
    const oldest = toInvoice[0];
    const part = toInvoice.filter((order) => order.state === "part").length;
    insights.push({
      id: "orders-to-invoice",
      tone: "info",
      title: `${plural(toInvoice.length, "open order")} still to invoice`,
      detail: `${euro(toInvoice.reduce((sum, order) => sum + order.remaining, 0))} nett is left on them${part ? `, and ${plural(part, "order")} ${part === 1 ? "is" : "are"} part invoiced` : ""}. The oldest is ${oldest.number} for ${oldest.party}, dated ${shortDate(oldest.date)}.`,
      href: `/transactions/${oldest.typeCode}?open=${oldest.id}`,
    });
  }

  const complete = openOrders.filter((order) => order.state === "full");
  if (complete.length > 0) {
    const first = complete[0];
    insights.push({
      id: "orders-to-close",
      tone: "info",
      title: `${plural(complete.length, "open order")} fully invoiced`,
      detail: `${first.number} for ${first.party} has nothing left to invoice${complete.length > 1 ? ", and so have the others" : ""}. ${complete.length === 1 ? "It" : "They"} can be closed.`,
      href: `/transactions/${first.typeCode}?open=${first.id}`,
    });
  }

  return insights;
}

type Row = Record<string, unknown>;

function embedded(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Row | undefined;
}

const READINESS_CHECKS = 10;

/** Reads the last year of documents and the readiness of the newest drafts, and returns what is worth a look. */
export async function getInsights(supabase: SupabaseClient, organisationId: string, today = new Date().toISOString().slice(0, 10)): Promise<Insight[]> {
  const since = new Date(Date.parse(today) - 365 * DAY).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("transaction_headers")
    .select("id, document_number, reference, status, party_name, supplier_id, customer_id, transaction_date, due_date, amount_due, home_total_amount, supplier_reference, transaction_types!inner(type, code, document_kind)")
    .eq("organisation_id", organisationId)
    .gte("transaction_date", since)
    .order("transaction_date", { ascending: false })
    .limit(3000);
  if (error) return [];

  const docs: InsightDoc[] = ((data ?? []) as Row[]).flatMap((row) => {
    const type = embedded(row.transaction_types);
    const status = row.status === "draft" || row.status === "posted" || row.status === "void" ? row.status : null;
    // Orders and requisitions are not financial documents, so the invoice rules leave them out.
    if (type?.document_kind === "order" || type?.document_kind === "requisition") return [];
    if (!status || (type?.type !== "Purchases" && type?.type !== "Sales")) return [];
    return [
      {
        id: String(row.id),
        number: String(row.document_number ?? row.reference ?? "Draft"),
        status,
        direction: type.type,
        typeCode: String(type.code ?? ""),
        party: String(row.party_name ?? ""),
        partyId: String(row.supplier_id ?? row.customer_id ?? ""),
        date: String(row.transaction_date ?? ""),
        dueDate: row.due_date ? String(row.due_date) : null,
        amountDue: Number(row.amount_due ?? 0),
        total: Number(row.home_total_amount ?? 0),
        supplierReference: String(row.supplier_reference ?? ""),
      },
    ];
  });

  const drafts = docs.filter((doc) => doc.status === "draft").slice(0, READINESS_CHECKS);
  const openOrders = listOpenOrders(supabase, organisationId);
  const checked = await Promise.all(
    drafts.map(async (draft): Promise<NotReady | null> => {
      const result = await supabase.rpc("en16931_readiness", { p_header_id: draft.id });
      const errors = ((result.data ?? []) as { severity: string; message: string }[]).filter((item) => item.severity === "error").map((item) => item.message);
      return errors.length ? { id: draft.id, number: draft.number, direction: draft.direction, typeCode: draft.typeCode, errors } : null;
    }),
  );
  return buildInsights(docs, checked.filter((item): item is NotReady => item !== null), today, (await openOrders).orders);
}
