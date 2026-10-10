import { cookies } from "next/headers";
import { ORGANISATION_COOKIE } from "@/lib/data";
import { REFERENCE_META, type ReferenceKind, type ReferenceRow } from "@/lib/reference";
import { createClient } from "@/lib/supabase/server";

export async function listReference(kind: ReferenceKind): Promise<{
  rows: ReferenceRow[];
  error: string | null;
}> {
  const organisationId = (await cookies()).get(ORGANISATION_COOKIE)?.value;
  if (!organisationId) return { rows: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(kind)
    .select("id, code, description")
    .eq("organisation_id", organisationId)
    .order("code");

  if (error) {
    return { rows: [], error: `${REFERENCE_META[kind].title} could not be loaded.` };
  }

  return { rows: (data ?? []) as ReferenceRow[], error: null };
}
