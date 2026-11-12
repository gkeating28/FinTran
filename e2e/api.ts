import { PEOPLE, type Role } from "./people";

/**
 * Calls the local Supabase API as one of the test people, the way someone could without the app's screens. It is
 * used to check that the database refuses what the screens hide.
 */
export async function apiAs(role: Role) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set for the end-to-end tests.");
  const person = PEOPLE[role];
  const signedIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: person.email, password: person.password }),
  });
  const session = (await signedIn.json()) as { access_token?: string };
  if (!session.access_token) throw new Error(`${person.email} could not sign in to the API.`);
  const headers = { apikey: key, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };

  return {
    /** Calls a database function and returns the HTTP status and the error message, if any. */
    async rpc(name: string, args: Record<string, unknown>) {
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { status: response.status, message: body?.message ?? "" };
    },
    /** Reads rows of a table through the API, with PostgREST filters in the query string. */
    async select<T = Record<string, unknown>>(table: string, query: string) {
      const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!response.ok) throw new Error(`Reading ${table} failed with ${response.status}.`);
      return (await response.json()) as T[];
    },
    /** Updates rows through the API and returns the rows that changed. */
    async update<T = Record<string, unknown>>(table: string, query: string, values: Record<string, unknown>) {
      const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(values),
      });
      return { status: response.status, rows: response.ok ? ((await response.json()) as T[]) : [] };
    },
  };
}
