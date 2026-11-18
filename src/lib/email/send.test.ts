import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverQueuedEmails } from "./send";
import type { EmailAdapter } from "./adapter";

function fakeClient(rows: object[]) {
  const results: { id: string; error?: string }[] = [];
  const client = {
    async rpc(name: string, args: { p_id?: string; p_error?: string }) {
      if (name === "queued_emails") return { data: rows, error: null };
      results.push({ id: args.p_id ?? "", error: args.p_error });
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { client, results };
}

const rows = [
  { id: "1", recipient_email: "a@x.test", recipient_name: "A", subject: "S1", body: "Body one", link_path: "/transactions/PI?open=9" },
  { id: "2", recipient_email: "b@x.test", recipient_name: "B", subject: "S2", body: "Body two", link_path: "/transactions/PI?open=9" },
];

test("every queued email goes to the adapter with a full link and is recorded sent", async () => {
  const seen: string[] = [];
  const adapter: EmailAdapter = { id: "t", async send(to, subject, text) { seen.push(`${to.email}|${subject}|${text}`); } };
  const { client, results } = fakeClient(rows);
  const outcome = await deliverQueuedEmails(client, "9", "https://app.test/", adapter);
  assert.deepEqual(outcome, { sent: 2, failed: 0 });
  assert.equal(seen.length, 2);
  assert.match(seen[0], /Open it: https:\/\/app\.test\/transactions\/PI\?open=9/);
  assert.deepEqual(results.map((r) => r.error), [undefined, undefined]);
});

test("a failing adapter marks the email failed with the reason and carries on", async () => {
  let calls = 0;
  const adapter: EmailAdapter = { id: "t", async send() { calls += 1; if (calls === 1) throw new Error("Mail server refused it"); } };
  const { client, results } = fakeClient(rows);
  const outcome = await deliverQueuedEmails(client, "9", "", adapter);
  assert.deepEqual(outcome, { sent: 1, failed: 1 });
  assert.equal(results[0].error, "Mail server refused it");
  assert.equal(results[1].error, undefined);
});

test("nothing queued sends nothing", async () => {
  const { client, results } = fakeClient([]);
  assert.deepEqual(await deliverQueuedEmails(client, "9", ""), { sent: 0, failed: 0 });
  assert.equal(results.length, 0);
});
