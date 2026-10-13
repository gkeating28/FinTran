export function plainDecimal(value: string | number | null | undefined) {
  return String(value ?? "").replace(/,/g, "").trim();
}

export function groupThousands(value: string | number | null | undefined) {
  if (value == null || value === "") return "";
  const text = plainDecimal(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return String(value);
  const negative = text.startsWith("-");
  const [whole, fraction] = (negative ? text.slice(1) : text).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction != null ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${body}` : body;
}

export function formatInteger(value: string | number | null | undefined) {
  const text = plainDecimal(value);
  if (!/^-?\d+$/.test(text)) return value == null || value === "" ? "" : String(value);
  return groupThousands(text);
}

export function numberValue(value: string | number | null | undefined) {
  const parsed = Number(plainDecimal(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
