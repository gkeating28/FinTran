import type { BankAccountChoice, BankAccountRow } from "@/lib/bank-accounts";
import { getOrganisationScope } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export async function listBankAccounts(): Promise<{
  rows: BankAccountRow[];
  currencies: BankAccountChoice[];
  glCodes: BankAccountChoice[];
  error: string | null;
}> {
  const organisationId = await getOrganisationScope();
  if (!organisationId) return { rows: [], currencies: [], glCodes: [], error: null };

  const supabase = await createClient();
  const [accounts, currencies, glCodes] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("id, code, name, iban, bic, currency_id, gl_code_id, active, is_default")
      .eq("organisation_id", organisationId)
      .order("code"),
    supabase.from("currencies").select("id, code, name").eq("organisation_id", organisationId).order("code"),
    supabase
      .from("gl_codes")
      .select("id, code, description")
      .eq("organisation_id", organisationId)
      .eq("account_type", "Current Asset")
      .order("code"),
  ]);

  if (accounts.error || currencies.error || glCodes.error) {
    return { rows: [], currencies: [], glCodes: [], error: "Bank accounts could not be loaded." };
  }

  const currencyChoices = (currencies.data ?? []).map((row) => ({ id: row.id, label: `${row.code} ${row.name}` }));
  const glChoices = (glCodes.data ?? []).map((row) => ({ id: row.id, label: `${row.code} ${row.description}` }));
  const currencyCode = new Map((currencies.data ?? []).map((row) => [row.id, row.code]));
  const glLabel = new Map(glChoices.map((choice) => [choice.id, choice.label]));

  return {
    rows: (accounts.data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      iban: row.iban,
      bic: row.bic ?? "",
      currencyId: row.currency_id,
      currencyCode: currencyCode.get(row.currency_id) ?? "",
      glCodeId: row.gl_code_id ?? "",
      glCodeLabel: row.gl_code_id ? (glLabel.get(row.gl_code_id) ?? "") : "",
      active: row.active,
      isDefault: row.is_default,
    })),
    currencies: currencyChoices,
    glCodes: glChoices,
    error: null,
  };
}
