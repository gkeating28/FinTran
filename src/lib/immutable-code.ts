export const CODE_LOCKED_ERROR = "A code cannot be changed.";

export const CODED_TABLES = [
  "gl_codes",
  "departments",
  "cost_centres",
  "vat_rates",
  "customers",
  "suppliers",
  "products",
  "currencies",
  "transaction_types",
] as const;

export type CodedTable = (typeof CODED_TABLES)[number];

type CodeQuery = {
  select(columns: string): {
    eq(column: string, value: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{
          data: { code?: unknown } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export function codeChangeMessage(storedCode: string | null, submittedCode: string, missing: string) {
  if (storedCode === null) return missing;
  if (storedCode !== submittedCode) return CODE_LOCKED_ERROR;
  return null;
}

export function friendlyCodeChange(error: { message: string } | null) {
  if (error?.message.includes("A code cannot be changed")) return CODE_LOCKED_ERROR;
  return null;
}

export async function codeChangeError(
  supabase: { from(table: string): unknown },
  table: CodedTable,
  id: string,
  organisationId: string,
  submittedCode: string,
  missing: string,
) {
  const { data, error } = await (supabase.from(table) as CodeQuery)
    .select("code")
    .eq("id", id)
    .eq("organisation_id", organisationId)
    .maybeSingle();

  if (error || !data || typeof data.code !== "string") return codeChangeMessage(null, submittedCode, missing);
  return codeChangeMessage(data.code, submittedCode, missing);
}
