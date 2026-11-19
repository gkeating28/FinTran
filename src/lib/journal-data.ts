import { getOrganisationScope } from "@/lib/data";
import {
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

export type GlChoice = { id: string; code: string; description: string };
export type BankWithoutGl = { id: string; code: string; name: string };

/** The accounting settings, the GL codes to choose from and the bank accounts that have no GL code yet. */
export async function getAccountingSettings(): Promise<{
  settings: AccountingSettings;
  glCodes: GlChoice[];
  banksWithoutGl: BankWithoutGl[];
  error: string | null;
}> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { settings: EMPTY_ACCOUNTING_SETTINGS, glCodes: [], banksWithoutGl: [], error: null };

  const supabase = await createClient();
  const [row, codes, banks] = await Promise.all([
    supabase
      .from("accounting_settings")
      .select("receivables_gl_code_id, payables_gl_code_id, vat_sales_gl_code_id, vat_purchases_gl_code_id, exchange_gl_code_id, rounding_gl_code_id, suspense_gl_code_id, start_date")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    supabase.from("gl_codes").select("id, code, description").eq("organisation_id", organisationId).order("code"),
    supabase.from("bank_accounts").select("id, code, name").eq("organisation_id", organisationId).eq("active", true).is("gl_code_id", null).order("code"),
  ]);
  if (row.error || codes.error || banks.error) {
    return { settings: EMPTY_ACCOUNTING_SETTINGS, glCodes: [], banksWithoutGl: [], error: "The accounting settings could not be loaded." };
  }
  const data = row.data;
  return {
    settings: {
      receivables: data?.receivables_gl_code_id ?? "",
      payables: data?.payables_gl_code_id ?? "",
      vatSales: data?.vat_sales_gl_code_id ?? "",
      vatPurchases: data?.vat_purchases_gl_code_id ?? "",
      exchange: data?.exchange_gl_code_id ?? "",
      rounding: data?.rounding_gl_code_id ?? "",
      suspense: data?.suspense_gl_code_id ?? "",
      startDate: data?.start_date ?? "",
    },
    glCodes: codes.data ?? [],
    banksWithoutGl: banks.data ?? [],
    error: null,
  };
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
