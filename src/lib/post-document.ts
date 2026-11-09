import type { SupabaseClient } from "@supabase/supabase-js";
import { ORGANISATION_LOGO_BUCKET, organisationSnapshotPath } from "@/lib/organisation-logo";
import { friendlyError } from "@/lib/purchase-invoice-errors";
import { postedEInvoiceError, shouldGenerateEInvoice } from "@/lib/posted-einvoice";

/**
 * Posts a draft: copies the logo into the document, runs the posting function, and makes the e-invoice for a sales
 * invoice. The Post button and Ask Qula both use this, so they cannot differ. error means nothing was posted.
 * warning means it was posted but the e-invoice could not be made.
 */
export async function postDocumentNow(
  supabase: SupabaseClient,
  organisationId: string,
  id: string,
): Promise<{ error: string | null; warning: string | null }> {
  const defaults = await supabase.from("organisation_defaults").select("logo_path").eq("organisation_id", organisationId).maybeSingle();
  let logoPath: string | null = null;
  if (defaults.data?.logo_path) {
    logoPath = organisationSnapshotPath(organisationId, id);
    const copied = await supabase.storage.from(ORGANISATION_LOGO_BUCKET).copy(defaults.data.logo_path, logoPath);
    if (copied.error) {
      return { error: "The organisation logo could not be copied, so the document was not posted.", warning: null };
    }
  }
  const { error } = await supabase.rpc("post_document", { p_header_id: id, p_logo_path: logoPath });
  if (error) {
    if (logoPath) await supabase.storage.from(ORGANISATION_LOGO_BUCKET).remove([logoPath]);
    return { error: friendlyError(error, "That document could not be posted."), warning: null };
  }

  const posted = await supabase.from("transaction_headers").select("transaction_types(type, document_kind)").eq("id", id).maybeSingle();
  const kind = posted.data?.transaction_types as { type?: string; document_kind?: string } | { type?: string; document_kind?: string }[] | null;
  const typeRow = Array.isArray(kind) ? kind[0] : kind;
  if (shouldGenerateEInvoice(typeRow?.type, typeRow?.document_kind)) {
    try {
      const { createOutbound } = await import("@/lib/einvoice/store");
      await createOutbound(supabase, id, organisationId);
    } catch (generationError) {
      return { error: null, warning: postedEInvoiceError(generationError) };
    }
  }
  return { error: null, warning: null };
}
