import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { docHref } from "../ask-qula";
import { agingBands } from "./tools";
import { runAiAnswer } from "./run";
import type { AiMessage, AiTurn } from "./adapter";

type Case = { question: string; tools: string[]; facts: string[] };

const cases = JSON.parse(readFileSync("tests/ask-qula/cases.json", "utf8")) as Case[];
const organisationId = "org-a";

function query(data: unknown) {
  const promise = Promise.resolve({ data, error: null });
  const api = {
    select: () => api,
    eq: () => api,
    ilike: () => api,
    or: () => api,
    gte: () => api,
    lte: () => api,
    lt: () => api,
    gt: () => api,
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return api;
}

function fakeClient() {
  return {
    from(table: string) {
      if (table === "suppliers") return query([{ id: "s1", code: "ACME", name: "Acme", vat_number: "IE1" }]);
      if (table === "customers") return query([]);
      if (table === "transaction_headers") {
        return query([{
          id: "h1",
          document_number: "INV-12",
          status: "posted",
          party_name: "Acme",
          due_date: "2026-10-01",
          transaction_date: "2026-09-15",
          amount_due: 10,
          foreign_nett_amount: 8,
          foreign_vat_amount: 2,
          foreign_total_amount: 10,
          transaction_types: { type: "Purchases", code: "PI" },
        }]);
      }
      if (table === "transaction_lines") return query([{ line_number: 1, description: "Goods", nett_amount: 8, vat_amount: 2, price: 8, quantity: 1 }]);
      if (table === "e_documents") return query([{ id: "e1", document_number: "PINV-1", status: "valid", direction: "inbound" }]);
      return query([]);
    },
    rpc: async () => ({ data: [], error: null }),
  };
}

test("aging bands split overdue amounts", () => {
  const bands = agingBands([
    { party_name: "Acme", due_date: "2026-10-01", amount_due: 10 },
    { party_name: "Acme", due_date: "2026-11-20", amount_due: 5 },
  ], "2026-11-06");
  assert.equal(bands[0]?.party, "Acme");
  assert.equal(bands[0]?.days31to60, "10.00");
  assert.equal(bands[0]?.current, "5.00");
});

test("mock Ask Qula runs the listed tools and keeps answers inside the organisation", async () => {
  assert.ok(cases.length >= 30);
  for (const item of cases) {
    const called: string[] = [];
    let step = 0;
    const answer = await runAiAnswer({
      supabase: fakeClient() as never,
      organisationId,
      question: item.question,
      history: [] as AiMessage[],
      provider: "mock",
      model: "mock",
      config: {},
      apiKey: "test",
      adapter: {
        async complete(): Promise<AiTurn> {
          if (step < item.tools.length) {
            const name = item.tools[step];
            step += 1;
            called.push(name);
            return { text: "", toolCalls: [{ id: name, name, input: { name: "Acme", party: "Acme", number: "12" } }], inputTokens: 1, outputTokens: 1 };
          }
          if (item.facts.length === 0) return { text: "I do not have that data.", toolCalls: [], inputTokens: 1, outputTokens: 1 };
          return { text: item.facts.join(" "), toolCalls: [], inputTokens: 1, outputTokens: 1 };
        },
      },
    });
    assert.deepEqual(called, item.tools);
    for (const fact of item.facts) assert.match(answer.text, new RegExp(fact, "i"));
    assert.equal(called.includes("delete_all"), false);
    for (const card of answer.cards) {
      assert.equal(["h1", "e1"].includes(card.recordId ?? ""), true);
      // Every card opens its document.
      assert.notEqual(docHref(card), null, `card ${card.ref} has no link`);
    }
  }
});
