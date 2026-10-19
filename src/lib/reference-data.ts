import { getWorkspace } from "@/lib/data";
import {
  parseAccountType,
  parseRate,
  parseVatType,
  REFERENCE_META,
  type ReferenceKind,
  type ReferenceRow,
  type VatCategoryChoice,
  type VatexChoice,
} from "@/lib/reference";
import { type CodeName } from "@/lib/code-lists";
import { createClient } from "@/lib/supabase/server";

export type { CodeName } from "@/lib/code-lists";

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
        vatCategory: null,
        exemptionCode: null,
        exemptionReason: null,
      })),
      error: null,
    };
  }

  if (kind === "vat_rates") {
    const { data, error } = await supabase
      .from("vat_rates")
      .select("id, code, description, rate, vat_type, vat_category, exemption_code, exemption_reason")
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
        vatCategory: row.vat_category,
        exemptionCode: row.exemption_code,
        exemptionReason: row.exemption_reason,
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
      vatCategory: null,
      exemptionCode: null,
      exemptionReason: null,
    })),
    error: null,
  };
}

export type CodeLists = {
  countries: CodeName[];
  schemes: CodeName[];
  currencies: CodeName[];
  error: string | null;
};

export async function listVatLookups(): Promise<{
  categories: VatCategoryChoice[];
  exemptions: VatexChoice[];
  error: string | null;
}> {
  const supabase = await createClient();
  const [categories, exemptions] = await Promise.all([
    supabase
      .from("ref_vat_categories")
      .select("code, name, requires_exemption_reason, rate_must_be_zero")
      .eq("active", true)
      .order("code"),
    supabase.from("ref_vatex").select("code, name").eq("active", true).order("code"),
  ]);
  if (categories.error || exemptions.error) {
    return { categories: [], exemptions: [], error: "VAT categories could not be loaded." };
  }
  return {
    categories: (categories.data ?? []).map((row) => ({
      code: row.code,
      name: row.name,
      requiresExemptionReason: row.requires_exemption_reason,
      rateMustBeZero: row.rate_must_be_zero,
    })),
    exemptions: exemptions.data ?? [],
    error: null,
  };
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
