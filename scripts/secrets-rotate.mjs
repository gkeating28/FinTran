import { createClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "../src/lib/secrets-crypto.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !process.env.QULA_SECRETS_KEYS || !process.env.QULA_SECRETS_KEY_ID) {
  console.log("Set the Supabase URL, publishable key, QULA_SECRETS_KEYS and QULA_SECRETS_KEY_ID before rotating.");
  process.exit(0);
}

const supabase = createClient(url, key);
const { data, error } = await supabase.from("organisation_secrets").select("organisation_id, kind, ciphertext");
if (error) throw error;
for (const row of data ?? []) {
  const value = decryptSecret(row.ciphertext, row.organisation_id, row.kind);
  const next = encryptSecret(value, row.organisation_id, row.kind);
  const { error: saved } = await supabase.rpc("set_organisation_secret", {
    p_organisation_id: row.organisation_id,
    p_kind: row.kind,
    p_ciphertext: next,
    p_hint: value.slice(-4),
  });
  if (saved) throw saved;
}
console.log(`Re-encrypted ${data?.length ?? 0} secrets with ${process.env.QULA_SECRETS_KEY_ID}.`);
