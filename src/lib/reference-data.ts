import { getWorkspace } from "@/lib/data";
import { REFERENCE_META, type ReferenceKind, type ReferenceRow } from "@/lib/reference";
import { createClient } from "@/lib/supabase/server";

export async function listReference(kind: ReferenceKind): Promise<{
  rows: ReferenceRow[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(kind)
    .select("id, code, description")
    .eq("organisation_id", workspace.current.organisationId)
    .order("code");

  if (error) {
    return { rows: [], error: `${REFERENCE_META[kind].title} could not be loaded.` };
  }

  return { rows: (data ?? []) as ReferenceRow[], error: null };
}
