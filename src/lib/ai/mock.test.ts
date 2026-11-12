import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiMessage } from "./adapter";
import { mockProvider } from "./mock";

const input = (messages: AiMessage[]) => ({ system: "", messages, tools: [] });

describe("mock provider", () => {
  it("answers a plain question in one line", async () => {
    const turn = await mockProvider().complete(input([{ role: "user", text: "How are we doing?" }]));
    assert.equal(turn.text, "Mock answer.");
    assert.deepEqual(turn.toolCalls, []);
  });

  it("looks up drafts for the party named after for", async () => {
    const turn = await mockProvider().complete(input([{ role: "user", text: "Which drafts do we have for Harbour?" }]));
    assert.deepEqual(turn.toolCalls, [{ id: "mock-search", name: "search_transactions", input: { status: "draft", party: "Harbour" } }]);
  });

  it("proposes posting the first draft found, then says it is waiting", async () => {
    const asked: AiMessage[] = [
      { role: "user", text: "Post the draft for Harbour" },
      { role: "assistant", text: "", toolCalls: [{ id: "mock-search", name: "search_transactions", input: {} }] },
      { role: "tool", results: [{ id: "mock-search", name: "search_transactions", output: JSON.stringify({ documents: [{ id: "d1" }, { id: "d2" }] }) }] },
    ];
    const proposing = await mockProvider().complete(input(asked));
    assert.deepEqual(proposing.toolCalls, [{ id: "mock-propose", name: "propose_action", input: { action: "post_draft", id: "d1" } }]);
    const done = await mockProvider().complete(input([
      ...asked,
      { role: "assistant", text: "", toolCalls: proposing.toolCalls },
      { role: "tool", results: [{ id: "mock-propose", name: "propose_action", output: "{}" }] },
    ]));
    assert.equal(done.text, "That is waiting for your confirmation.");
    assert.deepEqual(done.toolCalls, []);
  });

  it("says so when there is no draft to post", async () => {
    const turn = await mockProvider().complete(input([
      { role: "user", text: "Post the draft" },
      { role: "tool", results: [{ id: "mock-search", name: "search_transactions", output: JSON.stringify({ documents: [] }) }] },
    ]));
    assert.equal(turn.text, "There is no draft to post.");
  });
});
