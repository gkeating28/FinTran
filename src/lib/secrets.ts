import "server-only";
import { createClient } from "@/lib/supabase/server";
import { decryptSecret, type SecretKind } from "@/lib/secrets-crypto";

export { decryptSecret, encryptSecret, secretHint, type SecretKind } from "@/lib/secrets-crypto";

export async function getSecret(organisationId: string, kind: SecretKind) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("organisation_secret_ciphertext", {
    p_organisation_id: organisationId,
    p_kind: kind,
  });
  if (error || !data) return null;
  return decryptSecret(String(data), organisationId, kind);
}
