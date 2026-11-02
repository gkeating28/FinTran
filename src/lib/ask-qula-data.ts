import {
  agingSummary,
  documentSummary,
  helpAnswer,
  parseDocumentQuery,
  parseTransactionQuery,
  routeQuestion,
  transactionSummary,
  withDocs,
  type AgingFact,
  type AskAnswer,
  type AskDoc,
  type TransactionQuery,
} from "@/lib/ask-qula";
import { groupThousands } from "@/lib/numbers";
import { createClient } from "@/lib/supabase/server";

const DOC_CAP = 8;
const HEADER_SELECT =
  "id, document_number, reference, status, due_date, amount_due, party_name, transaction_date, supplier_reference, order_number, transaction_types(code, description, document_kind, type), currencies(code)";

type TypeEmbed = {
  code: string;
  description: string;
  document_kind: string;
  type: string;
};

type HeaderRow = {
  id: string;
  document_number: string | null;
  reference: number | null;
  status: string;
  due_date: string | null;
  amount_due: number | string | null;
  party_name: string | null;
  transaction_date: string | null;
  supplier_reference: string | null;
  order_number: string | null;
  transaction_types: TypeEmbed | TypeEmbed[] | null;
  currencies: { code: string } | { code: string }[] | null;
};

type DocumentRow = {
  id: string;
  direction: string;
  status: string;
  document_number: string | null;
  issue_date: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  currency_code: string | null;
  total_amount: number | string | null;
  header_id: string | null;
};

type Header = {
  id: string;
  documentNumber: string;
  reference: number | null;
  status: string;
  dueDate: string | null;
  amountDue: number;
  party: string;
  supplierReference: string;
  orderNumber: string;
  typeCode: string;
  typeDescription: string;
  kind: string;
  direction: string;
  currency: string;
};

const READ_ERROR = "Those records could not be read.";

export async function answerQuestion(organisationId: string, question: string): Promise<AskAnswer> {
  const intent = routeQuestion(question);
  if (intent === "help") return helpAnswer();
  const supabase = await createClient();
  if (intent === "aging") return agingAnswer(supabase, organisationId, question);
  if (intent === "documents") return documentsAnswer(supabase, organisationId, question);
  return transactionsAnswer(supabase, organisationId, question);
}

async function transactionsAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  question: string,
): Promise<AskAnswer> {
  const query = parseTransactionQuery(question);
  const rows = await loadTransactions(supabase, organisationId, query);
  const docs = rows.map((row) =>
    transactionDoc(row, [row.party, money(row.amountDue, row.currency)].filter(Boolean).join(" · ")),
  );
  return withDocs({ intent: "transactions", text: transactionSummary(docs.length, query) }, docs);
}

async function agingAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  question: string,
): Promise<AskAnswer> {
  const query = parseTransactionQuery(question);
  const typeIds = await matchingTypeIds(supabase, organisationId, { kind: "invoice", direction: query.direction });
  if (typeIds.length === 0) {
    return { intent: "aging", text: agingSummary([], new Date().toISOString().slice(0, 10)) };
  }
  const { data, error } = await supabase
    .from("transaction_headers")
    .select(HEADER_SELECT)
    .eq("organisation_id", organisationId)
    .eq("status", "posted")
    .gt("amount_due", 0)
    .in("transaction_type_id", typeIds)
    .order("due_date", { ascending: true })
    .limit(200);
  if (error) throw new Error(READ_ERROR);

  const today = new Date().toISOString().slice(0, 10);
  const rows = ((data ?? []) as HeaderRow[])
    .map(normalizeHeader)
    .filter((row) => row.kind === "invoice")
    .filter((row) => !query.direction || row.direction === query.direction)
    .filter((row) => !query.party || row.party.toLowerCase().includes(query.party.toLowerCase()));
  const facts: AgingFact[] = rows.map((row) => ({
    dueDate: row.dueDate,
    amountDue: row.amountDue,
    currency: row.currency,
  }));
  const docs = rows
    .filter((row) => {
      if (!row.dueDate) return false;
      return row.dueDate < today;
    })
    .slice(0, DOC_CAP)
    .map((row) =>
      transactionDoc(
        row,
        [row.party, money(row.amountDue, row.currency), row.dueDate ? `due ${row.dueDate}` : ""].filter(Boolean).join(" · "),
      ),
    );
  return withDocs({ intent: "aging", text: agingSummary(facts, today) }, docs);
}

async function documentsAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  question: string,
): Promise<AskAnswer> {
  const query = parseDocumentQuery(question);
  let request = supabase
    .from("e_documents")
    .select("id, direction, status, document_number, issue_date, seller_name, buyer_name, currency_code, total_amount, header_id")
    .eq("organisation_id", organisationId);
  if (query.direction) request = request.eq("direction", query.direction);
  if (query.status) request = request.eq("status", query.status);
  const { data, error } = await request.order("created_at", { ascending: false }).limit(80);
  if (error) throw new Error(READ_ERROR);

  const needle = query.party?.toLowerCase();
  const number = query.number?.toLowerCase();
  const rows = ((data ?? []) as DocumentRow[]).filter((row) => {
    const party = `${row.seller_name ?? ""} ${row.buyer_name ?? ""}`.toLowerCase();
    if (needle && !party.includes(needle)) return false;
    if (number && !(row.document_number ?? "").toLowerCase().includes(number.toLowerCase())) return false;
    return true;
  });
  const docs = rows.slice(0, query.limit).map(documentDoc);
  return withDocs({ intent: "documents", text: documentSummary(docs.length, query) }, docs);
}

async function loadTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  query: TransactionQuery,
) {
  let request = supabase.from("transaction_headers").select(HEADER_SELECT).eq("organisation_id", organisationId);
  if (query.kind || query.direction) {
    const typeIds = await matchingTypeIds(supabase, organisationId, query);
    if (typeIds.length === 0) return [];
    request = request.in("transaction_type_id", typeIds);
  }
  if (query.status) request = request.eq("status", query.status);
  const party = query.party?.replace(/[%_\\]/g, "").trim();
  if (party) request = request.ilike("party_name", `%${party}%`);
  const { data, error } = await request.order("transaction_date", { ascending: false }).limit(80);
  if (error) throw new Error(READ_ERROR);

  const rows = ((data ?? []) as HeaderRow[]).map(normalizeHeader).filter((row) => matchesTransaction(row, query));
  if (query.number && rows.length === 0) return findNumberedTransactions(supabase, organisationId, query);
  return rows.slice(0, query.limit);
}

async function findNumberedTransactions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  query: TransactionQuery,
) {
  const safe = query.number?.replace(/[%_\\]/g, "").trim() ?? "";
  const searches = [
    safe
      ? supabase.from("transaction_headers").select(HEADER_SELECT).eq("organisation_id", organisationId).ilike("document_number", `%${safe}%`).limit(DOC_CAP)
      : null,
    safe
      ? supabase
          .from("transaction_headers")
          .select(HEADER_SELECT)
          .eq("organisation_id", organisationId)
          .ilike("supplier_reference", `%${safe}%`)
          .limit(DOC_CAP)
      : null,
    query.number && /^\d+$/.test(query.number)
      ? supabase
          .from("transaction_headers")
          .select(HEADER_SELECT)
          .eq("organisation_id", organisationId)
          .eq("reference", Number(query.number))
          .limit(DOC_CAP)
      : null,
  ].filter((search) => search != null);
  const results = await Promise.all(searches);
  const seen = new Set<string>();
  const rows: Header[] = [];
  for (const result of results) {
    if (result.error) throw new Error(READ_ERROR);
    for (const row of ((result.data ?? []) as HeaderRow[]).map(normalizeHeader)) {
      if (seen.has(row.id) || !matchesTransaction(row, { ...query, number: undefined })) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows.slice(0, query.limit);
}

async function matchingTypeIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  query: { kind?: string; direction?: string },
) {
  const { data, error } = await supabase
    .from("transaction_types")
    .select("id, document_kind, type")
    .eq("organisation_id", organisationId);
  if (error) throw new Error(READ_ERROR);
  return ((data ?? []) as { id: string; document_kind: string; type: string }[])
    .filter((row) => !query.kind || row.document_kind === query.kind)
    .filter((row) => !query.direction || row.type === query.direction)
    .map((row) => row.id);
}

function matchesTransaction(row: Header, query: TransactionQuery) {
  if (query.kind && row.kind !== query.kind) return false;
  if (query.direction && row.direction !== query.direction) return false;
  if (!query.number) return true;
  const needle = query.number.toLowerCase();
  return [row.documentNumber, row.supplierReference, row.orderNumber, row.reference == null ? "" : String(row.reference)]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function normalizeHeader(row: HeaderRow): Header {
  const type = one(row.transaction_types);
  const currency = one(row.currencies);
  return {
    id: row.id,
    documentNumber: row.document_number?.trim() || "",
    reference: row.reference,
    status: row.status,
    dueDate: row.due_date,
    amountDue: Number(row.amount_due ?? 0),
    party: row.party_name?.trim() || "",
    supplierReference: row.supplier_reference?.trim() || "",
    orderNumber: row.order_number?.trim() || "",
    typeCode: type?.code ?? "",
    typeDescription: type?.description ?? "",
    kind: type?.document_kind ?? "",
    direction: type?.type ?? "",
    currency: currency?.code ?? "",
  };
}

function transactionDoc(row: Header, title: string): AskDoc {
  return {
    ref: row.documentNumber || (row.reference == null ? "Draft" : String(row.reference)),
    title: title || row.typeDescription || "Transaction",
    store: "transactions",
    status: label(row.status),
    statusColor: transactionColor(row.status),
    recordId: row.id,
    ...(row.typeCode ? { instanceId: row.typeCode } : {}),
  };
}

function documentDoc(row: DocumentRow): AskDoc {
  const party = row.direction === "inbound" ? row.seller_name : row.buyer_name;
  const amount = money(Number(row.total_amount ?? NaN), row.currency_code ?? "");
  return {
    ref: row.document_number?.trim() || "Untitled",
    title: [party?.trim() || "", amount, row.issue_date || ""].filter(Boolean).join(" · ") || "E-document",
    store: "e-documents",
    status: label(row.status),
    statusColor: documentColor(row.status),
    recordId: row.id,
    ...(row.header_id ? { instanceId: row.header_id } : {}),
  };
}

function label(status: string) {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function transactionColor(status: string) {
  if (status === "posted") return "#217a56";
  if (status === "void") return "#b42318";
  return "#2c4c78";
}

function documentColor(status: string) {
  if (status === "valid" || status === "imported") return "#217a56";
  if (status === "invalid" || status === "rejected") return "#b42318";
  if (status === "duplicate") return "#c2410c";
  return "#2c4c78";
}

function money(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return "";
  const formatted = groupThousands(amount.toFixed(2));
  return currency ? `${formatted} ${currency}` : formatted;
}

function one<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
