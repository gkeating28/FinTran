type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function asJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(asJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asJson(item)]));
  }
  throw new Error("Canonical JSON cannot encode this value.");
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(asJson(value));
}

function canonicalValue(value: Json): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot encode a non-finite number.");
    const text = Object.is(value, -0) ? "0" : String(value);
    return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalValue(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
}
