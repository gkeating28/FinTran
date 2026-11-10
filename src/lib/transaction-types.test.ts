import assert from "node:assert/strict";
import test from "node:test";
import { documentKindLabel, documentStatusLabel, isOrderKind, parseDocumentKind, statusesForKind } from "./transaction-types";

test("orders and requisitions are the order family", () => {
  assert.equal(isOrderKind("order"), true);
  assert.equal(isOrderKind("requisition"), true);
  assert.equal(isOrderKind("invoice"), false);
  assert.equal(isOrderKind("credit_note"), false);
  assert.equal(isOrderKind(undefined), false);
});

test("each family has its own statuses", () => {
  assert.deepEqual(statusesForKind("invoice"), ["draft", "posted", "void"]);
  assert.deepEqual(statusesForKind("credit_note"), ["draft", "posted", "void"]);
  assert.deepEqual(statusesForKind("order"), ["draft", "open", "closed", "cancelled"]);
  assert.deepEqual(statusesForKind("requisition"), ["draft", "open", "closed", "cancelled"]);
});

test("a requisition is a known kind with a label", () => {
  assert.equal(parseDocumentKind("requisition"), "requisition");
  assert.equal(documentKindLabel("requisition"), "Requisition");
  assert.equal(documentStatusLabel("cancelled"), "Cancelled");
  assert.equal(documentStatusLabel("open"), "Active");
});
