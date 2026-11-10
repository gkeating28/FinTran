/** How much of an order has been invoiced, worked out from its lines. */
export type OrderProgress = {
  /** Nett value ordered. */
  ordered: number;
  /** Nett value of the quantities already on invoices, at the order's prices. */
  invoiced: number;
  /** Nett value still to invoice. */
  remaining: number;
  state: "none" | "part" | "full";
};

export type OrderProgressLine = {
  quantity: number;
  nett: number;
  /** Quantity taken by invoices that are not void. */
  drawn: number;
};

function cents(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * The limit on an order is by quantity, so progress is measured line by line and then valued at the
 * order's own nett amounts. That gives one figure for an order whose lines have different units.
 */
export function orderProgress(lines: OrderProgressLine[]): OrderProgress {
  let ordered = 0;
  let invoiced = 0;
  let anyDrawn = false;
  let allDrawn = lines.length > 0;
  for (const line of lines) {
    ordered += line.nett;
    if (line.quantity <= 0) continue;
    const share = Math.min(1, Math.max(0, line.drawn / line.quantity));
    invoiced += line.nett * share;
    if (line.drawn > 0) anyDrawn = true;
    if (line.drawn < line.quantity) allDrawn = false;
  }
  return {
    ordered: cents(ordered),
    invoiced: cents(invoiced),
    remaining: cents(Math.max(0, ordered - invoiced)),
    state: !anyDrawn ? "none" : allDrawn ? "full" : "part",
  };
}

export const ORDER_PROGRESS_LABEL: Record<OrderProgress["state"], string> = {
  none: "Not invoiced",
  part: "Part invoiced",
  full: "Fully invoiced",
};
