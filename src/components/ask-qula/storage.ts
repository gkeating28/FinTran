import type { AskBlock, AskDoc, AskProposal } from "@/lib/ask-qula";

export type AskMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  docs?: AskDoc[];
  blocks?: AskBlock[];
  followups?: string[];
  /** True when a model wrote the answer. Only those can be rated. */
  ai?: boolean;
  /** The question the answer replies to, kept so a rating can say what it was about. */
  question?: string;
  rated?: 1 | -1;
  /** Something Ask Qula proposed, and what became of it. */
  proposal?: AskProposal;
  proposalState?: "done" | "failed" | "cancelled";
  proposalResult?: string;
};

export type StoredChat = {
  messages: AskMessage[];
  open: boolean;
};

export const EMPTY: StoredChat = { messages: [], open: false };
export const listeners = new Set<() => void>();
export const snapshots = new Map<string, { raw: string; value: StoredChat }>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function serverSnapshot() {
  return EMPTY;
}

export function clientSnapshot(organisationId: string) {
  let raw = "";
  try {
    raw = sessionStorage.getItem(storageKey(organisationId)) ?? "";
  } catch {
    return snapshots.get(organisationId)?.value ?? EMPTY;
  }
  const cached = snapshots.get(organisationId);
  if (cached?.raw === raw) return cached.value;
  const value = parseStored(raw);
  snapshots.set(organisationId, { raw, value });
  return value;
}

export function writeStored(organisationId: string, chat: StoredChat) {
  const messages = chat.messages.slice(-40);
  const value = messages.length === 0 && !chat.open ? EMPTY : { messages, open: chat.open };
  const raw = JSON.stringify({ messages: value.messages, open: value.open });
  try {
    sessionStorage.setItem(storageKey(organisationId), raw);
  } catch {
    snapshots.set(organisationId, { raw, value });
    for (const listener of listeners) listener();
    return;
  }
  snapshots.set(organisationId, { raw, value });
  for (const listener of listeners) listener();
}

export function storageKey(organisationId: string) {
  return `fintran.ask-qula.${organisationId}`;
}

export function parseStored(raw: string): StoredChat {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const record = parsed as { messages?: unknown; open?: unknown };
    const messages = Array.isArray(record.messages) ? record.messages.filter(isMessage).slice(-40) : [];
    if (messages.length === 0 && record.open !== true) return EMPTY;
    return { messages, open: record.open === true };
  } catch {
    return EMPTY;
  }
}

export function isMessage(value: unknown): value is AskMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as AskMessage;
  if ((message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string" || typeof message.id !== "string") {
    return false;
  }
  if (message.docs != null && (!Array.isArray(message.docs) || !message.docs.every(isDoc))) return false;
  if (message.blocks != null && (!Array.isArray(message.blocks) || !message.blocks.every(isBlock))) return false;
  if (message.ai != null && typeof message.ai !== "boolean") return false;
  if (message.rated != null && message.rated !== 1 && message.rated !== -1) return false;
  if (message.followups != null && (!Array.isArray(message.followups) || !message.followups.every((item) => typeof item === "string"))) return false;
  return true;
}

export function isBlock(value: unknown): value is AskBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as AskBlock;
  if (block.type === "table") return Array.isArray(block.columns) && Array.isArray(block.rows) && block.rows.every(Array.isArray);
  if (block.type === "message") return typeof block.to === "string" && typeof block.subject === "string" && typeof block.body === "string";
  if (block.type === "chart") return Array.isArray(block.labels) && Array.isArray(block.values) && block.values.every((item) => typeof item === "number");
  return false;
}

export function isDoc(value: unknown): value is AskDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as AskDoc;
  return (
    typeof doc.ref === "string" &&
    typeof doc.title === "string" &&
    typeof doc.store === "string" &&
    typeof doc.status === "string" &&
    typeof doc.statusColor === "string"
  );
}

export function newId() {
  return crypto.randomUUID();
}
