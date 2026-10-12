import { createClient } from "@/lib/supabase/server";

const ORGANISATION_TABLES = [
  "gl_codes",
  "departments",
  "cost_centres",
  "vat_rates",
  "currencies",
  "transaction_types",
  "organisation_access",
] as const;

type OrganisationTable = (typeof ORGANISATION_TABLES)[number];

export type AdminCounts = {
  glCodes: number | null;
  departments: number | null;
  costCentres: number | null;
  vatRates: number | null;
  currencies: number | null;
  transactionTypes: number | null;
  access: number | null;
  error: string | null;
};

async function countRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: OrganisationTable,
  organisationId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId);

  if (error || count === null) return null;
  return count;
}

export async function adminCounts(organisationId: string): Promise<AdminCounts> {
  const supabase = await createClient();
  const [glCodes, departments, costCentres, vatRates, currencies, transactionTypes, access] =
    await Promise.all([
      countRows(supabase, "gl_codes", organisationId),
      countRows(supabase, "departments", organisationId),
      countRows(supabase, "cost_centres", organisationId),
      countRows(supabase, "vat_rates", organisationId),
      countRows(supabase, "currencies", organisationId),
      countRows(supabase, "transaction_types", organisationId),
      countRows(supabase, "organisation_access", organisationId),
    ]);

  const counts = { glCodes, departments, costCentres, vatRates, currencies, transactionTypes, access };
  const error = Object.values(counts).some((count) => count === null)
    ? "Some totals could not be loaded."
    : null;

  return { ...counts, error };
}
