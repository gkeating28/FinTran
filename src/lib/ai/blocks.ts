import type { AskBlock } from "@/lib/ask-qula";

/**
 * Tables the server builds from a lookup's own figures, so the model does not have to write them out.
 * Writing a table as JSON and then again in words was the slowest part of an answer.
 */
type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function money(value: unknown, symbol = "€") {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return `${symbol}${number.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(value: unknown) {
  const time = Date.parse(String(value ?? ""));
  return Number.isNaN(time) ? "" : new Date(time).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function table(title: string, columns: string[], body: string[][]): AskBlock | null {
  return body.length > 0 ? { type: "table", title, columns, rows: body.slice(0, 50) } : null;
}

export function autoBlock(tool: string, result: unknown): AskBlock | null {
  if (!result || typeof result !== "object") return null;
  const data = result as Record<string, unknown>;
  if (data.error) return null;
  switch (tool) {
    case "top_parties":
      return table("Biggest by value", ["Name", "Documents", "Nett", "Total"], rows(data.parties).map((row) => [String(row.party ?? ""), String(row.documents ?? ""), money(row.nett), money(row.total)]));
    case "aging_summary":
      return table("Still due, in the document currency", ["Name", "Not yet due", "1 to 30 days", "31 to 60", "61 to 90", "Over 90"], rows(data.parties).map((row) => [String(row.party ?? ""), money(row.current, ""), money(row.days0to30, ""), money(row.days31to60, ""), money(row.days61to90, ""), money(row.over90, "")]));
    case "totals_by_period":
      return table("Totals by period", ["Period", "Nett", "VAT", "Total"], rows(data.periods).map((row) => [String(row.period ?? ""), money(row.nett), money(row.vat), money(row.total)]));
    case "vat_summary":
      return table("VAT", ["Group", "Nett", "VAT"], rows(data.groups).map((row) => [String(row.group ?? ""), money(row.nett), money(row.vat)]));
    case "search_transactions": {
      const documents = rows(data.documents);
      if (documents.length < 2) return null;
      return table("Documents", ["Number", "Name", "Status", "Date", "Due", "Still due"], documents.map((row) => [String(row.document_number ?? "Draft"), String(row.party_name ?? ""), String(row.status ?? ""), day(row.transaction_date), day(row.due_date), money(row.amount_due)]));
    }
    default:
      return null;
  }
}

export const SHOWN_NOTE = "A table of these figures is already on the person's screen. Do not make your own table or list them again. Say what stands out in one or two sentences.";
