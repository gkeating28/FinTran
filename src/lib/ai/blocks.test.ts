import assert from "node:assert/strict";
import test from "node:test";
import { autoBlock } from "./blocks";
import { runAiStream } from "./run";
import type { AiAdapter, AiMessage } from "./adapter";

test("figures from a lookup become a table the model does not have to write", () => {
  const top = autoBlock("top_parties", { parties: [{ party: "Acme", documents: 3, nett: "1000.00", total: "1230.00" }] });
  assert.deepEqual(top && top.type === "table" ? top.rows : null, [["Acme", "3", "€1,000.00", "€1,230.00"]]);
  const aging = autoBlock("aging_summary", { parties: [{ party: "Vodafone", current: "0.00", days0to30: "4920.00", days31to60: "0.00", days61to90: "0.00", over90: "0.00" }] });
  assert.equal(aging && aging.type === "table" ? aging.rows[0][2] : null, "4,920.00");
  assert.equal(autoBlock("vat_summary", { groups: [{ group: "Sales 23%", nett: "100.00", vat: "23.00" }] })?.type, "table");
  assert.equal(autoBlock("totals_by_period", { periods: [] }), null, "nothing to show");
  assert.equal(autoBlock("top_parties", { error: "x" }), null);
  assert.equal(autoBlock("get_transaction", { document: {} }), null);
  assert.equal(autoBlock("search_transactions", { documents: [{ document_number: "PI-1" }] }), null, "a single document is a card, not a table");
  const list = autoBlock("search_transactions", { documents: [{ document_number: "PI-1", party_name: "A", status: "posted", transaction_date: "2026-11-01", due_date: "2026-12-01", amount_due: "10.00" }, { document_number: "PI-2", party_name: "B", status: "draft", transaction_date: "2026-11-02", due_date: null, amount_due: "0.00" }] });
  assert.deepEqual(list && list.type === "table" ? list.rows[0] : null, ["PI-1", "A", "posted", "1 Nov 2026", "1 Dec 2026", "€10.00"]);
});

test("the table is shown automatically and the model is told not to repeat it", async () => {
  const seen: AiMessage[] = [];
  let step = 0;
  const adapter: AiAdapter = {
    async complete(input) {
      seen.push(...input.messages.slice(-1));
      step += 1;
      if (step === 1) return { text: "", toolCalls: [{ id: "t", name: "top_parties", input: {} }], inputTokens: 1, outputTokens: 1 };
      return { text: "Acme is the biggest.", toolCalls: [], inputTokens: 1, outputTokens: 1 };
    },
  };
  const query = () => {
    const promise = Promise.resolve({ data: [{ party_name: "Acme", home_nett_amount: 100, home_total_amount: 123, transaction_types: { type: "Purchases" } }], error: null });
    const api: Record<string, unknown> = { then: promise.then.bind(promise), catch: promise.catch.bind(promise) };
    for (const name of ["select", "eq", "ilike", "or", "gte", "lte", "lt", "gt", "in", "order", "limit"]) api[name] = () => api;
    return api;
  };
  const run = await runAiStream({ supabase: { from: query, rpc: async () => ({ data: [], error: null }) } as never, organisationId: "o", question: "Biggest suppliers?", history: [], provider: "mock", model: "m", config: {}, apiKey: "k", adapter });
  assert.equal(run.blocks.length, 1);
  assert.equal(run.blocks[0].type, "table");
  const tool = seen.find((message) => message.role === "tool");
  assert.match(tool && tool.role === "tool" ? tool.results[0].output : "", /already on the person's screen/);
  assert.equal(run.timings.firstTextMs !== null, true);
});
