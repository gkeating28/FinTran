export type SemanticRecord = Record<string, unknown>;

export function semanticRecord(value: unknown): SemanticRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as SemanticRecord) : null;
}

export function semanticText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function semanticRows(value: unknown): SemanticRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const row = semanticRecord(item);
      return row ? [row] : [];
    });
  }
  const one = semanticRecord(value);
  return one ? [one] : [];
}

export function semanticAt(source: unknown, ...path: string[]) {
  let current = source;
  for (const key of path) {
    const record = semanticRecord(current);
    if (!record) return "";
    current = record[key];
  }
  return semanticText(current);
}

export function sellerIban(semantic: unknown) {
  return semanticAt(semantic, "BG-16", "BG-17", "BT-84");
}

export function sellerEndpoint(semantic: unknown) {
  const endpoint = semanticRecord(semanticRecord(semantic)?.["BG-4"])?.["BT-34"];
  const record = semanticRecord(endpoint);
  return { scheme: semanticText(record?.scheme), id: semanticText(record?.value) };
}
