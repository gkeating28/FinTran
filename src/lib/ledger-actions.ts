"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentOrganisation } from "@/lib/organisation-guard";
import { cents, fromCents, postingProblem, type ManualDraft } from "@/lib/ledger";
import { createClient } from "@/lib/supabase/server";

export type LedgerResult = { ok: true; id?: string; message?: string } | { ok: false; error: string; id?: string };

function failure(error: { message: string } | null, fallback: string): LedgerResult {
  return { ok: false, error: error?.message || fallback };
}

function refresh() {
  revalidatePath("/ledger");
  revalidatePath("/ledger/trial-balance");
  revalidatePath("/organisations");
  revalidatePath("/admin");
}

function payload(organisationId: string, draft: ManualDraft) {
  return {
    organisationId,
    id: draft.id,
    date: draft.date,
    description: draft.description,
    lines: draft.lines
      .filter((line) => line.glCodeId || cents(line.debit) || cents(line.credit))
      .map((line) => ({
        glCodeId: line.glCodeId,
        debit: fromCents(cents(line.debit)),
        credit: fromCents(cents(line.credit)),
        departmentId: line.departmentId,
        costCentreId: line.costCentreId,
        description: line.description,
      })),
  };
}

/** Saves a manual journal as a draft, and posts it when asked. A draft that cannot be posted stays saved. */
export async function saveJournal(draft: ManualDraft, post: boolean): Promise<LedgerResult> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  if (post) {
    const problem = postingProblem(draft);
    if (problem) return { ok: false, error: problem };
  }
  const supabase = await createClient();
  const saved = await supabase.rpc("save_manual_journal", { p_journal: payload(current.organisationId, draft) });
  if (saved.error || !saved.data) return failure(saved.error, "The journal could not be saved.");
  const id = String(saved.data);
  if (!post) {
    refresh();
    return { ok: true, id, message: "The journal was saved as a draft." };
  }
  const posted = await supabase.rpc("post_manual_journal", { p_entry_id: id });
  refresh();
  if (posted.error) return { ok: false, id, error: `Saved as a draft, but it was not posted. ${posted.error.message}` };
  return { ok: true, id, message: "The journal was posted." };
}

export async function deleteJournal(id: string): Promise<LedgerResult> {
  await requireCurrentOrganisation(["owner", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_manual_journal", { p_entry_id: id });
  if (error) return failure(error, "The journal could not be deleted.");
  refresh();
  return { ok: true, message: "The draft was deleted." };
}

export async function reverseJournal(id: string, date: string, description: string): Promise<LedgerResult> {
  await requireCurrentOrganisation(["owner", "admin"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Enter the date to reverse it on." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_journal", { p_entry_id: id, p_date: date, p_description: description.trim() || undefined });
  if (error) return failure(error, "The journal could not be reversed.");
  refresh();
  return { ok: true, id: String(data), message: "The journal was reversed." };
}

/** Posts the opening balance journal from lines of GL code, debit and credit. It is dated the day before go-live. */
export async function postOpeningJournal(draft: ManualDraft): Promise<LedgerResult> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const problem = postingProblem({ ...draft, date: "2000-01-01" });
  if (problem) return { ok: false, error: problem };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_opening_journal", { p_journal: payload(current.organisationId, { ...draft, id: null }) });
  if (error) return failure(error, "The opening balance journal could not be posted.");
  refresh();
  return { ok: true, id: String(data), message: "The opening balance journal was posted." };
}

/** The go-live date and whether exported periods are locked. Both are ordinary settings of the organisation. */
export async function saveLedgerSettings(input: { startDate: string; lockExported: boolean }): Promise<LedgerResult> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { ok: false, error: "Enter the go-live date as a date." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("organisation_defaults")
    .update({ ledger_start_date: input.startDate || null, lock_exported: input.lockExported })
    .eq("organisation_id", current.organisationId);
  if (error) return failure(error, "The ledger settings could not be saved.");
  refresh();
  return { ok: true, message: "The ledger settings were saved." };
}

/** Owners only. The reason goes in the audit log. */
export async function switchLedgerMode(mode: string, reason: string): Promise<LedgerResult> {
  const current = await requireCurrentOrganisation(["owner"]);
  if (mode !== "feed" && mode !== "book") return { ok: false, error: "Choose feed or book." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ledger_mode", { p_organisation_id: current.organisationId, p_mode: mode, p_reason: reason });
  if (error) return failure(error, "The mode could not be changed.");
  refresh();
  return { ok: true, message: mode === "book" ? "Qula Plus is now the book of record." : "Qula Plus now feeds your accounting system." };
}

export type LedgerFile = { name: string; columns: string[]; rows: (string | number | null)[][] };

const PAGE = 1000;

/** The chart of accounts, or every posted entry line, for an accountant to take away. Read in pages, because the API caps a read. */
export async function ledgerExport(file: "accounts" | "entries"): Promise<{ file: LedgerFile } | { error: string }> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const supabase = await createClient();
  const org = current.organisationId;

  const codes = await supabase
    .from("gl_codes")
    .select("id, code, description, account_type, system_role, active, external_code, external_name, report_group")
    .eq("organisation_id", org)
    .order("code");
  if (codes.error) return { error: "The chart of accounts could not be read." };

  if (file === "accounts") {
    return {
      file: {
        name: "chart-of-accounts",
        columns: ["Code", "Description", "Account type", "System role", "Active", "External code", "External name", "Report group"],
        rows: (codes.data ?? []).map((code) => [code.code, code.description, code.account_type, code.system_role, code.active ? "Yes" : "No", code.external_code, code.external_name, code.report_group]),
      },
    };
  }

  const [departments, costCentres, currencies] = await Promise.all([
    supabase.from("departments").select("id, code").eq("organisation_id", org),
    supabase.from("cost_centres").select("id, code").eq("organisation_id", org),
    supabase.from("currencies").select("id, code").eq("organisation_id", org),
  ]);
  const codeOf = new Map((codes.data ?? []).map((row) => [row.id, row]));
  const departmentOf = new Map((departments.data ?? []).map((row) => [row.id, row.code]));
  const costCentreOf = new Map((costCentres.data ?? []).map((row) => [row.id, row.code]));
  const currencyOf = new Map((currencies.data ?? []).map((row) => [row.id, row.code]));

  const entries = new Map<string, { number: number; date: string; source: string; ref: string; description: string }>();
  for (let from = 0; ; from += PAGE) {
    const page = await supabase
      .from("journal_entries")
      .select("id, entry_number, entry_date, source_type, source_ref, description")
      .eq("organisation_id", org)
      .eq("status", "posted")
      .order("entry_number")
      .range(from, from + PAGE - 1);
    if (page.error) return { error: "The journal entries could not be read." };
    for (const entry of page.data ?? []) {
      entries.set(entry.id, { number: entry.entry_number ?? 0, date: entry.entry_date, source: entry.source_type, ref: entry.source_ref ?? "", description: entry.description });
    }
    if ((page.data ?? []).length < PAGE) break;
  }

  const rows: (string | number | null)[][] = [];
  for (let from = 0; ; from += PAGE) {
    const page = await supabase
      .from("journal_lines")
      .select("entry_id, line_number, gl_code_id, department_id, cost_centre_id, debit, credit, currency_id, exchange_rate, foreign_amount, description")
      .eq("organisation_id", org)
      .order("entry_id")
      .order("line_number")
      .range(from, from + PAGE - 1);
    if (page.error) return { error: "The journal lines could not be read." };
    for (const line of page.data ?? []) {
      const entry = entries.get(line.entry_id);
      if (!entry) continue;
      const code = codeOf.get(line.gl_code_id);
      rows.push([
        entry.number, entry.date, entry.source, entry.ref, entry.description, code?.code ?? "", code?.description ?? "",
        Number(line.debit).toFixed(2), Number(line.credit).toFixed(2),
        line.department_id ? departmentOf.get(line.department_id) ?? "" : "", line.cost_centre_id ? costCentreOf.get(line.cost_centre_id) ?? "" : "",
        line.description ?? "", currencyOf.get(line.currency_id) ?? "", Number(line.foreign_amount).toFixed(2), Number(line.exchange_rate),
      ]);
    }
    if ((page.data ?? []).length < PAGE) break;
  }
  rows.sort((left, right) => Number(left[0]) - Number(right[0]));
  return {
    file: {
      name: "ledger-entries",
      columns: ["Entry", "Date", "Source", "Reference", "Entry description", "Account code", "Account name", "Debit", "Credit", "Department", "Cost centre", "Line description", "Currency", "Amount in currency", "Rate"],
      rows,
    },
  };
}
