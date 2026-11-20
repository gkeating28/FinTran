import assert from "node:assert/strict";
import test from "node:test";
import {
  NAV_LIMIT,
  arrivedOpen,
  backTarget,
  cleanUrl,
  documentClosed,
  goneBack,
  isTracked,
  parseStack,
  visit,
  type NavEntry,
} from "./nav-history";

function walk(...urls: string[]) {
  return urls.reduce<NavEntry[]>((stack, url) => visit(stack, url), []);
}

test("back goes to the screen the person came from, not to a fixed parent", () => {
  const stack = walk("/", "/customers", "/suppliers");
  assert.equal(backTarget(stack), "/customers");
  assert.equal(backTarget(goneBack(stack)), "/");
  assert.equal(backTarget(goneBack(goneBack(stack))), null);
});

test("changing a filter or reloading the same screen adds no step", () => {
  const stack = walk("/reports", "/reports/aged-debtors", "/reports/aged-debtors?basis=document", "/reports/aged-debtors?basis=document&asOf=2026-11-01");
  assert.equal(stack.length, 2);
  assert.equal(backTarget(stack), "/reports");
  assert.equal(stack[1].url, "/reports/aged-debtors?basis=document&asOf=2026-11-01");
});

test("one-off signals are not kept, so coming back never reopens a document or repeats a message", () => {
  assert.equal(cleanUrl("/transactions/PIN?open=abc&error=Nope&direction=inbound"), "/transactions/PIN?direction=inbound");
  assert.equal(cleanUrl("/accounting?message=Saved."), "/accounting");
  const stack = walk("/transactions/PIN?open=abc", "/reports");
  assert.equal(backTarget(stack), "/transactions/PIN");
});

test("coming back to a screen brings back the address it had, with its filters", () => {
  let stack = walk("/reports/aged-debtors?basis=document", "/transactions/PIN?open=x");
  assert.equal(backTarget(stack), "/reports/aged-debtors?basis=document");
  stack = visit(goneBack(stack), "/reports/aged-debtors?basis=document");
  assert.equal(stack.length, 1);
});

test("a link that opens a document sends Back straight to where the link was, until the document is closed", () => {
  let stack = walk("/reports/aged-debtors", "/transactions/PIN?open=abc");
  assert.equal(arrivedOpen(stack), true);
  stack = documentClosed(stack);
  assert.equal(arrivedOpen(stack), false);
  // Going to another address of the same screen does not make it an arrival again, but a new open link does.
  stack = visit(stack, "/transactions/PIN");
  assert.equal(arrivedOpen(stack), false);
  stack = visit(stack, "/transactions/PIN?open=def");
  assert.equal(arrivedOpen(stack), true);
});

test("the browser's back button drops what was after the screen it returns to", () => {
  const stack = walk("/", "/customers", "/suppliers", "/reports");
  const back = visit(stack, "/customers", true);
  assert.deepEqual(back.map((entry) => entry.url), ["/", "/customers"]);
  assert.equal(backTarget(back), "/");
});

test("a browser move to a screen that is not in the record is added", () => {
  const stack = visit(walk("/", "/customers"), "/reports", true);
  assert.deepEqual(stack.map((entry) => entry.url), ["/", "/customers", "/reports"]);
});

test("the same screen visited twice, with another between, is two steps back", () => {
  const stack = walk("/customers", "/reports", "/customers");
  assert.equal(stack.length, 3);
  assert.equal(backTarget(stack), "/reports");
});

test("signing in or out starts the record again", () => {
  assert.equal(isTracked("/login"), false);
  assert.equal(isTracked("/auth/confirm"), false);
  assert.equal(isTracked("/customers"), true);
  assert.deepEqual(visit(walk("/", "/customers"), "/login"), []);
  assert.equal(backTarget(walk("/login", "/")), null);
});

test("the record is kept short", () => {
  const stack = walk(...Array.from({ length: NAV_LIMIT + 10 }, (_, index) => `/page-${index}`));
  assert.equal(stack.length, NAV_LIMIT);
  assert.equal(stack[stack.length - 1].url, `/page-${NAV_LIMIT + 9}`);
});

test("a damaged record is read as empty, and good entries are kept", () => {
  assert.deepEqual(parseStack("not json"), []);
  assert.deepEqual(parseStack(null), []);
  assert.deepEqual(parseStack('{"a":1}'), []);
  assert.deepEqual(parseStack('[{"url":"/a","arrivedOpen":true},{"url":42},{"url":"http://elsewhere"}]'), [{ url: "/a", arrivedOpen: true }]);
});
