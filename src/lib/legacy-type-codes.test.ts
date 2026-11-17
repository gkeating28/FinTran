import assert from "node:assert/strict";
import test from "node:test";
import { currentCodeFor } from "./legacy-type-codes";

test("an old standard code maps to the current three-character code", () => {
  assert.equal(currentCodeFor("SI"), "SIN");
  assert.equal(currentCodeFor("pi"), "PIN");
  assert.equal(currentCodeFor(" PO "), "POR");
  assert.equal(currentCodeFor("REC"), "SRC");
  assert.equal(currentCodeFor("SREF"), "PRF");
  assert.equal(currentCodeFor("PP"), "PPY");
});

test("a current code or an unknown code has no replacement, so a redirect cannot loop", () => {
  for (const code of ["SIN", "PIN", "SRC", "PPY", "SRF", "PRF", "XYZ", ""]) assert.equal(currentCodeFor(code), null);
});

test("every replacement is a three-character code that is not itself replaced", () => {
  for (const old of ["PR", "PO", "PI", "PC", "SO", "SI", "SC", "REC", "PAY", "CREF", "SREF", "SR", "PP", "SF", "PF"]) {
    const next = currentCodeFor(old);
    assert.ok(next && next.length === 3, old);
    assert.equal(currentCodeFor(next), null, next);
  }
});
