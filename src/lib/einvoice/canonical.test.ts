import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "./canonical";

test("canonical JSON sorts keys and drops insignificant whitespace", () => {
  const value = { b: 1, a: { d: [true, null, "x"], c: "hi" } };
  assert.equal(canonicalJson(value), '{"a":{"c":"hi","d":[true,null,"x"]},"b":1}');
});
