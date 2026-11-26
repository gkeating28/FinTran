/** What the Ledger screens share: the shapes they read, and the arithmetic that must agree with the database (QULAPLUS_LEDGER_SPEC.md). */

export const SOURCE_LABELS: Record<string, string> = {
  document: "Document",
  payment: "Payment",
  allocation: "Exchange difference",
  manual: "Manual",
  reversal: "Reversal",
};

export const SOURCE_TYPES = ["document", "payment", "allocation", "manual", "reversal"] as const;

export type JournalRow = {
  id: string;
  number: number | null;
  date: string;
  status: "draft" | "posted";
  sourceType: string;
  sourceRef: string;
  description: string;
  total: number;
  isOpening: boolean;
  reversed: boolean;
  reversesId: string | null;
  typeCode: string | null;
  openId: string | null;
};

export type EntryLine = {
  id: string;
  lineNumber: number;
  glCodeId: string;
  code: string;
  codeDescription: string;
  debit: number;
  credit: number;
  departmentCode: string;
  costCentreCode: string;
  description: string;
};

export type EntryDetail = JournalRow & {
  lines: EntryLine[];
  reversal: { id: string; number: number | null; date: string } | null;
  reversesNumber: number | null;
};

/** A line of a manual journal as the form holds it. Amounts are what was typed. */
export type ManualLine = { glCodeId: string; debit: string; credit: string; departmentId: string; costCentreId: string; description: string };
export type ManualDraft = { id: string | null; date: string; description: string; lines: ManualLine[] };

export const EMPTY_LINE: ManualLine = { glCodeId: "", debit: "", credit: "", departmentId: "", costCentreId: "", description: "" };

export function emptyDraft(date: string): ManualDraft {
  return { id: null, date, description: "", lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }] };
}

/** Typed text as whole cents. A comma is a thousands separator. Anything that is not a number is 0. */
export function cents(text: string | number | null | undefined) {
  if (text === null || text === undefined) return 0;
  const value = typeof text === "number" ? text : Number(String(text).replace(/,/g, "").trim());
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function fromCents(value: number) {
  return (value / 100).toFixed(2);
}

/** The live totals under a manual journal: debits, credits and the difference, in cents. */
export function journalTotals(lines: Pick<ManualLine, "debit" | "credit">[]) {
  const debit = lines.reduce((total, line) => total + cents(line.debit), 0);
  const credit = lines.reduce((total, line) => total + cents(line.credit), 0);
  return { debit, credit, difference: debit - credit };
}

/** Why a draft cannot be posted yet, or null. The database checks the same things again. */
export function postingProblem(draft: ManualDraft) {
  const used = draft.lines.filter((line) => line.glCodeId || cents(line.debit) || cents(line.credit));
  if (!draft.date) return "Enter the date of the journal.";
  if (!draft.description.trim()) return "Enter a description.";
  if (used.length < 2) return "A journal needs at least two lines.";
  for (const [index, line] of used.entries()) {
    if (!line.glCodeId) return `Line ${index + 1}: choose a GL code.`;
    if ((cents(line.debit) > 0) === (cents(line.credit) > 0)) return `Line ${index + 1}: enter either a debit or a credit.`;
  }
  const { difference } = journalTotals(used);
  if (difference !== 0) return `The journal is out by ${fromCents(Math.abs(difference))}.`;
  return null;
}

/** Where to open the document or payment an entry came from. A manual journal and a reversal of one have none. */
export function sourceHref(row: Pick<JournalRow, "typeCode" | "openId">) {
  if (!row.typeCode || !row.openId) return null;
  return `/transactions/${encodeURIComponent(row.typeCode)}?open=${row.openId}`;
}

export type TrialRow = {
  glCodeId: string;
  code: string;
  description: string;
  accountType: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

/** The report sections the account types belong to, in the order a trial balance reads. */
export const REPORT_SECTIONS: { title: string; types: string[] }[] = [
  { title: "Assets", types: ["Fixed Asset", "Current Asset"] },
  { title: "Liabilities", types: ["Current Liability", "Non-current Liability"] },
  { title: "Equity", types: ["Equity"] },
  { title: "Income", types: ["Income"] },
  { title: "Cost of sales and expenses", types: ["Cost of Sales", "Expense"] },
];

export type TrialSection = { title: string; rows: TrialRow[]; opening: number; debit: number; credit: number; closing: number };

const toCents = (value: number) => Math.round(value * 100);

export function groupTrialBalance(rows: TrialRow[]): { sections: TrialSection[]; totals: { opening: number; debit: number; credit: number; closing: number } } {
  const sections = REPORT_SECTIONS.map((section) => {
    const own = rows.filter((row) => section.types.includes(row.accountType));
    return {
      title: section.title,
      rows: own,
      opening: own.reduce((total, row) => total + toCents(row.opening), 0),
      debit: own.reduce((total, row) => total + toCents(row.debit), 0),
      credit: own.reduce((total, row) => total + toCents(row.credit), 0),
      closing: own.reduce((total, row) => total + toCents(row.closing), 0),
    };
  }).filter((section) => section.rows.length > 0);
  const totals = sections.reduce(
    (sum, section) => ({ opening: sum.opening + section.opening, debit: sum.debit + section.debit, credit: sum.credit + section.credit, closing: sum.closing + section.closing }),
    { opening: 0, debit: 0, credit: 0, closing: 0 },
  );
  return { sections, totals };
}

/** A trial balance agrees when debits equal credits and the closing balances add up to nothing. */
export function trialBalanceAgrees(totals: { debit: number; credit: number; closing: number }) {
  return totals.debit === totals.credit && totals.closing === 0;
}

/** A balance as the person reads it: debits less credits, shown as Dr or Cr. */
export function drCr(value: number) {
  if (value === 0) return "0.00";
  return `${(Math.abs(value) / 100).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${value > 0 ? "Dr" : "Cr"}`;
}

/** The range a trial balance opens on: this year so far. */
export function yearToDate(today: string) {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}
