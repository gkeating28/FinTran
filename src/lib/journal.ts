import type { CsvCell } from "@/lib/export/safe-cell";

/** One line of a journal as the database calculates it, with the amounts as text so no cent is lost. */
export type JournalLine = {
  journalNumber: number;
  lineNumber: number;
  journalDate: string;
  accountCode: string | null;
  accountName: string | null;
  accountRole: string;
  description: string;
  debit: string;
  credit: string;
  currencyCode: string | null;
  amountInCurrency: string | null;
  departmentCode: string | null;
  costCentreCode: string | null;
  sourceKind: string;
  sourceNumber: string | null;
  party: string | null;
  sourceRef: "document" | "payment" | "allocation";
  sourceId: string;
  stage: "post" | "reversal";
};

/** Something that stops a batch being made, with the document or payment it is on. */
export type JournalProblem = {
  sourceRef: "document" | "payment" | "allocation";
  sourceId: string;
  sourceKind: string;
  sourceNumber: string | null;
  party: string | null;
  message: string;
};

export type JournalGroup = {
  journalNumber: number;
  journalDate: string;
  sourceKind: string;
  sourceNumber: string | null;
  party: string | null;
  stage: "post" | "reversal";
  debit: number;
  credit: number;
  lines: JournalLine[];
};

export type JournalBatchRow = {
  id: string;
  number: number;
  upTo: string;
  journalCount: number;
  lineCount: number;
  totalDebit: string;
  totalCredit: string;
  createdAt: string;
  createdByName: string | null;
};

export type AccountingSettings = {
  receivables: string;
  payables: string;
  vatSales: string;
  vatPurchases: string;
  exchange: string;
  rounding: string;
  suspense: string;
  startDate: string;
};

export const EMPTY_ACCOUNTING_SETTINGS: AccountingSettings = {
  receivables: "",
  payables: "",
  vatSales: "",
  vatPurchases: "",
  exchange: "",
  rounding: "",
  suspense: "",
  startDate: "",
};

/** The seven accounts, the system role and account type each needs, what each is for, and the form field that holds it. */
export const ACCOUNTING_ACCOUNTS = [
  { key: "receivables", role: "debtors_control", accountType: "Current Asset", column: "receivables_gl_code_id", label: "Receivables", help: "Control account for what customers owe. Every sales invoice, credit note and customer payment goes to it." },
  { key: "payables", role: "creditors_control", accountType: "Current Liability", column: "payables_gl_code_id", label: "Payables", help: "Control account for what is owed to suppliers. Every purchase invoice, credit note and supplier payment goes to it." },
  { key: "vatSales", role: "vat_output", accountType: "Current Liability", column: "vat_sales_gl_code_id", label: "VAT on sales", help: "The VAT charged on sales documents, whatever the rate." },
  { key: "vatPurchases", role: "vat_input", accountType: "Current Asset", column: "vat_purchases_gl_code_id", label: "VAT on purchases", help: "The VAT paid on purchase documents, whatever the rate." },
  { key: "exchange", role: "fx_difference", accountType: "Expense", column: "exchange_gl_code_id", label: "Exchange gain or loss", help: "Needed only when a payment settles a foreign currency document at a different rate." },
  { key: "rounding", role: "rounding", accountType: "Expense", column: "rounding_gl_code_id", label: "Rounding", help: "Needed only when a document carries a rounding amount." },
  { key: "suspense", role: "suspense", accountType: "Current Asset", column: "suspense_gl_code_id", label: "Suspense", help: "Used for a posted purchase line that has no GL code, such as one on an imported e-invoice, so it can still be exported. It is marked (no GL code) so it can be recoded in your accounting system. Needed only when such a line exists." },
] as const;

export const JOURNAL_COLUMNS = [
  "Batch",
  "Journal",
  "Date",
  "Account code",
  "Account name",
  "Description",
  "Debit",
  "Credit",
  "Currency",
  "Amount in currency",
  "Department",
  "Cost centre",
  "Source kind",
  "Source number",
  "Party",
];

export type BatchDownloadLine = {
  journal_number: string;
  journal_date: string;
  account_code: string;
  account_name: string;
  description: string;
  debit: number | string;
  credit: number | string;
  currency_code: string | null;
  amount_in_currency: number | string | null;
  department_code: string | null;
  cost_centre_code: string | null;
  source_kind: string;
  source_number: string | null;
  party: string | null;
  batch_number: string;
};

function twoDecimals(value: number | string | null) {
  if (value === null || value === undefined || value === "") return "";
  return Number(value).toFixed(2);
}

/** The rows of the journal CSV (J14): one for each journal line, amounts with two decimals. The CSV builder makes any text that could run as a formula safe. */
export function journalCsvRows(lines: BatchDownloadLine[]): CsvCell[][] {
  return lines.map((line) => [
    line.batch_number,
    line.journal_number,
    line.journal_date,
    line.account_code,
    line.account_name,
    line.description,
    twoDecimals(line.debit),
    twoDecimals(line.credit),
    line.currency_code,
    twoDecimals(line.amount_in_currency),
    line.department_code,
    line.cost_centre_code,
    line.source_kind,
    line.source_number,
    line.party,
  ]);
}

/** The preview's lines gathered into journals, each with its totals. */
export function groupJournals(lines: JournalLine[]): JournalGroup[] {
  const groups = new Map<number, JournalGroup>();
  for (const line of lines) {
    let group = groups.get(line.journalNumber);
    if (!group) {
      group = {
        journalNumber: line.journalNumber,
        journalDate: line.journalDate,
        sourceKind: line.sourceKind,
        sourceNumber: line.sourceNumber,
        party: line.party,
        stage: line.stage,
        debit: 0,
        credit: 0,
        lines: [],
      };
      groups.set(line.journalNumber, group);
    }
    group.debit += Number(line.debit);
    group.credit += Number(line.credit);
    group.lines.push(line);
  }
  return [...groups.values()].sort((a, b) => a.journalNumber - b.journalNumber);
}

/** How many journals are dated more than a year before the date, for the note shown while there is no start date. */
export function journalsOlderThanAYear(groups: JournalGroup[], upTo: string) {
  const limit = new Date(`${upTo}T00:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() - 1);
  const cutoff = limit.toISOString().slice(0, 10);
  return groups.filter((group) => group.journalDate < cutoff).length;
}

/** The page address that fixes a problem: the document or payment, or the setting it needs. */
export function problemLink(problem: JournalProblem) {
  if (/accounting settings/.test(problem.message)) return { href: "/accounting", label: "Accounting settings" };
  if (/^Bank account/.test(problem.message)) return { href: "/bank-accounts", label: "Bank accounts" };
  if (problem.sourceRef === "payment") return { href: "/transactions", label: "Transactions" };
  return { href: "/transactions", label: "Transactions" };
}

export function parseUpTo(value: string | undefined, today: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
}
