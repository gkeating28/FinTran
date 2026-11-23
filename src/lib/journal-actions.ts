"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACCOUNTING_ACCOUNTS, JOURNAL_COLUMNS, journalCsvRows, type BatchDownloadLine } from "@/lib/journal";
import { requireCurrentOrganisation } from "@/lib/organisation-guard";
import { settingsOrganisation, settingsUrl } from "@/lib/org-settings";
import { createClient } from "@/lib/supabase/server";
import type { CsvCell } from "@/lib/export/safe-cell";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

/** Saves the accounts the journal uses and the date its history starts. Owners and admins only. */
export async function saveAccountingSettings(formData: FormData): Promise<void> {
  const current = await settingsOrganisation(formData);
  const startDate = text(formData, "start_date");
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) redirect(settingsUrl(current.organisationId, "accounting", "error", "Enter the start date as a date."));

  const values: Record<string, string | null> = { start_date: startDate || null };
  for (const account of ACCOUNTING_ACCOUNTS) values[account.column] = text(formData, account.column) || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("accounting_settings")
    .upsert({ tenant_id: current.tenantId, organisation_id: current.organisationId, ...values }, { onConflict: "organisation_id" });
  if (error) redirect(settingsUrl(current.organisationId, "accounting", "error", error.message || "The accounting settings could not be saved."));

  revalidatePath("/organisations");
  revalidatePath("/journal-export");
  redirect(settingsUrl(current.organisationId, "accounting", "message", "Saved."));
}

/** Makes a batch of everything not yet exported up to the date. The database refuses while anything cannot be journalled. */
export async function createJournalBatch(formData: FormData): Promise<void> {
  const current = await requireCurrentOrganisation(["owner", "admin"]);
  const upTo = text(formData, "up_to");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(upTo)) redirect("/journal-export?new=1&error=Choose%20the%20date%20to%20export%20up%20to.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_journal_batch", { p_organisation_id: current.organisationId, p_up_to: upTo });
  if (error) redirect(`/journal-export?new=1&upTo=${upTo}&error=${encodeURIComponent(error.message)}`);

  const batch = await supabase.from("journal_batches").select("number").eq("id", data).maybeSingle();
  revalidatePath("/journal-export");
  redirect(`/journal-export?message=${encodeURIComponent(`Batch JB-${String(batch.data?.number ?? 0).padStart(4, "0")} was made. Download it to send it on.`)}`);
}

/** The CSV of a batch exactly as it was made. Downloading is recorded in the audit log. */
export async function journalBatchCsv(batchId: string): Promise<{ name: string; columns: string[]; rows: CsvCell[][] } | { error: string }> {
  await requireCurrentOrganisation(["owner", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("journal_batch_lines_for", { p_batch_id: batchId });
  if (error) return { error: error.message || "That batch could not be downloaded." };
  const lines = (data ?? []) as BatchDownloadLine[];
  return { name: lines[0]?.batch_number ?? "journal", columns: JOURNAL_COLUMNS, rows: journalCsvRows(lines) };
}
