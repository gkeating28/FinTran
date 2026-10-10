import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/env";

type SigningKey = {
  kid: string;
  kty: string;
  alg?: string;
  crv?: string;
  x?: string;
  y?: string;
};

const TEN_MINUTES = 10 * 60 * 1000;

let cachedKeys: { keys: SigningKey[]; at: number } | null = null;

export async function signingKeys() {
  if (cachedKeys && Date.now() - cachedKeys.at < TEN_MINUTES) return cachedKeys.keys;

  const { url, key } = supabaseEnv();
  const response = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
    headers: { apikey: key },
    next: { revalidate: 600 },
  });

  if (!response.ok) return cachedKeys?.keys ?? [];

  const body = (await response.json()) as { keys?: SigningKey[] };
  const keys = body.keys ?? [];
  cachedKeys = { keys, at: Date.now() };
  return keys;
}

export async function readClaims(supabase: SupabaseClient) {
  const keys = await signingKeys();
  if (keys.length > 0) {
    const verified = await supabase.auth.getClaims(undefined, { jwks: { keys: keys as never } });
    if (!verified.error) return verified;
  }
  return supabase.auth.getClaims();
}
