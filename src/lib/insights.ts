import type { SupabaseClient } from "@supabase/supabase-js";
import { listClosedOrdersWithQuantityLeft, listDraftsHoldingOrders, listOpenOrders, type ClosedOrderLeft, type HoldingDraft, type OpenOrder } from "@/lib/order-data";

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
  /** What has been applied to it by payments and credit notes. */
  paidAmount: number;
  total: number;
  supplierReference: string;
  /** An invoice, or a credit note, whose amount due is the balance it still has to give. */
  kind: "invoice" | "credit_note";
  currencyCode: string;
};

/** A posted payment or receipt with money left that is not applied to any document. */
export type InsightPayment = {
  id: string;
  number: string;
  typeCode: string;
  /** Sales for money from customers, Purchases for money to suppliers. */
  direction: "Purchases" | "Sales";
  /** payment is money paid out, receipt is money received. */
  kind: "payment" | "receipt";
  party: string;
  partyId: string;
  date: string;
  currencyCode: string;
  unallocated: number;
};

const DAY = 86_400_000;
const LARGE_FACTOR = 3;
const LARGE_MIN_PRIOR = 3;
const LARGE_MIN_AMOUNT = 1000;
const RECENT_DAYS = 30;
const DUE_SOON_DAYS = 7;
/** Money left on account for longer than this is flagged. */
export const ON_ACCOUNT_DAYS = 7;
/** A draft invoice older than this that still holds order quantity is flagged. */
export const STALE_DRAFT_DAYS = 14;

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
  // A credit note's amount due is the balance it still has to give, so it is never overdue.
  return docs.filter((doc) => doc.status === "posted" && doc.kind === "invoice" && doc.amountDue > 0 && doc.dueDate && doc.dueDate < today);
}

export function findDueSoon(docs: InsightDoc[], today: string) {
  return docs.filter((doc) => {
    if (doc.status !== "posted" || doc.kind !== "invoice" || doc.amountDue <= 0 || !doc.dueDate) return false;
    const left = days(today, doc.dueDate);
    return left >= 0 && left <= DUE_SOON_DAYS;
  });
}

function money(value: number, currencyCode: string) {
  return `${currencyCode ? `${currencyCode} ` : "€"}${value.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cents(value: number) {
  return Math.round(value * 100);
}

/** Money that has sat on account for more than a week: posted payments, and posted credit notes with a balance. */
export type OnAccountItem = { id: string; number: string; typeCode: string; party: string; date: string; currencyCode: string; amount: number; credit: boolean };

export function findMoneyOnAccount(docs: InsightDoc[], payments: InsightPayment[], today: string): OnAccountItem[] {
  const fromPayments = payments
    .filter((payment) => payment.unallocated > 0)
    .map((payment) => ({ id: payment.id, number: payment.number, typeCode: payment.typeCode, party: payment.party, date: payment.date, currencyCode: payment.currencyCode, amount: payment.unallocated, credit: false }));
  const fromCreditNotes = docs
    .filter((doc) => doc.status === "posted" && doc.kind === "credit_note" && doc.amountDue > 0)
    .map((doc) => ({ id: doc.id, number: doc.number, typeCode: doc.typeCode, party: doc.party, date: doc.date, currencyCode: doc.currencyCode, amount: doc.amountDue, credit: true }));
  return [...fromPayments, ...fromCreditNotes]
    .filter((item) => item.date && days(item.date, today) > ON_ACCOUNT_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Invoices past due that have had something applied to them but are not settled. */
export function findPartPaidOverdue(docs: InsightDoc[], today: string) {
  return docs.filter((doc) => doc.status === "posted" && doc.kind === "invoice" && doc.amountDue > 0 && doc.paidAmount > 0 && doc.dueDate && doc.dueDate < today);
}

/**
 * Unallocated money that equals what is open on exactly one invoice of the same party and currency. Money received from
 * a customer is matched to that customer's sales invoices, and money paid to a supplier to that supplier's purchase invoices.
 */
export function findLikelyMatches(docs: InsightDoc[], payments: InsightPayment[]) {
  const found: { payment: InsightPayment; invoice: InsightDoc }[] = [];
  for (const payment of payments) {
    if (payment.unallocated <= 0 || !payment.partyId) continue;
    const settlesInvoices = (payment.kind === "receipt" && payment.direction === "Sales") || (payment.kind === "payment" && payment.direction === "Purchases");
    if (!settlesInvoices) continue;
    const candidates = docs.filter(
      (doc) =>
        doc.status === "posted" &&
        doc.kind === "invoice" &&
        doc.direction === payment.direction &&
        doc.partyId === payment.partyId &&
        doc.currencyCode === payment.currencyCode &&
        cents(doc.amountDue) === cents(payment.unallocated),
    );
    if (candidates.length === 1) found.push({ payment, invoice: candidates[0] });
  }
  return found;
}

/** What needs a look on orders beyond the open ones: orders closed by hand with quantity left, and drafts holding quantity. */
export type OrderWatch = { closedWithLeft: ClosedOrderLeft[]; holdingDrafts: HoldingDraft[] };

function quantity(value: number) {
  return value.toLocaleString("en-IE", { maximumFractionDigits: 4 });
}

/** Draft invoices more than 14 days old that draw on an active order, oldest first. */
export function findStaleDrafts(drafts: HoldingDraft[], today: string) {
  return drafts.filter((draft) => draft.created && days(draft.created.slice(0, 10), today) > STALE_DRAFT_DAYS);
}

/** A draft purchase document waiting for this person to decide, or one of theirs that was refused. */
export type ApprovalQueueItem = {
  id: string;
  state: "waiting" | "refused";
  typeCode: string;
  number: string;
  party: string;
  amount: number;
  requestedAt: string;
  note: string;
  decidedBy: string;
  /** A document, a payment or a payment run. Missing means a document. */
  kind?: "document" | "payment" | "run";
};

function approvalHref(item: ApprovalQueueItem) {
  return item.kind === "run" ? `/payment-runs?open=${item.id}` : `/transactions/${item.typeCode}?open=${item.id}`;
}

/** Worth a look for approvals: what waits on this person, oldest first, and what was refused to them. */
export function buildApprovalInsights(items: ApprovalQueueItem[]): Insight[] {
  const insights: Insight[] = [];
  const waiting = items.filter((item) => item.state === "waiting");
  if (waiting.length > 0) {
    const oldest = [...waiting].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];
    insights.push({
      id: "approvals-waiting",
      tone: "attention",
      title: `${plural(waiting.length, waiting.every((item) => (item.kind ?? "document") === "document") ? "document" : "item")} waiting for your approval`,
      detail: `The oldest is ${oldest.kind === "run" ? "payment run" : oldest.typeCode} ${oldest.number} for ${oldest.party || "no supplier"}, ${euro(oldest.amount)}, asked for ${shortDate(oldest.requestedAt)}. Open it to approve or refuse it.`,
      href: approvalHref(oldest),
    });
  }
  const refused = items.filter((item) => item.state === "refused");
  if (refused.length > 0) {
    const first = refused[0];
    insights.push({
      id: "approvals-refused",
      tone: "attention",
      title: `${plural(refused.length, refused.every((item) => (item.kind ?? "document") === "document") ? "document" : "item")} refused approval`,
      detail: `${first.kind === "run" ? "Payment run" : first.typeCode} ${first.number} for ${first.party || "no supplier"} was refused${first.decidedBy ? ` by ${first.decidedBy}` : ""}: ${first.note || "no reason was given"}. Change it and ask again, or delete it.`,
      href: approvalHref(first),
    });
  }
  return insights;
}

export type NotReady = { id: string; number: string; direction: "Purchases" | "Sales"; typeCode: string; errors: string[] };

export function buildInsights(
  docs: InsightDoc[],
  notReady: NotReady[],
  today: string,
  openOrders: OpenOrder[] = [],
  watch: OrderWatch = { closedWithLeft: [], holdingDrafts: [] },
  payments: InsightPayment[] = [],
  approvals: ApprovalQueueItem[] = [],
): Insight[] {
  const insights: Insight[] = buildApprovalInsights(approvals);

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

  const partPaid = findPartPaidOverdue(docs, today);
  if (partPaid.length > 0) {
    const oldest = [...partPaid].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
    insights.push({
      id: "part-paid-overdue",
      tone: "attention",
      title: `${plural(partPaid.length, "invoice")} part paid and past due`,
      detail: `${oldest.number} for ${oldest.party} has ${money(oldest.paidAmount, oldest.currencyCode)} paid and ${money(oldest.amountDue, oldest.currencyCode)} still due, ${plural(days(oldest.dueDate ?? today, today), "day")} late.`,
      href: openHref(oldest),
    });
  }

  const onAccount = findMoneyOnAccount(docs, payments, today);
  if (onAccount.length > 0) {
    const oldest = onAccount[0];
    insights.push({
      id: "money-on-account",
      tone: "attention",
      title: `${plural(onAccount.length, "item")} with money on account`,
      detail: `${oldest.number} for ${oldest.party} has ${money(oldest.amount, oldest.currencyCode)} ${oldest.credit ? "left to apply" : "not applied to any document"} since ${shortDate(oldest.date)}. Apply it to a document${oldest.credit ? " or refund it" : ""}.`,
      href: `/transactions/${oldest.typeCode}?open=${oldest.id}`,
    });
  }

  const matches = findLikelyMatches(docs, payments);
  if (matches.length > 0) {
    const { payment, invoice } = matches[0];
    insights.push({
      id: "likely-matches",
      tone: "info",
      title: `${plural(matches.length, "likely match")} for unapplied money`,
      detail: `${payment.number} from ${payment.party} has ${money(payment.unallocated, payment.currencyCode)} unapplied, the same as what is open on ${invoice.number}.`,
      href: `/transactions/${payment.typeCode}?open=${payment.id}`,
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
      title: `${plural(toInvoice.length, "active order")} still to invoice`,
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
      title: `${plural(complete.length, "active order")} fully invoiced`,
      detail: `${first.number} for ${first.party} has nothing left to invoice${complete.length > 1 ? ", and so have the others" : ""}. ${complete.length === 1 ? "It" : "They"} can be closed.`,
      href: `/transactions/${first.typeCode}?open=${first.id}`,
    });
  }

  if (watch.closedWithLeft.length > 0) {
    const first = watch.closedWithLeft[0];
    insights.push({
      id: "closed-orders-with-quantity-left",
      tone: "attention",
      title: "Closed orders with quantity left",
      detail: `${plural(watch.closedWithLeft.length, "order")} closed by hand still ${watch.closedWithLeft.length === 1 ? "has" : "have"} quantity that is not invoiced. ${first.number} for ${first.party} has ${quantity(first.left)} left. Reopen it to invoice the rest, or leave it closed.`,
      href: `/transactions/${first.typeCode}?open=${first.id}`,
    });
  }

  const stale = findStaleDrafts(watch.holdingDrafts, today);
  if (stale.length > 0) {
    const first = stale[0];
    insights.push({
      id: "drafts-holding-order-quantity",
      tone: "attention",
      title: "Drafts holding order quantity",
      detail: `${plural(stale.length, "draft invoice")} older than ${STALE_DRAFT_DAYS} days ${stale.length === 1 ? "holds" : "hold"} ${quantity(stale.reduce((sum, draft) => sum + draft.held, 0))} of quantity on active orders, so nobody else can invoice it. The oldest is ${first.number} for ${first.party}, started ${shortDate(first.created)}, holding ${quantity(first.held)}. Post it or delete it.`,
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
    .select("id, document_number, reference, status, party_name, supplier_id, customer_id, transaction_date, due_date, amount_due, paid_amount, home_total_amount, supplier_reference, transaction_types!inner(type, code, document_kind), currencies(code)")
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
        paidAmount: Number(row.paid_amount ?? 0),
        total: Number(row.home_total_amount ?? 0),
        supplierReference: String(row.supplier_reference ?? ""),
        kind: type?.document_kind === "credit_note" ? "credit_note" : "invoice",
        currencyCode: String(embedded(row.currencies)?.code ?? ""),
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
  const queue = supabase.rpc("approval_queue", { p_organisation_id: organisationId });
  const [closedWithLeft, holdingDrafts, payments] = await Promise.all([
    listClosedOrdersWithQuantityLeft(supabase, organisationId),
    listDraftsHoldingOrders(supabase, organisationId),
    listUnallocatedPayments(supabase, organisationId),
  ]);
  const approvals: ApprovalQueueItem[] = ((await queue).data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.header_id),
    state: row.state === "refused" ? "refused" : "waiting",
    typeCode: String(row.type_code ?? ""),
    number: String(row.document_number ?? "Draft"),
    party: String(row.party ?? ""),
    amount: Number(row.amount ?? 0),
    requestedAt: String(row.requested_at ?? ""),
    note: String(row.note ?? ""),
    decidedBy: String(row.decided_by_name ?? ""),
    kind: row.item_kind === "payment" || row.item_kind === "run" ? row.item_kind : "document",
  }));
  return buildInsights(docs, checked.filter((item): item is NotReady => item !== null), today, (await openOrders).orders, { closedWithLeft, holdingDrafts }, payments, approvals);
}

/** Posted payments and receipts with something left that is not applied. A void payment has nothing left. */
async function listUnallocatedPayments(supabase: SupabaseClient, organisationId: string): Promise<InsightPayment[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, document_number, payment_date, party_name, supplier_id, customer_id, unallocated_amount, transaction_types!inner(code, type, document_kind), currencies(code)")
    .eq("organisation_id", organisationId)
    .eq("status", "posted")
    .gt("unallocated_amount", 0)
    .order("payment_date", { ascending: true })
    .limit(1000);
  if (error) return [];
  return ((data ?? []) as Row[]).flatMap((row) => {
    const type = embedded(row.transaction_types);
    if ((type?.type !== "Purchases" && type?.type !== "Sales") || (type.document_kind !== "payment" && type.document_kind !== "receipt")) return [];
    return [
      {
        id: String(row.id),
        number: String(row.document_number ?? "Payment"),
        typeCode: String(type.code ?? ""),
        direction: type.type,
        kind: type.document_kind,
        party: String(row.party_name ?? ""),
        partyId: String(row.customer_id ?? row.supplier_id ?? ""),
        date: String(row.payment_date ?? ""),
        currencyCode: String(embedded(row.currencies)?.code ?? ""),
        unallocated: Number(row.unallocated_amount ?? 0),
      },
    ];
  });
}
