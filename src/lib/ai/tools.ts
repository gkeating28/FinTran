import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAuditLog } from "@/lib/audit-data";
import { explainIssue } from "@/lib/einvoice/rule-help";
import { getInsights } from "@/lib/insights";
import { listOpenOrders } from "@/lib/order-data";

type Client = SupabaseClient;
type Row = Record<string, unknown>;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

/** Lists show this many rows. Totals read up to AGGREGATE_LIMIT rows and say so when that is not all of them. */
const LIST_LIMIT = 25;
const AGGREGATE_LIMIT = 5000;

function rowsOf(value: unknown, limit = LIST_LIMIT) {
  return Array.isArray(value) ? (value as Row[]).slice(0, limit) : [];
}

function direction(value: unknown) {
  const word = String(value ?? "").toLowerCase();
  if (/^(purchase|purchases|supplier|suppliers|buying|bought|expense|expenses|cost|costs)/.test(word)) return "Purchases";
  if (/^(sale|sales|customer|customers|selling|sold|income|revenue)/.test(word)) return "Sales";
  return null;
}

function statusOf(value: unknown) {
  const word = String(value ?? "").toLowerCase();
  return word === "draft" || word === "posted" || word === "void" || word === "open" || word === "closed" || word === "cancelled" ? word : null;
}

function dateOf(value: unknown) {
  const word = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(word) ? word : null;
}

type Filtered = { eq: (c: string, v: unknown) => Filtered; gte: (c: string, v: unknown) => Filtered; lte: (c: string, v: unknown) => Filtered; lt: (c: string, v: unknown) => Filtered; gt: (c: string, v: unknown) => Filtered; ilike: (c: string, v: string) => Filtered };

/** The filters every document search and total shares, pushed into the query so a limit never hides rows. */
function filterHeaders<T>(query: T, input: Record<string, unknown>, prefix = "", defaults: { status?: string } = {}): T {
  let next = query as unknown as Filtered;
  const column = (name: string) => `${prefix}${name}`;
  const status = statusOf(input.status) ?? defaults.status;
  if (status) next = next.eq(column("status"), status);
  const dir = direction(input.direction);
  if (dir) next = next.eq(prefix ? `${prefix.slice(0, -1)}.transaction_types.type` : "transaction_types.type", dir);
  const from = dateOf(input.from);
  const to = dateOf(input.to);
  if (from) next = next.gte(column("transaction_date"), from);
  if (to) next = next.lte(column("transaction_date"), to);
  return next as unknown as T;
}

export function agingBands(documents: Row[], asOf = new Date().toISOString().slice(0, 10), keep = LIST_LIMIT) {
  const today = Date.parse(asOf);
  const parties = new Map<string, { current: number; d30: number; d60: number; d90: number; over: number }>();
  for (const document of documents) {
    const name = text(document.party_name) || "Unknown";
    const due = Date.parse(text(document.due_date));
    const amount = Number(document.amount_due ?? 0);
    if (!Number.isFinite(amount)) continue;
    const days = Number.isNaN(due) ? 0 : Math.floor((today - due) / 86_400_000);
    const band = parties.get(name) ?? { current: 0, d30: 0, d60: 0, d90: 0, over: 0 };
    if (days <= 0) band.current += amount;
    else if (days <= 30) band.d30 += amount;
    else if (days <= 60) band.d60 += amount;
    else if (days <= 90) band.d90 += amount;
    else band.over += amount;
    parties.set(name, band);
  }
  return [...parties.entries()]
    .sort((a, b) => b[1].current + b[1].d30 + b[1].d60 + b[1].d90 + b[1].over - (a[1].current + a[1].d30 + a[1].d60 + a[1].d90 + a[1].over))
    .slice(0, keep)
    .map(([party, band]) => ({
    party,
    current: band.current.toFixed(2),
    days0to30: band.d30.toFixed(2),
    days31to60: band.d60.toFixed(2),
    days61to90: band.d90.toFixed(2),
    over90: band.over.toFixed(2),
  }));
}

export function periodTotals(documents: Row[], grain: "month" | "quarter" = "month") {
  const groups = new Map<string, { nett: number; vat: number; total: number }>();
  for (const document of documents) {
    const date = text(document.transaction_date);
    const key = grain === "quarter" && date.length >= 7
      ? `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
      : date.slice(0, 7);
    const group = groups.get(key) ?? { nett: 0, vat: 0, total: 0 };
    group.nett += Number(document.home_nett_amount ?? document.foreign_nett_amount ?? 0);
    group.vat += Number(document.home_vat_amount ?? document.foreign_vat_amount ?? 0);
    group.total += Number(document.home_total_amount ?? document.foreign_total_amount ?? 0);
    groups.set(key, group);
  }
  return [...groups.entries()].sort().slice(-24).map(([period, group]) => ({
    period,
    nett: group.nett.toFixed(2),
    vat: group.vat.toFixed(2),
    total: group.total.toFixed(2),
  }));
}

function within(document: Row, input: Record<string, unknown>) {
  const amount = Number(document.amount_due ?? document.foreign_total_amount ?? document.total_amount ?? 0);
  if (input.minAmount != null && amount < Number(input.minAmount)) return false;
  if (input.maxAmount != null && amount > Number(input.maxAmount)) return false;
  return true;
}

/** Adds what each rule means and where to fix it, so the model does not have to guess at fixes. */
function withHelp(items: Row[], direction: "Sales" | "Purchases") {
  return items.map((item) => {
    const term = text(item.business_term) || /\b(B[TG]-\d+)\b/.exec(text(item.message))?.[1] || "";
    const help = explainIssue({ ruleId: text(item.rule_id), businessTerm: term, layer: text(item.layer), direction });
    return help ? { ...item, help } : item;
  });
}

function embedded(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Row | undefined;
}


const HEADER_COLUMNS =
  "id, document_number, status, party_name, transaction_date, due_date, amount_due, foreign_nett_amount, foreign_vat_amount, foreign_total_amount, home_nett_amount, home_vat_amount, home_total_amount, transaction_types!inner(type, code)";

function shapeHeader(document: Row) {
  const type = embedded(document.transaction_types);
  return {
    id: document.id,
    document_number: document.document_number,
    type: type?.type,
    type_code: type?.code,
    status: document.status,
    party_name: document.party_name,
    transaction_date: document.transaction_date,
    due_date: document.due_date,
    amount_due: money(document.amount_due),
    total: money(document.foreign_total_amount),
  };
}

export async function runAskTool(supabase: Client, organisationId: string, name: string, input: Record<string, unknown>) {
  try {
    return await runTool(supabase, organisationId, name, input);
  } catch {
    return { error: "That lookup failed. Say that you could not read the data." };
  }
}

async function runTool(supabase: Client, organisationId: string, name: string, input: Record<string, unknown>) {
  if (name === "search_parties") {
    const term = String(input.name ?? input.code ?? input.vat ?? input.peppol ?? "").trim().replace(/[,()%]/g, " ");
    const pattern = `%${term}%`;
    const [customers, suppliers] = await Promise.all([
      supabase.from("customers").select("id, code, name, vat_number, peppol_scheme, peppol_id, payment_terms_days").eq("organisation_id", organisationId).or(`name.ilike.${pattern},code.ilike.${pattern},vat_number.ilike.${pattern},peppol_id.ilike.${pattern}`).limit(LIST_LIMIT),
      supabase.from("suppliers").select("id, code, name, vat_number, peppol_scheme, peppol_id, payment_terms_days").eq("organisation_id", organisationId).or(`name.ilike.${pattern},code.ilike.${pattern},vat_number.ilike.${pattern},peppol_id.ilike.${pattern}`).limit(LIST_LIMIT),
    ]);
    return { customers: rowsOf(customers.data), suppliers: rowsOf(suppliers.data) };
  }

  if (name === "draft_reminder") {
    let query = supabase
      .from("transaction_headers")
      .select("id, document_number, status, party_name, transaction_date, due_date, amount_due, foreign_total_amount, customer_id, currencies(code), transaction_types!inner(type)")
      .eq("organisation_id", organisationId)
      .eq("status", "posted")
      .eq("transaction_types.type", "Sales");
    if (input.id) query = query.eq("id", String(input.id));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    const { data } = await query.gt("amount_due", 0).order("due_date", { ascending: true }).limit(2);
    const rows = rowsOf(data);
    if (rows.length === 0) return { error: "No posted sales document with an amount still due matches that." };
    if (rows.length > 1 && !input.id) return { error: "More than one document matches. Ask which one, by its number.", candidates: rows.map(shapeHeader) };
    const header = rows[0];
    const [customer, organisation] = await Promise.all([
      supabase.from("customers").select("email").eq("organisation_id", organisationId).eq("id", String(header.customer_id)).maybeSingle(),
      supabase.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
    ]);
    const code = text(embedded(header.currencies)?.code);
    const amount = (value: unknown) => `${code === "EUR" || !code ? "€" : `${code} `}${Number(value ?? 0).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const today = new Date().toISOString().slice(0, 10);
    const due = text(header.due_date);
    const late = due && due < today ? Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000) : 0;
    const when = (iso: string) => new Date(Date.parse(iso)).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const number = text(header.document_number) || "the invoice";
    const body = [
      `Dear ${text(header.party_name)},`,
      "",
      `Our records show that invoice ${number}, dated ${when(text(header.transaction_date))} for ${amount(header.foreign_total_amount)}, has ${amount(header.amount_due)} still outstanding${due ? `. It was due on ${when(due)}${late > 0 ? `, ${late} ${late === 1 ? "day" : "days"} ago` : ""}` : ""}.`,
      "",
      late > 30
        ? "We would be grateful if you could arrange payment by return, or tell us if there is a query we can help with."
        : "Please arrange payment, or let us know if it has already been paid or if there is a query.",
      "",
      "Kind regards,",
      text(embedded(organisation.data)?.name ?? (organisation.data as Row | null)?.name),
    ].join("\n");
    const email = text((customer.data as Row | null)?.email);
    return {
      document: shapeHeader(header),
      reminder: { to: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "", subject: `Payment reminder: invoice ${number}`, body },
      note: "The reminder is shown to the person with buttons to copy it or open it in their email. Nothing is sent.",
    };
  }

  if (name === "open_orders") {
    const { orders, truncated } = await listOpenOrders(supabase, organisationId);
    const dir = direction(input.direction);
    const wanted = input.state === "none" || input.state === "part" || input.state === "full" ? input.state : null;
    const party = String(input.party ?? "").toLowerCase();
    const matched = orders.filter((order) => (!dir || order.direction === dir) && (!wanted || order.state === wanted) && (!party || order.party.toLowerCase().includes(party)));
    return {
      orders: matched.slice(0, LIST_LIMIT).map((order) => ({
        id: order.id,
        document: order.number,
        type: order.typeCode,
        direction: order.direction,
        party: order.party,
        date: order.date,
        ordered: money(order.ordered),
        invoiced: money(order.invoiced),
        leftToInvoice: money(order.remaining),
        invoicing: order.state === "none" ? "not invoiced" : order.state === "part" ? "part invoiced" : "fully invoiced",
      })),
      count: matched.length,
      totalLeftToInvoice: money(matched.reduce((sum, order) => sum + order.remaining, 0)),
      shown: Math.min(matched.length, LIST_LIMIT),
      truncated,
      note: "Active orders only. Active is the status after draft, stored as open. Amounts are nett, in the home currency. An order is limited by quantity, so what is left is valued at the order's prices.",
    };
  }

  if (name === "insights") {
    return { insights: await getInsights(supabase, organisationId), note: "Worked out from the last year of documents with fixed rules." };
  }

  if (name === "search_products") {
    const term = String(input.query ?? input.name ?? input.code ?? "").trim().replace(/[,()%]/g, " ");
    const pattern = `%${term}%`;
    const { data } = await supabase.from("products").select("code, description, unit_code, purchase_price, sales_price").eq("organisation_id", organisationId).or(`code.ilike.${pattern},description.ilike.${pattern}`).order("code").limit(LIST_LIMIT);
    return { products: rowsOf(data).map((row) => ({ ...row, purchase_price: money(row.purchase_price), sales_price: money(row.sales_price) })) };
  }

  if (name === "search_transactions" || name === "get_transaction") {
    let query = supabase.from("transaction_headers").select(HEADER_COLUMNS).eq("organisation_id", organisationId);
    query = filterHeaders(query, input);
    if (input.id) query = query.eq("id", String(input.id));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    if (input.party) query = query.ilike("party_name", `%${String(input.party)}%`);
    if (input.overdue) query = query.lt("due_date", dateOf(input.asOf) ?? new Date().toISOString().slice(0, 10)).gt("amount_due", 0);
    if (input.minAmount != null) query = query.gte("foreign_total_amount", Number(input.minAmount));
    if (input.maxAmount != null) query = query.lte("foreign_total_amount", Number(input.maxAmount));
    const { data } = await query.order("transaction_date", { ascending: false }).limit(LIST_LIMIT);
    const documents = rowsOf(data).filter((document) => within(document, input));
    if (name === "get_transaction" && documents[0]?.id) {
      const lines = await supabase.from("transaction_lines").select("line_number, description, quantity, price, nett_amount, vat_amount, vat_percentage").eq("organisation_id", organisationId).eq("header_id", String(documents[0].id)).order("line_number").limit(LIST_LIMIT);
      const direction = embedded(documents[0].transaction_types)?.type === "Sales" ? "Sales" : "Purchases";
      const readiness = documents[0].status === "draft" ? await supabase.rpc("en16931_readiness", { p_header_id: String(documents[0].id) }) : null;
      return {
        document: shapeHeader(documents[0]),
        ...(readiness ? { readiness: withHelp(rowsOf(readiness.data), direction) } : {}),
        lines: rowsOf(lines.data).map((line) => ({ ...line, nett_amount: money(line.nett_amount), vat_amount: money(line.vat_amount), price: money(line.price) })),
      };
    }
    return { documents: documents.map(shapeHeader), shown: documents.length, limit: LIST_LIMIT };
  }

  if (name === "aging_summary") {
    let query = supabase.from("transaction_headers").select("party_name, due_date, amount_due, transaction_types!inner(type)").eq("organisation_id", organisationId).eq("status", "posted").gt("amount_due", 0);
    query = filterHeaders(query, { direction: input.direction }, "");
    const { data } = await query.limit(AGGREGATE_LIMIT);
    const documents = rowsOf(data, AGGREGATE_LIMIT);
    const bands = agingBands(documents, dateOf(input.asOf) ?? new Date().toISOString().slice(0, 10), 1000);
    return { parties: bands.slice(0, LIST_LIMIT), partyCount: bands.length, documentsRead: documents.length, truncated: documents.length >= AGGREGATE_LIMIT, note: "Amounts are in each document's own currency." };
  }

  if (name === "totals_by_period") {
    let query = supabase.from("transaction_headers").select("transaction_date, home_nett_amount, home_vat_amount, home_total_amount, party_name, transaction_types!inner(type)").eq("organisation_id", organisationId);
    query = filterHeaders(query, input, "", { status: "posted" });
    if (input.party) query = query.ilike("party_name", `%${String(input.party)}%`);
    const { data } = await query.limit(AGGREGATE_LIMIT);
    const documents = rowsOf(data, AGGREGATE_LIMIT);
    return { periods: periodTotals(documents, input.grain === "quarter" ? "quarter" : "month"), documentsRead: documents.length, truncated: documents.length >= AGGREGATE_LIMIT, note: "Posted documents only unless a status was asked for. Amounts are in the home currency." };
  }

  if (name === "top_parties") {
    let query = supabase.from("transaction_headers").select("party_name, home_nett_amount, home_total_amount, transaction_types!inner(type)").eq("organisation_id", organisationId);
    query = filterHeaders(query, input, "", { status: "posted" });
    const { data } = await query.limit(AGGREGATE_LIMIT);
    const documents = rowsOf(data, AGGREGATE_LIMIT);
    const totals = new Map<string, { total: number; nett: number; count: number }>();
    for (const document of documents) {
      const party = text(document.party_name) || "Unknown";
      const entry = totals.get(party) ?? { total: 0, nett: 0, count: 0 };
      entry.total += Number(document.home_total_amount ?? 0);
      entry.nett += Number(document.home_nett_amount ?? 0);
      entry.count += 1;
      totals.set(party, entry);
    }
    const metric = input.metric === "count" || input.metric === "nett" ? String(input.metric) : "total";
    const limit = Math.min(25, Math.max(1, Number(input.limit) || 10));
    const ranked = [...totals.entries()]
      .sort((a, b) => (metric === "count" ? b[1].count - a[1].count : metric === "nett" ? b[1].nett - a[1].nett : b[1].total - a[1].total))
      .slice(0, limit)
      .map(([party, entry]) => ({ party, documents: entry.count, nett: entry.nett.toFixed(2), total: entry.total.toFixed(2) }));
    return { parties: ranked, partyCount: totals.size, documentsRead: documents.length, truncated: documents.length >= AGGREGATE_LIMIT, note: "Posted documents only unless a status was asked for. Amounts are in the home currency." };
  }

  if (name === "vat_summary") {
    let query = supabase
      .from("transaction_lines")
      .select("nett_amount, vat_amount, vat_percentage, transaction_headers!inner(transaction_date, status, exchange_rate, transaction_types!inner(type))")
      .eq("organisation_id", organisationId);
    query = filterHeaders(query, input, "transaction_headers.", { status: "posted" });
    const { data } = await query.limit(AGGREGATE_LIMIT);
    const lines = rowsOf(data, AGGREGATE_LIMIT);
    const groups = new Map<string, { nett: number; vat: number }>();
    for (const line of lines) {
      const header = embedded(line.transaction_headers);
      const type = embedded(header?.transaction_types);
      const rate = Number(header?.exchange_rate ?? 1) || 1;
      const key = `${text(type?.type)} ${Number(line.vat_percentage ?? 0)}%${input.groupBy === "month" ? ` ${text(header?.transaction_date).slice(0, 7)}` : ""}`.trim();
      const entry = groups.get(key) ?? { nett: 0, vat: 0 };
      entry.nett += Number(line.nett_amount ?? 0) / rate;
      entry.vat += Number(line.vat_amount ?? 0) / rate;
      groups.set(key, entry);
    }
    return {
      groups: [...groups.entries()].sort().slice(0, LIST_LIMIT).map(([group, entry]) => ({ group, nett: entry.nett.toFixed(2), vat: entry.vat.toFixed(2) })),
      linesRead: lines.length,
      truncated: lines.length >= AGGREGATE_LIMIT,
      note: "Posted documents only unless a status was asked for. Amounts are in the home currency.",
    };
  }

  if (name === "change_history") {
    const history = await listAuditLog(organisationId, 200);
    if (history.error) return { error: "Only owners and admins can read the change history." };
    const word = String(input.table ?? input.what ?? "").toLowerCase();
    const who = String(input.who ?? "").toLowerCase();
    const rows = history.rows
      .filter((row) => (!word || `${row.tableName} ${row.summary}`.toLowerCase().includes(word)) && (!who || row.who.toLowerCase().includes(who)))
      .slice(0, Math.min(LIST_LIMIT, Math.max(1, Number(input.limit) || 10)))
      .map((row) => ({ when: row.when, who: row.who, table: row.tableName, action: row.action, summary: row.summary.slice(0, 300) }));
    return { changes: rows, note: "The latest 200 changes were searched." };
  }

  if (name === "search_e_documents" || name === "get_e_document") {
    let query = supabase.from("e_documents").select("id, direction, status, document_number, seller_name, buyer_name, issue_date, total_amount, currency_code").eq("organisation_id", organisationId);
    if (input.id) query = query.eq("id", String(input.id));
    if (input.direction) query = query.eq("direction", String(input.direction));
    if (input.status) query = query.eq("status", String(input.status));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    const from = dateOf(input.from);
    const to = dateOf(input.to);
    if (from) query = query.gte("issue_date", from);
    if (to) query = query.lte("issue_date", to);
    const { data } = await query.order("issue_date", { ascending: false }).limit(LIST_LIMIT);
    const documents = rowsOf(data).filter((document) => within(document, input) && (!input.party || `${text(document.seller_name)} ${text(document.buyer_name)}`.toLowerCase().includes(String(input.party).toLowerCase())));
    if (name === "get_e_document" && documents[0]?.id) {
      const [results, events] = await Promise.all([
        supabase.from("e_document_validation_results").select("layer, rule_id, severity, message").eq("e_document_id", String(documents[0].id)).limit(LIST_LIMIT),
        supabase.from("e_document_events").select("from_status, to_status, detail").eq("e_document_id", String(documents[0].id)).limit(LIST_LIMIT),
      ]);
      const direction = documents[0].direction === "outbound" ? "Sales" : "Purchases";
      return { document: { ...documents[0], total_amount: money(documents[0].total_amount) }, results: withHelp(rowsOf(results.data), direction), events: rowsOf(events.data) };
    }
    return { documents: documents.map((document) => ({ ...document, total_amount: money(document.total_amount) })), shown: documents.length, limit: LIST_LIMIT };
  }

  if (name === "readiness_issues") {
    let query = supabase.from("transaction_headers").select("id, document_number, transaction_types!inner(type)").eq("organisation_id", organisationId).eq("status", "draft");
    if (input.id) query = query.eq("id", String(input.id));
    if (input.number) query = query.ilike("document_number", `%${String(input.number)}%`);
    const { data } = await query.limit(LIST_LIMIT);
    const checked = await Promise.all(
      rowsOf(data).map(async (header) => {
        const result = await supabase.rpc("en16931_readiness", { p_header_id: String(header.id) });
        const direction = embedded(header.transaction_types)?.type === "Sales" ? "Sales" : "Purchases";
        return { id: header.id, document: header.document_number, issues: withHelp(rowsOf(result.data), direction) };
      }),
    );
    return { drafts: checked };
  }

  if (name === "explain_rule") {
    const help = explainIssue({ ruleId: String(input.ruleId ?? ""), businessTerm: String(input.businessTerm ?? ""), direction: direction(input.direction) === "Sales" ? "Sales" : "Purchases" });
    return help ? { ruleId: input.ruleId, help } : { error: "That rule is not in the help. Explain it from the rule text only and say so." };
  }

  if (name === "help_search") {
    const directory = path.join(process.cwd(), "docs/help");
    const query = String(input.query ?? "").toLowerCase();
    const passages = readdirSync(directory).filter((file) => file.endsWith(".md")).map((file) => readFileSync(path.join(directory, file), "utf8"));
    const matched = passages.filter((passage) => !query || passage.toLowerCase().includes(query)).slice(0, 3);
    return { passages: matched };
  }

  return { error: "That tool is not available." };
}
