import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mockAdapter } from "../src/lib/ai/adapter.ts";

const cases = JSON.parse(readFileSync(new URL("../tests/ask-qula/cases.json", import.meta.url), "utf8"));
assert.ok(cases.length >= 30);
const adapter = mockAdapter([{ text: "Acme is due €10.", toolCalls: [{ id: "1", name: "aging_summary", input: {} }], inputTokens: 1, outputTokens: 1 }]);
const turn = await adapter.complete({ system: "", messages: [], tools: [] });
assert.equal(turn.toolCalls[0].name, "aging_summary");
console.log(`Ask Qula eval: ${cases.length} cases listed, mock adapter answered.`);
