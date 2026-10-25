import { formatCurrencyRate, type CurrencyChoice, type CurrencyRow } from "@/lib/currencies";
import { getWorkspace } from "@/lib/data";
import { organisationLogoUrl } from "@/lib/organisation-logo";
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
      .select("id, code, name, rate, iso_code")
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
      isoCode: row.iso_code,
      home: row.id === homeCurrencyId,
    })),
    error: null,
  };
}

export type OrganisationProfile = {
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  city: string;
  postCode: string;
  county: string;
  countryCode: string;
  addressNeedsReview: boolean;
  contactName: string;
  contactEmail: string;
  website: string;
  phone: string;
  vatNumber: string;
  companyNumber: string;
  peppolScheme: string;
  peppolId: string;
  iban: string;
  bic: string;
  bankAccountName: string;
  bankingDetails: string;
  lockDate: string;
};

export const emptyOrganisationProfile: OrganisationProfile = {
  addressLine1: "",
  addressLine2: "",
  addressLine3: "",
  city: "",
  postCode: "",
  county: "",
  countryCode: "IE",
  addressNeedsReview: false,
  contactName: "",
  contactEmail: "",
  website: "",
  phone: "",
  vatNumber: "",
  companyNumber: "",
  peppolScheme: "",
  peppolId: "",
  iban: "",
  bic: "",
  bankAccountName: "",
  bankingDetails: "",
  lockDate: "",
};

export type OrganisationDefaultSet = {
  homeCurrencyId: string | null;
  currencies: CurrencyChoice[];
  profile: OrganisationProfile;
  logoUrl: string | null;
  hasDocuments: boolean;
};

export async function listIsoCurrencies(): Promise<{ code: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("ref_currencies").select("code, name").eq("active", true).order("name");
  return data ?? [];
}

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
      logoUrl: null,
      hasDocuments: false,
    };
  }
  if (organisationIds.length === 0) return { byOrganisation, error: null };

  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { byOrganisation, error: null };

  const supabase = await createClient();
  const [currencies, defaults, documents] = await Promise.all([
    supabase
      .from("currencies")
      .select("id, code, name, organisation_id")
      .in("organisation_id", organisationIds)
      .order("code"),
    supabase
      .from("organisation_defaults")
      .select(
        "organisation_id, home_currency_id, address_line1, address_line2, address_line3, city, post_code, county, country_code, address_needs_review, contact_name, contact_email, website, phone, vat_number, company_number, peppol_scheme, peppol_id, iban, bic, bank_account_name, banking_details, lock_date, logo_path, updated_at",
      )
      .in("organisation_id", organisationIds),
    Promise.all(
      organisationIds.map(async (organisationId) => {
        const result = await supabase
          .from("transaction_headers")
          .select("id", { count: "exact", head: true })
          .eq("organisation_id", organisationId);
        return { organisationId, count: result.count, error: result.error };
      }),
    ),
  ]);

  if (currencies.error || defaults.error || documents.some((result) => result.error)) {
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
      addressLine1: row.address_line1 ?? "",
      addressLine2: row.address_line2 ?? "",
      addressLine3: row.address_line3 ?? "",
      city: row.city ?? "",
      postCode: row.post_code ?? "",
      county: row.county ?? "",
      countryCode: row.country_code ?? "IE",
      addressNeedsReview: row.address_needs_review,
      contactName: row.contact_name ?? "",
      contactEmail: row.contact_email ?? "",
      website: row.website ?? "",
      phone: row.phone ?? "",
      vatNumber: row.vat_number ?? "",
      companyNumber: row.company_number ?? "",
      peppolScheme: row.peppol_scheme ?? "",
      peppolId: row.peppol_id ?? "",
      iban: row.iban ?? "",
      bic: row.bic ?? "",
      bankAccountName: row.bank_account_name ?? "",
      bankingDetails: row.banking_details ?? "",
      lockDate: row.lock_date ?? "",
    };
    set.logoUrl = row.logo_path ? organisationLogoUrl(row.organisation_id, row.updated_at) : null;
  }
  for (const result of documents) {
    const set = byOrganisation[result.organisationId];
    if (set) set.hasDocuments = (result.count ?? 0) > 0;
  }

  return { byOrganisation, error: null };
}
