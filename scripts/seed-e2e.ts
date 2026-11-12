/**
 * Seeds the local Supabase stack for the end-to-end tests: three people, one tenant with two organisations, the
 * setup lists, a Purchases and a Sales type for each kind of document, and two customers and two suppliers.
 *
 * People are signed up through the sign-up API, as a real person would be, so no service-role key is used. The rest
 * is supabase/seed/e2e.sql, run with psql as the owner. Run it once against a freshly started stack:
 *
 *   npm run e2e:seed
 *
 * It refuses to touch anything that is not a local stack.
 */
import { spawnSync } from "node:child_process";
import { encryptSecret } from "../src/lib/secrets-crypto";
import { PEOPLE } from "../e2e/people";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const database = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const hmac = process.env.EINVOICE_HMAC_KEY ?? "";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) fail("NEXT_PUBLIC_SUPABASE_URL must be a local Supabase stack, such as http://127.0.0.1:54321.");
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(database)) fail("DATABASE_URL must be the local Supabase database.");
if (!key || !hmac) fail("Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and EINVOICE_HMAC_KEY first.");

async function signUp(person: (typeof PEOPLE)[keyof typeof PEOPLE]) {
  const response = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: key },
    body: JSON.stringify({ email: person.email, password: person.password, data: { display_name: person.name } }),
  });
  const body = (await response.json()) as { id?: string; user?: { id?: string }; msg?: string; message?: string };
  const id = body.user?.id ?? body.id;
  if (!response.ok || !id) fail(`Could not sign up ${person.email}: ${response.status} ${body.msg ?? body.message ?? ""}`);
  return id;
}

async function main() {
  const owner = await signUp(PEOPLE.owner);
  const admin = await signUp(PEOPLE.admin);
  const member = await signUp(PEOPLE.member);

  // The organisation id is not known until the SQL has made it, and the secret is tied to it. The mock provider
  // never reads the key, so any stored value will do as long as the app can decrypt it. It is encrypted again
  // for the real organisation by the second statement below.
  const placeholder = "pending";
  const seeded = spawnSync(
    "psql",
    [database, "-q", "-v", "ON_ERROR_STOP=1", "-v", `owner=${owner}`, "-v", `admin=${admin}`, "-v", `member=${member}`, "-v", `admin_email=${PEOPLE.admin.email}`, "-v", `member_email=${PEOPLE.member.email}`, "-v", `hmac=${hmac}`, "-v", `ai_secret=${placeholder}`, "-At", "-f", "supabase/seed/e2e.sql"],
    { encoding: "utf8" },
  );
  if (seeded.status !== 0) fail(`The seed SQL failed.\n${seeded.stdout}\n${seeded.stderr}`);
  const organisation = /e2e seed ok\|([0-9a-f-]{36})\|/.exec(seeded.stdout)?.[1];
  if (!organisation) fail(`The seed SQL did not report its organisation.\n${seeded.stdout}`);

  const secret = encryptSecret("mock-key", organisation, "ai_api_key");
  const stored = spawnSync(
    "psql",
    [database, "-q", "-v", "ON_ERROR_STOP=1", "-v", `owner=${owner}`, "-v", `organisation=${organisation}`, "-v", `secret=${secret}`, "-c", "select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, false)", "-c", "set role authenticated", "-c", "select public.set_organisation_secret(:'organisation'::uuid, 'ai_api_key', :'secret', 'mock')"],
    { encoding: "utf8" },
  );
  if (stored.status !== 0) fail(`The mock AI key could not be stored.\n${stored.stderr}`);
  console.log(`Seeded organisation ${organisation} with ${Object.keys(PEOPLE).length} people.`);
}

main().catch((error) => fail(String(error)));
