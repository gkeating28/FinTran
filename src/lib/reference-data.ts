import { getWorkspace } from "@/lib/data";
import {
  parseAccountType,
  parseRate,
  parseVatType,
  REFERENCE_META,
  type ReferenceKind,
  type ReferenceRow,
} from "@/lib/reference";
import { createClient } from "@/lib/supabase/server";

export async function listReference(kind: ReferenceKind): Promise<{
  rows: ReferenceRow[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], error: null };

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;

  if (kind === "gl_codes") {
    const { data, error } = await supabase
      .from("gl_codes")
      .select("id, code, description, account_type")
      .eq("organisation_id", organisationId)
      .order("code");

    if (error) return { rows: [], error: `${REFERENCE_META.gl_codes.title} could not be loaded.` };

    return {
      rows: (data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        description: row.description,
        accountType: parseAccountType(row.account_type),
        rate: null,
        vatType: null,
      })),
      error: null,
    };
  }

  if (kind === "vat_rates") {
    const { data, error } = await supabase
      .from("vat_rates")
      .select("id, code, description, rate, vat_type")
      .eq("organisation_id", organisationId)
      .order("code");

    if (error) return { rows: [], error: `${REFERENCE_META.vat_rates.title} could not be loaded.` };

    return {
      rows: (data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        description: row.description,
        accountType: null,
        rate: parseRate(String(row.rate)),
        vatType: parseVatType(row.vat_type),
      })),
      error: null,
    };
  }

  const { data, error } = await supabase
    .from(kind)
    .select("id, code, description")
    .eq("organisation_id", organisationId)
    .order("code");

  if (error) {
    return { rows: [], error: `${REFERENCE_META[kind].title} could not be loaded.` };
  }

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      accountType: null,
      rate: null,
      vatType: null,
    })),
    error: null,
  };
}

export type CodeName = {
  code: string;
  name: string;
};

export type CodeLists = {
  countries: CodeName[];
  schemes: CodeName[];
  currencies: CodeName[];
  error: string | null;
};

export function countryChoices(countries: CodeName[]) {
  return [...countries].sort((left, right) => {
    if (left.code === "IE") return -1;
    if (right.code === "IE") return 1;
    return left.name.localeCompare(right.name);
  });
}

export async function listCodeLists(): Promise<CodeLists> {
  const supabase = await createClient();
  const [countries, schemes, currencies] = await Promise.all([
    supabase.from("ref_countries").select("code, name").eq("vat_prefix_only", false).eq("active", true).order("name"),
    supabase.from("ref_eas").select("code, name").eq("active", true).order("code"),
    supabase.from("ref_currencies").select("code, name").eq("active", true).order("code"),
  ]);

  if (countries.error || schemes.error || currencies.error) {
    return { countries: [], schemes: [], currencies: [], error: "Reference lists could not be loaded." };
  }

  return {
    countries: countries.data ?? [],
    schemes: schemes.data ?? [],
    currencies: currencies.data ?? [],
    error: null,
  };
}
