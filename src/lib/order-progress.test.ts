import assert from "node:assert/strict";
import test from "node:test";
import { orderProgress } from "./order-progress";

test("an order with nothing invoiced has it all remaining", () => {
  assert.deepEqual(orderProgress([{ quantity: 10, nett: 100, drawn: 0 }]), { ordered: 100, invoiced: 0, remaining: 100, state: "none" });
});

test("a part invoiced line is valued at the order's price", () => {
  assert.deepEqual(orderProgress([{ quantity: 10, nett: 100, drawn: 4 }]), { ordered: 100, invoiced: 40, remaining: 60, state: "part" });
});

test("one line done and one untouched is part invoiced", () => {
  const progress = orderProgress([
    { quantity: 2, nett: 50, drawn: 2 },
    { quantity: 3, nett: 30, drawn: 0 },
  ]);
  assert.equal(progress.state, "part");
  assert.equal(progress.invoiced, 50);
  assert.equal(progress.remaining, 30);
});

test("every line fully drawn is fully invoiced", () => {
  const progress = orderProgress([
    { quantity: 2, nett: 50, drawn: 2 },
    { quantity: 3, nett: 30, drawn: 3 },
  ]);
  assert.deepEqual(progress, { ordered: 80, invoiced: 80, remaining: 0, state: "full" });
});

test("an order with no lines is not invoiced", () => {
  assert.equal(orderProgress([]).state, "none");
});
