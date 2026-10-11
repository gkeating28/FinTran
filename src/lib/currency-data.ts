import { formatCurrencyRate, type CurrencyChoice, type CurrencyRow } from "@/lib/currencies";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export async function listCurrencies(): Promise<{
  rows: CurrencyRow[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], error: null };

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [currencies, defaults] = await Promise.all([
    supabase
      .from("currencies")
      .select("id, code, name, rate")
      .eq("organisation_id", organisationId)
      .order("code"),
    supabase
      .from("organisation_defaults")
      .select("home_currency_id")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
  ]);

  if (currencies.error || defaults.error) {
    return { rows: [], error: "Currencies could not be loaded." };
  }

  const homeCurrencyId = defaults.data?.home_currency_id ?? null;
  return {
    rows: (currencies.data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      rate: formatCurrencyRate(row.rate),
      home: row.id === homeCurrencyId,
    })),
    error: null,
  };
}

export async function listOrganisationDefaults(): Promise<{
  currencies: CurrencyChoice[];
  homeCurrencyId: string | null;
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { currencies: [], homeCurrencyId: null, error: null };

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [currencies, defaults] = await Promise.all([
    supabase
      .from("currencies")
      .select("id, code, name")
      .eq("organisation_id", organisationId)
      .order("code"),
    supabase
      .from("organisation_defaults")
      .select("home_currency_id")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
  ]);

  if (currencies.error || defaults.error) {
    return { currencies: [], homeCurrencyId: null, error: "Defaults could not be loaded." };
  }

  return {
    currencies: currencies.data ?? [],
    homeCurrencyId: defaults.data?.home_currency_id ?? null,
    error: null,
  };
}
