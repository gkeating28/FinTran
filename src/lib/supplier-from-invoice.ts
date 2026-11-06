export function suggestSupplierCode(name: string, taken: string[]) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "SUPPLIER";
  const used = new Set(taken.map((code) => code.toUpperCase()));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const tail = String(suffix);
    const code = `${base.slice(0, Math.max(1, 10 - tail.length))}${tail}`;
    if (!used.has(code)) return code;
  }
  return base;
}

export function paymentTermsDays(issueDate: string, dueDate: string) {
  const issue = Date.parse(issueDate);
  const due = Date.parse(dueDate);
  if (Number.isNaN(issue) || Number.isNaN(due)) return "";
  const days = Math.round((due - issue) / 86_400_000);
  if (days < 0 || days > 999) return "";
  return String(days);
}

export function ibanChanged(previous: string | null, current: string) {
  if (!previous || !current) return false;
  return previous.replace(/\s/g, "") !== current.replace(/\s/g, "");
}
