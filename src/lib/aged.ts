/** The ageing report: what is still owed by customers (aged debtors) or to suppliers (aged creditors), by how late it is. */

export type AgedDirection = "Sales" | "Purchases";

export type AgedBand = "current" | "d30" | "d60" | "d90" | "over";

export const AGED_BANDS: { key: AgedBand; label: string }[] = [
  { key: "current", label: "Not yet due" },
  { key: "d30", label: "1 to 30 days" },
  { key: "d60", label: "31 to 60 days" },
  { key: "d90", label: "61 to 90 days" },
  { key: "over", label: "Over 90 days" },
];

const DAY = 86_400_000;

/** Whole days between the due date and the ageing date. Zero or less is not yet due. A missing due date counts as due on the day. */
export function daysLate(dueDate: string | null, asOf: string) {
  const due = Date.parse(dueDate ?? "");
  const today = Date.parse(asOf);
  if (Number.isNaN(due) || Number.isNaN(today)) return 0;
  return Math.floor((today - due) / DAY);
}

/** The band a number of days late falls in. Ask Qula's ageing uses this too, so the two always agree. */
export function bandOf(days: number): AgedBand {
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "over";
}

/** One thing that makes up a balance: an invoice, a credit note, or money received or paid that is not yet applied. */
export type AgedItem = {
  id: string;
  kind: "invoice" | "credit_note" | "on_account";
  typeCode: string;
  number: string;
  partyId: string;
  party: string;
  date: string;
  dueDate: string | null;
  /** In the home currency. Credit notes and money on account are negative: they reduce what is owed. */
  amount: number;
};

export type AgedLine = AgedItem & { days: number; band: AgedBand | "on_account" };

export type AgedParty = {
  id: string;
  party: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  over: number;
  onAccount: number;
  total: number;
  lines: AgedLine[];
};

export type AgedReport = {
  asOf: string;
  parties: AgedParty[];
  totals: Omit<AgedParty, "id" | "party" | "lines">;
};

function cents(value: number) {
  return Math.round(value * 100) / 100;
}

/** Groups the items by party and sorts each into a band by how late it is on the ageing date. Largest balance first. */
export function buildAged(items: AgedItem[], asOf: string): AgedReport {
  const byParty = new Map<string, AgedParty>();
  for (const item of items) {
    if (!Number.isFinite(item.amount) || item.amount === 0) continue;
    const key = item.partyId || item.party || "unknown";
    const entry =
      byParty.get(key) ??
      { id: key, party: item.party || "Unknown", current: 0, d30: 0, d60: 0, d90: 0, over: 0, onAccount: 0, total: 0, lines: [] };
    let line: AgedLine;
    if (item.kind === "on_account") {
      entry.onAccount += item.amount;
      line = { ...item, days: 0, band: "on_account" };
    } else {
      const days = daysLate(item.dueDate, asOf);
      const band = bandOf(days);
      entry[band] += item.amount;
      line = { ...item, days, band };
    }
    entry.total += item.amount;
    entry.lines.push(line);
    byParty.set(key, entry);
  }
  const parties = [...byParty.values()]
    .map((party) => ({
      ...party,
      current: cents(party.current),
      d30: cents(party.d30),
      d60: cents(party.d60),
      d90: cents(party.d90),
      over: cents(party.over),
      onAccount: cents(party.onAccount),
      total: cents(party.total),
      lines: [...party.lines].sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date) || a.number.localeCompare(b.number)),
    }))
    .sort((a, b) => b.total - a.total || a.party.localeCompare(b.party));
  const totals = parties.reduce(
    (sum, party) => ({
      current: sum.current + party.current,
      d30: sum.d30 + party.d30,
      d60: sum.d60 + party.d60,
      d90: sum.d90 + party.d90,
      over: sum.over + party.over,
      onAccount: sum.onAccount + party.onAccount,
      total: sum.total + party.total,
    }),
    { current: 0, d30: 0, d60: 0, d90: 0, over: 0, onAccount: 0, total: 0 },
  );
  return {
    asOf,
    parties,
    totals: {
      current: cents(totals.current),
      d30: cents(totals.d30),
      d60: cents(totals.d60),
      d90: cents(totals.d90),
      over: cents(totals.over),
      onAccount: cents(totals.onAccount),
      total: cents(totals.total),
    },
  };
}

/** The ageing date from the address: a real date, or today. */
export function agedDate(value: string | undefined, today = new Date().toISOString().slice(0, 10)) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : today;
}
