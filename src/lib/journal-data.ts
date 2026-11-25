import { getOrganisationScope } from "@/lib/data";
import {
  ACCOUNTING_ACCOUNTS,
  EMPTY_ACCOUNTING_SETTINGS,
  type AccountingSettings,
  type JournalBatchRow,
  type JournalLine,
  type JournalProblem,
} from "@/lib/journal";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

type PreviewRow = Database["public"]["Functions"]["journal_preview"]["Returns"][number];
type ProblemRow = Database["public"]["Functions"]["journal_problems"]["Returns"][number];

export type GlChoice = { id: string; code: string; description: string; accountType: string; systemRole: string | null };

/** The accounts the journal uses (the system roles on GL codes), the active GL codes to choose from and the start date. */
export async function getAccountingSettings(organisationId: string): Promise<{
  settings: AccountingSettings;
  glCodes: GlChoice[];
  error: string | null;
}> {
  if (!organisationId) return { settings: EMPTY_ACCOUNTING_SETTINGS, glCodes: [], error: null };

  const supabase = await createClient();
  const [row, codes] = await Promise.all([
    supabase.from("accounting_settings").select("start_date").eq("organisation_id", organisationId).maybeSingle(),
    supabase
      .from("gl_codes")
      .select("id, code, description, account_type, system_role")
      .eq("organisation_id", organisationId)
      .eq("active", true)
      .order("code"),
  ]);
  if (row.error || codes.error) {
    return { settings: EMPTY_ACCOUNTING_SETTINGS, glCodes: [], error: "The accounting settings could not be loaded." };
  }
  const glCodes = (codes.data ?? []).map((code) => ({
    id: code.id,
    code: code.code,
    description: code.description,
    accountType: code.account_type,
    systemRole: code.system_role,
  }));
  const holder = (role: string) => glCodes.find((code) => code.systemRole === role)?.id ?? "";
  const settings: AccountingSettings = { ...EMPTY_ACCOUNTING_SETTINGS, startDate: row.data?.start_date ?? "" };
  for (const account of ACCOUNTING_ACCOUNTS) settings[account.key] = holder(account.role);
  return { settings, glCodes, error: null };
}

/** The batches made so far, newest first. */
export async function listJournalBatches(): Promise<{ rows: JournalBatchRow[]; error: string | null }> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { rows: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_batches")
    .select("id, number, up_to, journal_count, line_count, total_debit, total_credit, created_at, created_by")
    .eq("organisation_id", organisationId)
    .order("number", { ascending: false });
  if (error) return { rows: [], error: "The export batches could not be loaded." };

  const ids = [...new Set((data ?? []).map((row) => row.created_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const profiles = await supabase.from("profiles").select("id, display_name").in("id", ids);
    for (const profile of profiles.data ?? []) names.set(profile.id, profile.display_name ?? "");
  }
  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      upTo: row.up_to,
      journalCount: row.journal_count,
      lineCount: row.line_count,
      totalDebit: Number(row.total_debit).toFixed(2),
      totalCredit: Number(row.total_credit).toFixed(2),
      createdAt: row.created_at,
      createdByName: row.created_by ? names.get(row.created_by) || null : null,
    })),
    error: null,
  };
}

/** What a batch up to this date would contain, and what stops one being made. Nothing is written. */
export async function getJournalPreview(upTo: string): Promise<{
  lines: JournalLine[];
  problems: JournalProblem[];
  startDate: string;
  error: string | null;
}> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { lines: [], problems: [], startDate: "", error: null };

  const supabase = await createClient();
  const [lines, problems, settings] = await Promise.all([
    supabase.rpc("journal_preview", { p_organisation_id: organisationId, p_up_to: upTo }),
    supabase.rpc("journal_problems", { p_organisation_id: organisationId, p_up_to: upTo }),
    supabase.from("accounting_settings").select("start_date").eq("organisation_id", organisationId).maybeSingle(),
  ]);
  if (lines.error || problems.error) return { lines: [], problems: [], startDate: "", error: "The journal could not be worked out." };

  return {
    lines: ((lines.data ?? []) as PreviewRow[]).map((row) => ({
      journalNumber: row.journal_number,
      lineNumber: row.line_number,
      journalDate: row.journal_date,
      accountCode: row.account_code,
      accountName: row.account_name,
      accountRole: row.account_role,
      description: row.description,
      debit: Number(row.debit).toFixed(2),
      credit: Number(row.credit).toFixed(2),
      currencyCode: row.currency_code,
      amountInCurrency: row.amount_in_currency === null ? null : Number(row.amount_in_currency).toFixed(2),
      departmentCode: row.department_code,
      costCentreCode: row.cost_centre_code,
      sourceKind: row.source_kind,
      sourceNumber: row.source_number,
      party: row.party,
      sourceRef: row.source_ref as JournalLine["sourceRef"],
      sourceId: row.source_id,
      stage: row.stage as JournalLine["stage"],
    })),
    problems: ((problems.data ?? []) as ProblemRow[]).map((row) => ({
      sourceRef: row.source_ref as JournalProblem["sourceRef"],
      sourceId: row.source_id,
      sourceKind: row.source_kind,
      sourceNumber: row.source_number,
      party: row.party,
      message: row.message,
    })),
    startDate: settings.data?.start_date ?? "",
    error: null,
  };
}
