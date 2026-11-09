import assert from "node:assert/strict";
import test from "node:test";
import type { AskEvent } from "../ask-qula";
import { proposeAction, readAction, signAction } from "./actions";
import { runAiStream } from "./run";
import type { AiAdapter } from "./adapter";

process.env.EINVOICE_HMAC_KEY = Buffer.from("a test key that is long enough for hmac").toString("base64");
process.env.EINVOICE_HMAC_KEY_ID = "test";

const ORG = "123e4567-e89b-42d3-a456-426614174000";
const USER = "223e4567-e89b-42d3-a456-426614174001";
const DRAFT = "323e4567-e89b-42d3-a456-426614174002";
const CURRENCY = "423e4567-e89b-42d3-a456-426614174003";

function chain(result: { data?: unknown; count?: number }) {
  const promise = Promise.resolve({ data: result.data ?? null, count: result.count ?? 0, error: null });
  const api: Record<string, unknown> = { then: promise.then.bind(promise), catch: promise.catch.bind(promise), maybeSingle: () => promise };
  for (const name of ["select", "eq", "ilike", "or", "gte", "lte", "lt", "gt", "in", "order", "limit"]) api[name] = () => api;
  return api;
}

function fake(options: { header?: Record<string, unknown> | null; lines?: number; readiness?: { severity: string; message: string }[]; parties?: unknown[] }) {
  return {
    from(table: string) {
      if (table === "transaction_headers") return chain({ data: options.header === undefined ? { id: DRAFT, document_number: "PI-1", status: "draft", party_name: "Acme", foreign_total_amount: 120, currencies: { code: "EUR" }, transaction_types: { type: "Purchases", description: "Purchase invoice" } } : options.header });
      if (table === "transaction_lines") return chain({ count: options.lines ?? 1 });
      if (table === "organisation_defaults") return chain({ data: { home_currency_id: CURRENCY } });
      return chain({ data: options.parties ?? [] });
    },
    rpc: async () => ({ data: options.readiness ?? [], error: null }),
  } as never;
}

test("a signed action is read back for the same person and organisation, and nothing else is accepted", () => {
  const token = signAction(ORG, USER, { kind: "post_draft", id: DRAFT });
  const read = readAction(token);
  assert.deepEqual(read, { organisationId: ORG, userId: USER, action: { kind: "post_draft", id: DRAFT } });

  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 1, o: ORG, u: USER, e: Date.now() + 60_000, a: { kind: "post_draft", id: "523e4567-e89b-42d3-a456-426614174004" } })).toString("base64url");
  assert.equal(readAction(`${forged}.${signature}`), null, "a changed body fails");
  assert.equal(readAction(`${body}.${signature.slice(0, -2)}AA`), null, "a changed signature fails");
  assert.equal(readAction("not a token"), null);
  assert.equal(readAction(token, Date.now() + 11 * 60 * 1000), null, "it runs out after ten minutes");
});

test("a draft with lines is proposed in words, and a posted one or an empty one is refused", async () => {
  const ok = await proposeAction(fake({}), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("proposal" in ok);
  if ("proposal" in ok) {
    assert.equal(ok.proposal.title, "Post this purchase document?");
    assert.match(ok.proposal.lines.join(" "), /Acme/);
    assert.equal(readAction(ok.proposal.token)?.action.kind, "post_draft");
  }
  const posted = await proposeAction(fake({ header: { id: DRAFT, status: "posted", transaction_types: { type: "Purchases" } } }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("error" in posted && /posted/.test(posted.error));
  const empty = await proposeAction(fake({ lines: 0 }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("error" in empty && /no lines/.test(empty.error));
  const missing = await proposeAction(fake({ header: null }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("error" in missing);
  const notId = await proposeAction(fake({}), ORG, USER, { action: "post_draft", id: "the latest one" });
  assert.ok("error" in notId);
});

test("a sales draft that is not ready is refused with the reasons", async () => {
  const sales = { id: DRAFT, document_number: "SI-1", status: "draft", party_name: "Beta", foreign_total_amount: 50, currencies: { code: "EUR" }, transaction_types: { type: "Sales", description: "Sales invoice" } };
  const refused = await proposeAction(fake({ header: sales, readiness: [{ severity: "error", message: "The buyer electronic address is missing." }] }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("error" in refused && /buyer electronic address/.test(refused.error));
  const ready = await proposeAction(fake({ header: sales }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("proposal" in ready && /credit note/.test(ready.proposal.lines.join(" ")));
});

test("adding a party needs valid details, and an unknown action is refused", async () => {
  const bad = await proposeAction(fake({}), ORG, USER, { action: "add_party", party: "supplier", code: "!!", name: "Acme" });
  assert.ok("error" in bad);
  const noKind = await proposeAction(fake({}), ORG, USER, { action: "add_party", code: "ACME", name: "Acme" });
  assert.ok("error" in noKind && /supplier or a customer/.test(noKind.error));
  const good = await proposeAction(fake({}), ORG, USER, { action: "add_party", party: "supplier", code: "acme", name: "Acme Ltd", email: "a@acme.ie", countryCode: "ie" });
  assert.ok("proposal" in good);
  if ("proposal" in good) assert.deepEqual(readAction(good.proposal.token)?.action, { kind: "add_party", party: "suppliers", code: "ACME", name: "Acme Ltd", countryCode: "IE", vatNumber: "", email: "a@acme.ie", phone: "", line1: "", city: "", postCode: "" });
  const taken = await proposeAction(fake({ parties: [{ id: "x", name: "Acme Ltd" }] }), ORG, USER, { action: "add_party", party: "supplier", code: "ACME", name: "Acme Ltd", countryCode: "IE" });
  assert.ok("error" in taken && /already exists/.test(taken.error));
  const unknown = await proposeAction(fake({}), ORG, USER, { action: "void_everything" });
  assert.ok("error" in unknown);
});

test("the model can only propose: no proposal without a signed in person, and the model is told it is not done", async () => {
  const turns = [
    { text: "", toolCalls: [{ id: "p", name: "propose_action", input: { action: "post_draft", id: DRAFT } }], inputTokens: 1, outputTokens: 1 },
    { text: "It is waiting for your confirmation.", toolCalls: [], inputTokens: 1, outputTokens: 1 },
  ];
  async function run(userId?: string) {
    let index = 0;
    const seen: string[] = [];
    const adapter: AiAdapter = {
      async complete(input) {
        const last = input.messages[input.messages.length - 1];
        if (last?.role === "tool") seen.push(last.results[0]?.output ?? "");
        const turn = turns[index];
        index += 1;
        return turn;
      },
    };
    const events: AskEvent[] = [];
    const result = await runAiStream({ supabase: fake({}), organisationId: ORG, userId, question: "Post it", history: [], provider: "mock", model: "m", config: {}, apiKey: "k", adapter }, (event) => events.push(event));
    return { result, seen, events };
  }
  const withUser = await run(USER);
  assert.ok(withUser.result.proposal);
  assert.ok(withUser.events.some((event) => event.type === "proposal"));
  assert.match(withUser.seen[0], /It has not been done/);
  const without = await run(undefined);
  assert.equal(without.result.proposal, null);
  assert.match(without.seen[0], /not available/);
});
