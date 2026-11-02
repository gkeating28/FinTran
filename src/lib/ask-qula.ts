export type AskIntent = "transactions" | "documents" | "aging" | "help";

export type AskDoc = {
  ref: string;
  title: string;
  store: string;
  status: string;
  statusColor: string;
  recordId?: string;
  instanceId?: string;
};

export type AskAnswer = {
  intent: AskIntent;
  text: string;
  docs?: AskDoc[];
};

export type TransactionQuery = {
  status?: "draft" | "posted" | "void";
  kind?: "invoice" | "credit_note" | "order";
  direction?: "Sales" | "Purchases";
  number?: string;
  party?: string;
  limit: number;
};

export type DocumentQuery = {
  direction?: "inbound" | "outbound";
  status?: "generated" | "received" | "invalid" | "valid" | "duplicate" | "imported" | "rejected";
  number?: string;
  party?: string;
  limit: number;
};

export type AgingFact = {
  dueDate: string | null;
  amountDue: number;
  currency: string;
};

export const ASK_SUGGESTIONS = [
  "What is overdue?",
  "Recent transactions",
  "Draft transactions",
  "Received e-documents",
] as const;

const DOC_LIMIT = 8;

export function routeQuestion(question: string): AskIntent {
  const text = question.toLowerCase();
  if (/\b(e-?documents?|e-?invoices?|ubl|peppol)\b/.test(text)) return "documents";
  if (/\b(aging|aged|overdue|past due|arrears|outstanding|unpaid)\b/.test(text)) return "aging";
  if (
    /\b(drafts?|posted|void(?:ed)?|invoices?|credits?|orders?|transactions?|recent|latest|last|suppliers?|customers?)\b/.test(
      text,
    ) ||
    /\b[a-z]{1,10}-\d{1,10}\b/.test(text) ||
    /\b(?:invoice|number|ref|reference)\s+[a-z0-9/-]*\d/i.test(question)
  ) {
    return "transactions";
  }
  return "help";
}

export function parseTransactionQuery(question: string): TransactionQuery {
  const limitMatch = question.match(/\b(?:last|latest|recent|top)\s+(\d{1,2})\b/i);
  const limit = Math.min(DOC_LIMIT, Math.max(1, limitMatch ? Number(limitMatch[1]) : DOC_LIMIT));
  let status: TransactionQuery["status"];
  if (/\bvoid(?:ed)?\b/i.test(question)) status = "void";
  else if (/\bposted\b/i.test(question)) status = "posted";
  else if (/\bdrafts?\b/i.test(question)) status = "draft";

  let kind: TransactionQuery["kind"];
  if (/\bcredits?(?:\s+notes?)?\b/i.test(question)) kind = "credit_note";
  else if (/\borders?\b/i.test(question)) kind = "order";
  else if (/\binvoices?\b/i.test(question)) kind = "invoice";

  const sales = /\b(sales|customers?|receivables?)\b/i.test(question);
  const purchases = /\b(purchases?|suppliers?|payables?)\b/i.test(question);
  let direction: TransactionQuery["direction"];
  if (sales && !purchases) direction = "Sales";
  else if (purchases && !sales) direction = "Purchases";

  return {
    status,
    kind,
    direction,
    number: findNumber(question),
    party: findParty(question),
    limit,
  };
}

export function parseDocumentQuery(question: string): DocumentQuery {
  const text = question.toLowerCase();
  let direction: DocumentQuery["direction"];
  if (/\b(received|incoming|inbound)\b/.test(text)) direction = "inbound";
  else if (/\b(sent|outgoing|outbound)\b/.test(text)) direction = "outbound";

  let status: DocumentQuery["status"];
  if (/\binvalid\b/.test(text)) status = "invalid";
  else if (/\bduplicate\b/.test(text)) status = "duplicate";
  else if (/\bimported\b/.test(text)) status = "imported";
  else if (/\brejected\b/.test(text)) status = "rejected";
  else if (/\bgenerated\b/.test(text)) status = "generated";
  else if (/\breceived\b/.test(text)) status = "received";
  else if (/\bvalid\b/.test(text)) status = "valid";

  return {
    direction,
    status,
    number: findNumber(question),
    party: findParty(question),
    limit: DOC_LIMIT,
  };
}

export function daysOverdue(dueDate: string | null, today: string) {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return null;
  return Math.floor((now - due) / 86_400_000);
}

export function agingBand(dueDate: string | null, today: string) {
  const days = daysOverdue(dueDate, today);
  if (days == null) return "undated" as const;
  if (days <= 0) return "current" as const;
  if (days <= 30) return "1-30" as const;
  if (days <= 60) return "31-60" as const;
  if (days <= 90) return "61-90" as const;
  return "over-90" as const;
}

export function agingSummary(facts: AgingFact[], today: string) {
  if (facts.length === 0) return "No posted invoice still has an amount due.";
  const head =
    facts.length === 1
      ? "1 posted invoice still has an amount due."
      : `${facts.length} posted invoices still have an amount due.`;
  const overdue = facts.filter((fact) => (daysOverdue(fact.dueDate, today) ?? -1) > 0);
  if (overdue.length === 0) return `${head} None are overdue.`;
  const bands = [
    ["1-30", "in 1–30 days"],
    ["31-60", "in 31–60 days"],
    ["61-90", "in 61–90 days"],
    ["over-90", "over 90 days"],
  ] as const;
  const parts = bands.flatMap(([band, label]) => {
    const count = overdue.filter((fact) => agingBand(fact.dueDate, today) === band).length;
    return count > 0 ? [`${count} ${label}`] : [];
  });
  const owing = overdue.length === 1 ? "1 is overdue" : `${overdue.length} are overdue`;
  return `${head} ${owing} (${currencyTotals(overdue)}): ${parts.join(", ")}.`;
}

export function transactionSummary(count: number, query: TransactionQuery) {
  if (count === 0) return "No transactions match that.";
  if (!query.status && !query.direction && !query.kind && !query.party && !query.number) {
    return count === 1 ? "Latest transaction." : `Latest ${count} transactions.`;
  }
  const what =
    query.kind === "credit_note" ? "credit note" : query.kind === "order" ? "order" : query.kind === "invoice" ? "invoice" : "transaction";
  const noun = count === 1 ? what : what === "credit note" ? "credit notes" : `${what}s`;
  const bits = [query.status, query.direction === "Sales" ? "sales" : query.direction === "Purchases" ? "purchase" : ""].filter(Boolean);
  const lead = bits.length > 0 ? `${count} ${bits.join(" ")} ${noun}` : `${count} ${noun}`;
  const tail = [query.party ? `for ${query.party}` : "", query.number ? `numbered ${query.number}` : ""].filter(Boolean);
  return tail.length > 0 ? `${lead} ${tail.join(" ")}.` : `${lead}.`;
}

export function documentSummary(count: number, query: DocumentQuery) {
  if (count === 0) return "No e-documents match that.";
  const where = query.direction === "inbound" ? "received" : query.direction === "outbound" ? "sent" : "";
  const noun = count === 1 ? "e-document" : "e-documents";
  return where ? `${count} ${where} ${noun}.` : `${count} ${noun}.`;
}

export function helpAnswer(): AskAnswer {
  return {
    intent: "help",
    text: "Ask about transactions, e-documents, or what is overdue. The answer is looked up from this organisation's records.",
  };
}

export function docHref(doc: AskDoc) {
  if (doc.store === "transactions" && doc.recordId && doc.instanceId && /^[A-Za-z0-9]+$/.test(doc.instanceId)) {
    return `/transactions/${doc.instanceId}?open=${encodeURIComponent(doc.recordId)}`;
  }
  if (doc.store === "e-documents" && doc.recordId) {
    return `/e-documents/${encodeURIComponent(doc.recordId)}`;
  }
  return null;
}

export function withDocs(answer: AskAnswer, docs: AskDoc[]): AskAnswer {
  return docs.length > 0 ? { ...answer, docs } : answer;
}

function findNumber(question: string) {
  const coded = question.match(/\b([A-Za-z]{1,10}-\d{1,10})\b/);
  if (coded) return coded[1];
  const labeled = question.match(/\b(?:invoice|number|ref|reference|no\.?|#)\s+([A-Za-z0-9/-]{1,20})\b/i);
  if (labeled && /\d/.test(labeled[1])) return labeled[1];
  return undefined;
}

function findParty(question: string) {
  const match = question.match(/\b(?:from|for|supplier|customer)\s+(.+)$/i);
  if (!match) return undefined;
  const cleaned = match[1]
    .replace(
      /\b(drafts?|posted|void(?:ed)?|invoices?|transactions?|orders?|credits?(?:\s+notes?)?|sales|purchases?|suppliers?|customers?|e-?documents?|please)\b/gi,
      " ",
    )
    .replace(/[?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return undefined;
  return cleaned.slice(0, 80);
}

function currencyTotals(facts: AgingFact[]) {
  const totals = new Map<string, number>();
  for (const fact of facts) {
    const currency = fact.currency || "";
    totals.set(currency, (totals.get(currency) ?? 0) + fact.amountDue);
  }
  return [...totals.entries()]
    .map(([currency, amount]) => {
      const money = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return currency ? `${money} ${currency}` : money;
    })
    .join(" and ");
}
