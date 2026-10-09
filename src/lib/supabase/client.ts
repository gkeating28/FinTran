import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
