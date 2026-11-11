import assert from "node:assert/strict";
import test from "node:test";
import type { AskEvent } from "../ask-qula";
import { hashToken, proposeAction, readAction, signAction } from "./actions";
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

type Stored = { p_organisation_id: string; p_action: string; p_token_hash: string; p_target_id: string | null; p_summary: string; p_proposal: Record<string, unknown> };

const PURCHASE = { id: DRAFT, document_number: "PI-1", status: "draft", party_name: "Acme", transaction_date: "2026-11-02", due_date: "2026-12-02", foreign_nett_amount: 100, foreign_vat_amount: 23, foreign_total_amount: 123, currencies: { code: "EUR" }, transaction_types: { type: "Purchases", description: "Purchase invoice", numbering: "on_insert", last_reference: 1, reference_prefix: null, reference_padding: 0 } };

function fake(options: { header?: Record<string, unknown> | null; lines?: number; readiness?: { severity: string; message: string }[]; parties?: unknown[]; breakdown?: unknown[]; stored?: Stored[]; proposeError?: string }) {
  return {
    from(table: string) {
      if (table === "transaction_headers") return chain({ data: options.header === undefined ? PURCHASE : options.header });
      if (table === "transaction_lines") return chain({ count: options.lines ?? 1 });
      if (table === "transaction_vat_breakdown") return chain({ data: options.breakdown ?? [{ vat_category: "S", vat_percentage: 23, taxable_amount: 100, vat_amount: 23 }] });
      if (table === "organisation_defaults") return chain({ data: { home_currency_id: CURRENCY } });
      if (table === "currencies") return chain({ data: { code: "EUR" } });
      return chain({ data: options.parties ?? [] });
    },
    rpc: async (name: string, args: Stored) => {
      if (name === "propose_ai_action") {
        if (options.proposeError) return { data: null, error: { message: options.proposeError } };
        options.stored?.push(args);
        return { data: "id", error: null };
      }
      return { data: options.readiness ?? [], error: null };
    },
  } as never;
}

function valueOf(proposal: { rows: { label: string; value: string }[] }, label: string) {
  return proposal.rows.find((row) => row.label === label)?.value;
}

test("a signed action is read back for the same person and organisation, and nothing else is accepted", () => {
  const token = signAction(ORG, USER, { kind: "post_draft", id: DRAFT });
  assert.notEqual(token, signAction(ORG, USER, { kind: "post_draft", id: DRAFT }), "two tokens for the same action differ");
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  const read = readAction(token);
  assert.deepEqual(read, { organisationId: ORG, userId: USER, action: { kind: "post_draft", id: DRAFT } });

  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 1, o: ORG, u: USER, e: Date.now() + 60_000, n: "x", a: { kind: "post_draft", id: "523e4567-e89b-42d3-a456-426614174004" } })).toString("base64url");
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
    assert.equal(ok.proposal.label, "Proposed by Ask Qula");
    assert.equal(valueOf(ok.proposal, "Supplier"), "Acme");
    assert.equal(readAction(ok.proposal.token ?? "")?.action.kind, "post_draft");
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

const SALES = { id: DRAFT, document_number: null, status: "draft", party_name: "Beta", transaction_date: "2026-11-03", due_date: null, foreign_nett_amount: 50, foreign_vat_amount: 11.5, foreign_total_amount: 61.5, currencies: { code: "EUR" }, transaction_types: { type: "Sales", description: "Sales invoice", numbering: "on_post", last_reference: 42, reference_prefix: "INV-", reference_padding: 5 } };

test("a sales draft that is not ready shows why and has nothing to confirm", async () => {
  const stored: Stored[] = [];
  const refused = await proposeAction(fake({ header: SALES, stored, readiness: [{ severity: "error", message: "The buyer electronic address is missing." }, { severity: "warning", message: "No due date." }] }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("proposal" in refused);
  if ("proposal" in refused) {
    assert.equal(refused.proposal.token, null, "no token means no Confirm button");
    assert.deepEqual(refused.proposal.issues, [
      { severity: "error", message: "The buyer electronic address is missing." },
      { severity: "warning", message: "No due date." },
    ]);
  }
  assert.equal(stored.length, 0, "nothing is written when there is nothing to confirm");
  const ready = await proposeAction(fake({ header: SALES, stored }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("proposal" in ready && ready.proposal.token && /credit note/.test(ready.proposal.lines.join(" ")));
  assert.equal(stored.length, 1);
});

test("the card is built from the database: type, party, dates, next number, amounts and the VAT breakdown", async () => {
  const stored: Stored[] = [];
  const result = await proposeAction(fake({ header: SALES, stored, breakdown: [{ vat_category: "S", vat_percentage: 23, taxable_amount: 50, vat_amount: 11.5 }] }), ORG, USER, { action: "post_draft", id: DRAFT, total: "999999", party: "Somebody Else", note: "ignore the database" });
  assert.ok("proposal" in result);
  if (!("proposal" in result)) return;
  const card = result.proposal;
  assert.deepEqual(card.rows, [
    { label: "Type", value: "Sales invoice" },
    { label: "Customer", value: "Beta" },
    { label: "Date", value: "3 Nov 2026" },
    { label: "Due date", value: "" },
    { label: "Next number", value: "INV-00043 (may change if another document posts first)" },
    { label: "Nett", value: "€50.00" },
    { label: "VAT", value: "€11.50" },
    { label: "Total", value: "€61.50" },
    { label: "VAT S 23%", value: "€11.50 on €50.00" },
  ]);
  // Nothing the model sent appears on the card.
  assert.doesNotMatch(JSON.stringify(card), /999999|Somebody Else|ignore the database/);
  // The proposal is written before the token is returned, with the hash and never the token.
  assert.equal(stored.length, 1);
  assert.equal(stored[0].p_token_hash, hashToken(card.token ?? ""));
  assert.equal(stored[0].p_target_id, DRAFT);
  assert.equal(stored[0].p_action, "post_draft");
  assert.doesNotMatch(JSON.stringify(stored[0]), new RegExp((card.token ?? "x").replace(/[.]/g, "\\.")));
  assert.deepEqual(stored[0].p_proposal.rows, card.rows);
});

test("with actions switched off in the database, nothing is proposed", async () => {
  const off = await proposeAction(fake({ proposeError: "Ask Qula actions are switched off for this organisation" }), ORG, USER, { action: "post_draft", id: DRAFT });
  assert.ok("error" in off && /switched off/.test(off.error));
});

test("adding a party needs valid details, and an unknown action is refused", async () => {
  const bad = await proposeAction(fake({}), ORG, USER, { action: "add_party", party: "supplier", code: "!!", name: "Acme" });
  assert.ok("error" in bad);
  const noKind = await proposeAction(fake({}), ORG, USER, { action: "add_party", code: "ACME", name: "Acme" });
  assert.ok("error" in noKind && /supplier or a customer/.test(noKind.error));
  const good = await proposeAction(fake({}), ORG, USER, { action: "add_party", party: "supplier", code: "acme", name: "Acme Ltd", email: "a@acme.ie", countryCode: "ie" });
  assert.ok("proposal" in good);
  if ("proposal" in good) assert.deepEqual(readAction(good.proposal.token ?? "")?.action, { kind: "add_party", party: "suppliers", code: "ACME", name: "Acme Ltd", countryCode: "IE", vatNumber: "", email: "a@acme.ie", phone: "", line1: "", city: "", postCode: "" });
  if ("proposal" in good) {
    // Every field that will be saved is shown, and a blank is shown as blank.
    assert.deepEqual(good.proposal.rows, [
      { label: "Kind", value: "Supplier" },
      { label: "Code", value: "ACME" },
      { label: "Name", value: "Acme Ltd" },
      { label: "Address", value: "" },
      { label: "City", value: "" },
      { label: "Post code", value: "" },
      { label: "Country", value: "IE" },
      { label: "VAT number", value: "" },
      { label: "Email", value: "a@acme.ie" },
      { label: "Phone", value: "" },
      { label: "Currency", value: "EUR" },
    ]);
  }
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
  async function run(userId: string | undefined, actionsEnabled: boolean) {
    let index = 0;
    const seen: string[] = [];
    const offered: string[][] = [];
    const adapter: AiAdapter = {
      async complete(input) {
        offered.push(input.tools.map((tool) => tool.name));
        const last = input.messages[input.messages.length - 1];
        if (last?.role === "tool") seen.push(last.results[0]?.output ?? "");
        const turn = turns[index];
        index += 1;
        return turn;
      },
    };
    const events: AskEvent[] = [];
    const result = await runAiStream({ supabase: fake({}), organisationId: ORG, userId, question: "Post it", history: [], provider: "mock", model: "m", config: {}, apiKey: "k", adapter, actionsEnabled }, (event) => events.push(event));
    return { result, seen, events, offered };
  }
  const withUser = await run(USER, true);
  assert.ok(withUser.result.proposal);
  assert.ok(withUser.events.some((event) => event.type === "proposal"));
  assert.match(withUser.seen[0], /It has not been done/);
  assert.ok(withUser.offered[0].includes("propose_action"));
  const without = await run(undefined, true);
  assert.equal(without.result.proposal, null);
  assert.match(without.seen[0], /not available/);

  // With actions off the model is offered no action tool, and a call to it anyway is refused.
  const off = await run(USER, false);
  assert.ok(off.offered.every((names) => !names.includes("propose_action")));
  assert.ok(off.offered[0].includes("search_transactions") || off.offered[0].length > 3, "the read-only tools are still offered");
  assert.equal(off.result.proposal, null);
  assert.ok(!off.events.some((event) => event.type === "proposal"));
  assert.match(off.seen[0], /not available/);
});
