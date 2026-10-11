import { getWorkspace } from "@/lib/data";
import { PARTY_META, type PartyCurrency, type PartyKind, type PartyRow } from "@/lib/parties";
import { createClient } from "@/lib/supabase/server";

function embeddedCode(value: { code: string } | { code: string }[] | null) {
  if (Array.isArray(value)) return value[0]?.code ?? "";
  return value?.code ?? "";
}

export async function listParties(kind: PartyKind): Promise<{
  rows: PartyRow[];
  currencies: PartyCurrency[];
  homeCurrencyId: string | null;
  error: string | null;
}> {
  const empty = { rows: [], currencies: [], homeCurrencyId: null, error: null };
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return empty;

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [parties, currencies, defaults] = await Promise.all([
    supabase
      .from(kind)
      .select("id, code, name, phone, email, website, address, contact_details, notes, currency_id, currencies(code)")
      .eq("organisation_id", organisationId)
      .order("code"),
    supabase.from("currencies").select("id, code, name").eq("organisation_id", organisationId).order("code"),
    supabase
      .from("organisation_defaults")
      .select("home_currency_id")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
  ]);

  if (parties.error || currencies.error || defaults.error) {
    return { ...empty, error: `${PARTY_META[kind].title} could not be loaded.` };
  }

  return {
    rows: (parties.data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      currencyId: row.currency_id,
      currencyCode: embeddedCode(row.currencies),
      phone: row.phone ?? "",
      email: row.email ?? "",
      website: row.website ?? "",
      address: row.address ?? "",
      contactDetails: row.contact_details ?? "",
      notes: row.notes ?? "",
    })),
    currencies: currencies.data ?? [],
    homeCurrencyId: defaults.data?.home_currency_id ?? null,
    error: null,
  };
}
