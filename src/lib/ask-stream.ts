import type { AskBlock, AskDoc, AskEvent } from "@/lib/ask-qula";

/** The answer as it builds up while the stream arrives. */
export type LiveAnswer = {
  text: string;
  status: string;
  docs: AskDoc[];
  blocks: AskBlock[];
  followups: string[];
  error: string;
};

export const EMPTY_LIVE: LiveAnswer = { text: "", status: "", docs: [], blocks: [], followups: [], error: "" };

export function applyEvent(live: LiveAnswer, event: AskEvent): LiveAnswer {
  switch (event.type) {
    case "status":
      return { ...live, status: event.text };
    case "text":
      return { ...live, text: live.text + event.delta, status: "" };
    case "docs":
      return { ...live, docs: event.docs };
    case "block":
      return { ...live, blocks: [...live.blocks, event.block] };
    case "followups":
      return { ...live, followups: event.items };
    case "error":
      return { ...live, error: event.text, status: "" };
    default:
      return live;
  }
}

/** Reads a stream of one JSON event per line and calls onEvent for each, as soon as its line is complete. */
export async function readAskStream(response: Response, onEvent: (event: AskEvent) => void) {
  if (!response.body) throw new Error("Ask Qula sent no answer.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as AskEvent);
    } catch {
      // A broken line carries nothing we can show.
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      flush(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  flush(buffer);
}

/** A table as CSV text. A cell that a spreadsheet would run as a formula is kept as text. */
export function tableCsv(block: Extract<AskBlock, { type: "table" }>) {
  const cell = (value: string) => {
    const safe = /^[=+@]/.test(value) || /^-[^0-9.]/.test(value) ? `'${value}` : value;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [block.columns, ...block.rows].map((row) => row.map(cell).join(",")).join("\r\n");
}
