import assert from "node:assert/strict";
import test from "node:test";
import { AFTER_PAID, AFTER_SAVE, followOnFrom } from "./follow-on";

function form(value?: string) {
  const data = new FormData();
  if (value !== undefined) data.set("then_action", value);
  return data;
}

test("a plain save asks for nothing to follow", () => {
  assert.equal(followOnFrom(form(), AFTER_SAVE), null);
  assert.equal(followOnFrom(form(""), AFTER_SAVE), null);
});

test("a draft or an active order can be followed by post, activate, close, cancel or create", () => {
  for (const action of ["post", "open", "close", "cancel", "create_from_order"]) {
    assert.equal(followOnFrom(form(action), AFTER_SAVE), action);
  }
});

test("an action the save does not allow is ignored, so only the save happens", () => {
  // Reopen, void and delete never follow a save, and a posted document can only be followed by a credit note.
  for (const action of ["reopen", "void", "delete", "create_credit_note", "POST", "post; drop"]) {
    assert.equal(followOnFrom(form(action), AFTER_SAVE), null, action);
  }
  assert.equal(followOnFrom(form("create_credit_note"), AFTER_PAID), "create_credit_note");
  assert.equal(followOnFrom(form("post"), AFTER_PAID), null);
});
