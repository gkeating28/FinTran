import { getOrganisationScope } from "@/lib/data";
import type { EntryDetail, EntryLine, JournalRow, ManualDraft, TrialRow } from "@/lib/ledger";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

type Rows<K extends keyof Database["public"]["Functions"]> = Database["public"]["Functions"][K]["Returns"];

export type LedgerChoice = { id: string; code: string; description: string; accountType: string; systemRole: string | null };
export type Named = { id: string; code: string; description: string };

export type JournalFilters = { from?: string; to?: string; source?: string; glCodeId?: string };

const JOURNAL_LIMIT = 500;

/** The newest entries that match, up to a limit, and how many match in all. */
export async function getJournals(filters: JournalFilters): Promise<{ rows: JournalRow[]; total: number; limit: number; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { rows: [], total: 0, limit: JOURNAL_LIMIT, error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ledger_journals", {
    p_organisation_id: organisationId,
    p_from: filters.from || undefined,
    p_to: filters.to || undefined,
    p_source: filters.source || undefined,
    p_gl_code_id: filters.glCodeId || undefined,
    p_limit: JOURNAL_LIMIT,
    p_offset: 0,
  });
  if (error) return { rows: [], total: 0, limit: JOURNAL_LIMIT, error: "The journals could not be loaded." };
  const rows = ((data ?? []) as Rows<"ledger_journals">).map((row) => ({
    id: row.entry_id,
    number: row.entry_number,
    date: row.entry_date,
    status: row.status as JournalRow["status"],
    sourceType: row.source_type,
    sourceRef: row.source_ref ?? "",
    description: row.description,
    total: Number(row.total),
    isOpening: row.is_opening,
    reversed: row.reversed,
    reversesId: row.reverses_entry_id,
    typeCode: row.type_code,
    openId: row.open_id,
  }));
  return { rows, total: Number((data as Rows<"ledger_journals"> | null)?.[0]?.total_count ?? 0), limit: JOURNAL_LIMIT, error: null };
}

/** The codes a manual journal can use (active, and not a control account), and the dimensions. */
export async function getLedgerChoices(): Promise<{ glCodes: LedgerChoice[]; allCodes: Named[]; departments: Named[]; costCentres: Named[]; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { glCodes: [], allCodes: [], departments: [], costCentres: [], error: null };
  const supabase = await createClient();
  const [codes, departments, costCentres] = await Promise.all([
    supabase.from("gl_codes").select("id, code, description, account_type, system_role, active").eq("organisation_id", organisationId).order("code"),
    supabase.from("departments").select("id, code, description").eq("organisation_id", organisationId).order("code"),
    supabase.from("cost_centres").select("id, code, description").eq("organisation_id", organisationId).order("code"),
  ]);
  if (codes.error || departments.error || costCentres.error) return { glCodes: [], allCodes: [], departments: [], costCentres: [], error: "The accounts could not be loaded." };
  return {
    // A journal can use any active code except a control account. The filters and the enquiry can look at every code.
    allCodes: (codes.data ?? []).map((code) => ({ id: code.id, code: code.code, description: code.description })),
    glCodes: (codes.data ?? [])
      .filter((code) => code.active && code.system_role !== "debtors_control" && code.system_role !== "creditors_control")
      .map((code) => ({ id: code.id, code: code.code, description: code.description, accountType: code.account_type, systemRole: code.system_role })),
    departments: departments.data ?? [],
    costCentres: costCentres.data ?? [],
    error: null,
  };
}

async function lookups(organisationId: string) {
  const supabase = await createClient();
  const [codes, departments, costCentres] = await Promise.all([
    supabase.from("gl_codes").select("id, code, description").eq("organisation_id", organisationId),
    supabase.from("departments").select("id, code").eq("organisation_id", organisationId),
    supabase.from("cost_centres").select("id, code").eq("organisation_id", organisationId),
  ]);
  return {
    codes: new Map((codes.data ?? []).map((row) => [row.id, row])),
    departments: new Map((departments.data ?? []).map((row) => [row.id, row.code])),
    costCentres: new Map((costCentres.data ?? []).map((row) => [row.id, row.code])),
  };
}

const ENTRY_COLUMNS =
  "id, entry_number, entry_date, status, source_type, source_ref, description, is_opening, reverses_entry_id, source_header_id, source_payment_id, source_allocation_id";

type EntryRecord = {
  id: string;
  entry_number: number | null;
  entry_date: string;
  status: string;
  source_type: string;
  source_ref: string | null;
  description: string;
  is_opening: boolean;
  reverses_entry_id: string | null;
};

function toRow(entry: EntryRecord, reversed: boolean, total: number): JournalRow {
  return {
    id: entry.id,
    number: entry.entry_number,
    date: entry.entry_date,
    status: entry.status as JournalRow["status"],
    sourceType: entry.source_type,
    sourceRef: entry.source_ref ?? "",
    description: entry.description,
    total,
    isOpening: entry.is_opening,
    reversed,
    reversesId: entry.reverses_entry_id,
    typeCode: null,
    openId: null,
  };
}

/** One entry with its lines, and the entry it reverses or is reversed by. */
export async function getEntry(id: string): Promise<{ entry: EntryDetail | null; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { entry: null, error: null };
  const supabase = await createClient();
  const [found, lines, reversal, names] = await Promise.all([
    supabase.from("journal_entries").select(ENTRY_COLUMNS).eq("organisation_id", organisationId).eq("id", id).maybeSingle(),
    supabase
      .from("journal_lines")
      .select("id, line_number, gl_code_id, department_id, cost_centre_id, debit, credit, description")
      .eq("organisation_id", organisationId)
      .eq("entry_id", id)
      .order("line_number"),
    supabase.from("journal_entries").select("id, entry_number, entry_date").eq("organisation_id", organisationId).eq("reverses_entry_id", id).maybeSingle(),
    lookups(organisationId),
  ]);
  if (found.error || lines.error || reversal.error) return { entry: null, error: "The journal could not be loaded." };
  if (!found.data) return { entry: null, error: null };

  const entryLines: EntryLine[] = (lines.data ?? []).map((line) => ({
    id: line.id,
    lineNumber: line.line_number,
    glCodeId: line.gl_code_id,
    code: names.codes.get(line.gl_code_id)?.code ?? "",
    codeDescription: names.codes.get(line.gl_code_id)?.description ?? "",
    debit: Number(line.debit),
    credit: Number(line.credit),
    departmentCode: line.department_id ? names.departments.get(line.department_id) ?? "" : "",
    costCentreCode: line.cost_centre_id ? names.costCentres.get(line.cost_centre_id) ?? "" : "",
    description: line.description ?? "",
  }));
  let reversesNumber: number | null = null;
  if (found.data.reverses_entry_id) {
    const original = await supabase.from("journal_entries").select("entry_number").eq("organisation_id", organisationId).eq("id", found.data.reverses_entry_id).maybeSingle();
    reversesNumber = original.data?.entry_number ?? null;
  }
  const total = entryLines.reduce((sum, line) => sum + Math.round(line.debit * 100), 0) / 100;
  const row = toRow(found.data, Boolean(reversal.data), total);
  const header = found.data.source_header_id;
  const payment = found.data.source_payment_id;
  if (header || payment) {
    const typed = header
      ? await supabase.from("transaction_headers").select("transaction_types(code)").eq("id", header).maybeSingle()
      : await supabase.from("payments").select("transaction_types(code)").eq("id", payment as string).maybeSingle();
    row.typeCode = (typed.data as { transaction_types: { code: string } | null } | null)?.transaction_types?.code ?? null;
    row.openId = header ?? payment;
  }
  return {
    entry: {
      ...row,
      lines: entryLines,
      reversal: reversal.data ? { id: reversal.data.id, number: reversal.data.entry_number, date: reversal.data.entry_date } : null,
      reversesNumber,
    },
    error: null,
  };
}

/** A draft manual journal, as the form holds it. */
export async function getDraft(id: string): Promise<{ draft: ManualDraft | null; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { draft: null, error: null };
  const supabase = await createClient();
  const [found, lines] = await Promise.all([
    supabase.from("journal_entries").select("id, entry_date, description, status, source_type").eq("organisation_id", organisationId).eq("id", id).maybeSingle(),
    supabase
      .from("journal_lines")
      .select("gl_code_id, department_id, cost_centre_id, debit, credit, description")
      .eq("organisation_id", organisationId)
      .eq("entry_id", id)
      .order("line_number"),
  ]);
  if (found.error || lines.error) return { draft: null, error: "The journal could not be loaded." };
  if (!found.data || found.data.status !== "draft" || found.data.source_type !== "manual") return { draft: null, error: null };
  return {
    draft: {
      id: found.data.id,
      date: found.data.entry_date,
      description: found.data.description,
      lines: (lines.data ?? []).map((line) => ({
        glCodeId: line.gl_code_id,
        debit: Number(line.debit) > 0 ? Number(line.debit).toFixed(2) : "",
        credit: Number(line.credit) > 0 ? Number(line.credit).toFixed(2) : "",
        departmentId: line.department_id ?? "",
        costCentreId: line.cost_centre_id ?? "",
        description: line.description ?? "",
      })),
    },
    error: null,
  };
}

export type TrialFilters = { from: string; to: string; departmentId?: string; costCentreId?: string };

export async function getTrialBalance(filters: TrialFilters): Promise<{ rows: TrialRow[]; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { rows: [], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trial_balance", {
    p_organisation_id: organisationId,
    p_from: filters.from,
    p_to: filters.to,
    p_department_id: filters.departmentId || undefined,
    p_cost_centre_id: filters.costCentreId || undefined,
  });
  if (error) return { rows: [], error: error.message.includes("starts on or before") ? "Choose a range that starts on or before it ends." : "The trial balance could not be worked out." };
  return {
    rows: ((data ?? []) as Rows<"trial_balance">).map((row) => ({
      glCodeId: row.gl_code_id,
      code: row.code,
      description: row.description,
      accountType: row.account_type,
      opening: Number(row.opening),
      debit: Number(row.debit),
      credit: Number(row.credit),
      closing: Number(row.closing),
    })),
    error: null,
  };
}

export type EnquiryLine = { id: string; entryId: string; number: number | null; date: string; sourceRef: string; description: string; debit: number; credit: number; balance: number };

export async function getAccountEnquiry(
  glCodeId: string,
  filters: TrialFilters,
): Promise<{ account: Named | null; opening: number; lines: EnquiryLine[]; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { account: null, opening: 0, lines: [], error: null };
  const supabase = await createClient();
  const [account, enquiry, trial] = await Promise.all([
    supabase.from("gl_codes").select("id, code, description").eq("organisation_id", organisationId).eq("id", glCodeId).maybeSingle(),
    supabase.rpc("account_enquiry", {
      p_organisation_id: organisationId,
      p_gl_code_id: glCodeId,
      p_from: filters.from,
      p_to: filters.to,
      p_department_id: filters.departmentId || undefined,
      p_cost_centre_id: filters.costCentreId || undefined,
    }),
    getTrialBalance(filters),
  ]);
  if (account.error || enquiry.error || trial.error) return { account: null, opening: 0, lines: [], error: "The account could not be loaded." };
  const lines = ((enquiry.data ?? []) as Rows<"account_enquiry">).map((line, index) => ({
    id: `${line.entry_id}-${index}`,
    entryId: line.entry_id,
    number: line.entry_number,
    date: line.entry_date,
    sourceRef: line.source_ref ?? "",
    description: line.description ?? "",
    debit: Number(line.debit),
    credit: Number(line.credit),
    balance: Number(line.balance),
  }));
  return { account: account.data, opening: trial.rows.find((row) => row.glCodeId === glCodeId)?.opening ?? 0, lines, error: null };
}

export type LedgerSettings = {
  mode: "feed" | "book";
  startDate: string;
  lockExported: boolean;
  exportedThrough: string;
  lockDate: string;
  openingPosted: boolean;
  drafts: number;
};

export async function getLedgerSettings(organisationId: string): Promise<{ settings: LedgerSettings | null; error: string | null }> {
  if (!organisationId) return { settings: null, error: null };
  const supabase = await createClient();
  const [defaults, opening, drafts] = await Promise.all([
    supabase.from("organisation_defaults").select("ledger_mode, ledger_start_date, lock_exported, exported_through, lock_date").eq("organisation_id", organisationId).maybeSingle(),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("is_opening", true),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("status", "draft"),
  ]);
  if (defaults.error || opening.error || drafts.error || !defaults.data) return { settings: null, error: "The ledger settings could not be loaded." };
  return {
    settings: {
      mode: defaults.data.ledger_mode === "book" ? "book" : "feed",
      startDate: defaults.data.ledger_start_date ?? "",
      lockExported: defaults.data.lock_exported,
      exportedThrough: defaults.data.exported_through ?? "",
      lockDate: defaults.data.lock_date ?? "",
      openingPosted: (opening.count ?? 0) > 0,
      drafts: drafts.count ?? 0,
    },
    error: null,
  };
}

/** The entries of one document or payment, for its Ledger tab. A member gets none, because the table hides them. */
export async function getSourceEntries(kind: "document" | "payment", id: string): Promise<JournalRow[]> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return [];
  const supabase = await createClient();
  const column = kind === "document" ? "source_header_id" : "source_payment_id";
  const entries = await supabase.from("journal_entries").select(ENTRY_COLUMNS).eq("organisation_id", organisationId).eq(column, id).order("entry_number");
  if (entries.error || !entries.data?.length) return [];
  const ids = entries.data.map((entry) => entry.id);
  const [lines, reversals] = await Promise.all([
    supabase.from("journal_lines").select("entry_id, debit").eq("organisation_id", organisationId).in("entry_id", ids),
    supabase.from("journal_entries").select("reverses_entry_id").eq("organisation_id", organisationId).in("reverses_entry_id", ids),
  ]);
  const reversed = new Set((reversals.data ?? []).map((row) => row.reverses_entry_id));
  return entries.data.map((entry) => {
    const total = (lines.data ?? []).filter((line) => line.entry_id === entry.id).reduce((sum, line) => sum + Math.round(Number(line.debit) * 100), 0) / 100;
    return toRow(entry, reversed.has(entry.id), total);
  });
}

export type ReconciliationRow = { check: string; ledger: number; subledger: number; difference: number };

/** The ledger against the subledgers: debtors, creditors, each bank account and debits against credits. Every difference should be 0. */
export async function getReconciliation(): Promise<{ rows: ReconciliationRow[]; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { rows: [], error: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ledger_reconciliation", { p_organisation_id: organisationId });
  if (error) return { rows: [], error: "The reconciliation could not be worked out." };
  return {
    rows: ((data ?? []) as Rows<"ledger_reconciliation">).map((row) => ({
      check: row.check_name,
      ledger: Number(row.ledger_amount),
      subledger: Number(row.subledger_amount),
      difference: Number(row.difference),
    })),
    error: null,
  };
}
