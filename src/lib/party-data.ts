import { getOrganisationScope } from "@/lib/data";
import { bankChangeSummary, PARTY_META, type PartyCurrency, type PartyKind, type PartyRow, type SupplierBankChange } from "@/lib/parties";
import { createClient } from "@/lib/supabase/server";

const SUPPLIER_SELECT =
  "id, code, name, phone, email, website, contact_details, notes, vat_number, company_number, peppol_scheme, peppol_id, payment_terms_days, iban, bic, bank_account_name, currency_id, currencies(code), address_line1, address_line2, address_line3, city, post_code, county, country_code, address_needs_review";

const CUSTOMER_SELECT =
  "id, code, name, phone, email, website, contact_details, notes, vat_number, company_number, peppol_scheme, peppol_id, payment_terms_days, default_buyer_reference, currency_id, currencies(code), address_line1, address_line2, address_line3, city, post_code, county, country_code, address_needs_review";

function embeddedCode(value: { code: string } | { code: string }[] | null) {
  if (Array.isArray(value)) return value[0]?.code ?? "";
  return value?.code ?? "";
}

function buyerReference(row: object) {
  const value = (row as { default_buyer_reference?: string | null }).default_buyer_reference;
  return value ?? "";
}

export async function listParties(kind: PartyKind): Promise<{
  rows: PartyRow[];
  currencies: PartyCurrency[];
  homeCurrencyId: string | null;
  bankChanges: SupplierBankChange[];
  error: string | null;
}> {
  const empty = { rows: [], currencies: [], homeCurrencyId: null, bankChanges: [], error: null };
  const organisationId = await getOrganisationScope();
  if (!organisationId) return empty;

  const supabase = await createClient();
  const partyQuery =
    kind === "customers"
      ? supabase.from("customers").select(CUSTOMER_SELECT).eq("organisation_id", organisationId).order("code")
      : supabase.from("suppliers").select(SUPPLIER_SELECT).eq("organisation_id", organisationId).order("code");
  // Only owners and admins can read the history, so a member gets none.
  const changeQuery =
    kind === "suppliers"
      ? supabase
          .from("supplier_bank_changes")
          .select("id, supplier_id, changed_at, old_iban, new_iban, old_bic, new_bic, old_account_name, new_account_name, profiles!supplier_bank_changes_changed_by_fkey(display_name)")
          .eq("organisation_id", organisationId)
          .order("changed_at", { ascending: false })
          .limit(200)
      : null;
  const [parties, currencies, defaults, changes] = await Promise.all([
    partyQuery,
    supabase.from("currencies").select("id, code, name").eq("organisation_id", organisationId).order("code"),
    supabase
      .from("organisation_defaults")
      .select("home_currency_id")
      .eq("organisation_id", organisationId)
      .maybeSingle(),
    changeQuery ?? Promise.resolve({ data: [], error: null }),
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
      addressLine1: row.address_line1 ?? "",
      addressLine2: row.address_line2 ?? "",
      addressLine3: row.address_line3 ?? "",
      city: row.city ?? "",
      postCode: row.post_code ?? "",
      county: row.county ?? "",
      countryCode: row.country_code ?? "IE",
      addressNeedsReview: row.address_needs_review,
      contactDetails: row.contact_details ?? "",
      notes: row.notes ?? "",
      vatNumber: row.vat_number ?? "",
      companyNumber: row.company_number ?? "",
      peppolScheme: row.peppol_scheme ?? "",
      peppolId: row.peppol_id ?? "",
      paymentTermsDays: row.payment_terms_days == null ? "" : String(row.payment_terms_days),
      defaultBuyerReference: buyerReference(row),
      iban: (row as { iban?: string | null }).iban ?? "",
      bic: (row as { bic?: string | null }).bic ?? "",
      bankAccountName: (row as { bank_account_name?: string | null }).bank_account_name ?? "",
    })),
    currencies: currencies.data ?? [],
    homeCurrencyId: defaults.data?.home_currency_id ?? null,
    bankChanges: ((changes.data ?? []) as Record<string, unknown>[]).map((change) => {
      const profile = Array.isArray(change.profiles) ? change.profiles[0] : change.profiles;
      return {
        id: String(change.id),
        supplierId: String(change.supplier_id),
        changedAt: String(change.changed_at),
        changedByName: String((profile as { display_name?: string } | null)?.display_name ?? ""),
        summary: bankChangeSummary(change as Parameters<typeof bankChangeSummary>[0]),
      };
    }),
    error: null,
  };
}
