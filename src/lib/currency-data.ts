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

export type OrganisationProfile = {
  address: string;
  contactName: string;
  contactEmail: string;
  website: string;
  phone: string;
  vatNumber: string;
  companyNumber: string;
  bankingDetails: string;
};

export const emptyOrganisationProfile: OrganisationProfile = {
  address: "",
  contactName: "",
  contactEmail: "",
  website: "",
  phone: "",
  vatNumber: "",
  companyNumber: "",
  bankingDetails: "",
};

export type OrganisationDefaultSet = {
  homeCurrencyId: string | null;
  currencies: CurrencyChoice[];
  profile: OrganisationProfile;
};

export async function listDefaultsByOrganisation(organisationIds: string[]): Promise<{
  byOrganisation: Record<string, OrganisationDefaultSet>;
  error: string | null;
}> {
  const byOrganisation: Record<string, OrganisationDefaultSet> = {};
  for (const organisationId of organisationIds) {
    byOrganisation[organisationId] = {
      homeCurrencyId: null,
      currencies: [],
      profile: { ...emptyOrganisationProfile },
    };
  }
  if (organisationIds.length === 0) return { byOrganisation, error: null };

  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { byOrganisation, error: null };

  const supabase = await createClient();
  const [currencies, defaults] = await Promise.all([
    supabase
      .from("currencies")
      .select("id, code, name, organisation_id")
      .in("organisation_id", organisationIds)
      .order("code"),
    supabase
      .from("organisation_defaults")
      .select(
        "organisation_id, home_currency_id, address, contact_name, contact_email, website, phone, vat_number, company_number, banking_details",
      )
      .in("organisation_id", organisationIds),
  ]);

  if (currencies.error || defaults.error) {
    return { byOrganisation, error: "Organisation defaults could not be loaded." };
  }

  for (const row of currencies.data ?? []) {
    byOrganisation[row.organisation_id]?.currencies.push({
      id: row.id,
      code: row.code,
      name: row.name,
    });
  }
  for (const row of defaults.data ?? []) {
    const set = byOrganisation[row.organisation_id];
    if (!set) continue;
    set.homeCurrencyId = row.home_currency_id;
    set.profile = {
      address: row.address ?? "",
      contactName: row.contact_name ?? "",
      contactEmail: row.contact_email ?? "",
      website: row.website ?? "",
      phone: row.phone ?? "",
      vatNumber: row.vat_number ?? "",
      companyNumber: row.company_number ?? "",
      bankingDetails: row.banking_details ?? "",
    };
  }

  return { byOrganisation, error: null };
}
