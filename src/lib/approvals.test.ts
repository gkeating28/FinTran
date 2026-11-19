import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalBanner, approvalLabel, approvalMatches, needsApproval, type ApprovalInfo } from "./approvals";

const base: ApprovalInfo = {
  state: "required", role: "admin", reason: "amount", requestedByName: "Una", requestedAt: "", decidedByName: "", decidedAt: "", note: "", self: false, canDecide: false, priceOver: false,
};

test("only an approved document is free to post", () => {
  assert.equal(needsApproval(null), false);
  assert.equal(needsApproval({ ...base, state: "required" }), true);
  assert.equal(needsApproval({ ...base, state: "requested" }), true);
  assert.equal(needsApproval({ ...base, state: "rejected" }), true);
  assert.equal(needsApproval({ ...base, state: "approved" }), false);
});

test("the status row says what to do", () => {
  assert.match(approvalBanner(base)?.text ?? "", /Needs approval/);
  assert.match(approvalBanner({ ...base, state: "requested", canDecide: true })?.text ?? "", /Approve or refuse/);
  assert.match(approvalBanner({ ...base, state: "requested" })?.text ?? "", /Waiting for approval/);
  assert.match(approvalBanner({ ...base, state: "rejected", decidedByName: "Ann", note: "Too dear" })?.text ?? "", /refused by Ann: Too dear/);
  assert.match(approvalBanner({ ...base, state: "approved", self: true })?.text ?? "", /as nobody else could/);
  assert.equal(approvalBanner(null), null);
});

test("price is named when the price is the reason", () => {
  assert.match(approvalBanner({ ...base, reason: "price" })?.text ?? "", /price over the order/);
  assert.match(approvalBanner({ ...base, reason: "amount and price" })?.text ?? "", /amount and a price/);
});

test("labels and filters agree", () => {
  assert.equal(approvalLabel({ ...base, state: "requested" }), "Waiting");
  assert.equal(approvalMatches({ ...base, state: "requested" }, "waiting"), true);
  assert.equal(approvalMatches({ ...base, state: "requested" }, "needs"), false);
  assert.equal(approvalMatches(undefined, "approved"), false);
  assert.equal(approvalMatches(undefined, ""), true);
});

test("a payment held back for new bank details says so", () => {
  assert.match(approvalBanner({ ...base, reason: "bank details" })?.text ?? "", /bank details changing recently/);
  assert.match(approvalBanner({ ...base, reason: "amount and bank details" })?.text ?? "", /its amount and the supplier's bank details/);
});
