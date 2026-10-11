import { getWorkspace } from "@/lib/data";
import { PARTY_META, type PartyKind, type PartyRow } from "@/lib/parties";
import { createClient } from "@/lib/supabase/server";

export async function listParties(kind: PartyKind): Promise<{
  rows: PartyRow[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(kind)
    .select("id, code, name, phone, email, website, address, contact_details, notes")
    .eq("organisation_id", workspace.current.organisationId)
    .order("code");

  if (error) return { rows: [], error: `${PARTY_META[kind].title} could not be loaded.` };

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      phone: row.phone ?? "",
      email: row.email ?? "",
      website: row.website ?? "",
      address: row.address ?? "",
      contactDetails: row.contact_details ?? "",
      notes: row.notes ?? "",
    })),
    error: null,
  };
}
