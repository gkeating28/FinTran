import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readClaims } from "@/lib/supabase/claims";
import { supabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PREFIXES = ["/login", "/signup", "/auth"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([header, value]) =>
          supabaseResponse.headers.set(header, value),
        );
      },
    },
  });

  const { data } = await readClaims(supabase);
  const user = data?.claims;
  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!user && !isPublic) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
