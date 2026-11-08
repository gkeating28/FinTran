import type { AskContext } from "./prompt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reads the page the person is on. Only a known shape gets through, because it goes into the prompt. */
export function parseContext(value: unknown): AskContext | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { kind?: unknown; id?: unknown; code?: unknown; section?: unknown };
  const id = typeof record.id === "string" && UUID.test(record.id) ? record.id : undefined;
  const code = typeof record.code === "string" && /^[A-Za-z0-9_-]{1,20}$/.test(record.code) ? record.code : undefined;
  const section = typeof record.section === "string" && /^[a-z-]{1,30}$/.test(record.section) ? record.section : undefined;
  if (record.kind === "transaction" && id) return { kind: "transaction", id, code };
  if (record.kind === "e-document" && id) return { kind: "e-document", id };
  if (section) return { kind: "page", section };
  return null;
}
