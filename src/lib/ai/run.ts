import type { SupabaseClient } from "@supabase/supabase-js";
import type { AskBlock, AskDoc, AskEvent, AskProposal } from "@/lib/ask-qula";
import { proposeAction } from "./actions";
import { ACTION_TOOLS, ASK_TOOLS, PRESENTATION_TOOLS, systemPromptFor, type AskContext } from "./prompt";
import { adapterFor } from "./providers";
import { runAskTool } from "./tools";
import type { AiAdapter, AiMessage, AiToolResult } from "./adapter";

const MAX_STEPS = 8;
const MAX_TOOL_CALLS = 8;
const MAX_CARDS = 8;

const STATUS_COLOURS: Record<string, string> = {
  draft: "#5b6678",
  posted: "#166a49",
  valid: "#166a49",
  imported: "#166a49",
  generated: "#2452b8",
  received: "#2452b8",
  void: "#b42318",
  invalid: "#b42318",
  rejected: "#b42318",
  duplicate: "#b4400b",
};

const STATUS_LABELS: Record<string, string> = {
  search_transactions: "Looking through transactions",
  get_transaction: "Reading the transaction",
  aging_summary: "Working out what is due",
  totals_by_period: "Adding up the totals",
  top_parties: "Ranking suppliers and customers",
  vat_summary: "Adding up the VAT",
  insights: "Looking for anything worth a look",
  search_parties: "Looking up suppliers and customers",
  search_products: "Looking up products",
  change_history: "Reading the change history",
  search_e_documents: "Looking through e-documents",
  get_e_document: "Reading the e-document",
  readiness_issues: "Checking the drafts",
  explain_rule: "Looking up the rule",
  draft_reminder: "Writing the reminder",
  help_search: "Searching the help",
};

export type AiRun = {
  text: string;
  cards: AskDoc[];
  blocks: AskBlock[];
  followups: string[];
  proposal: AskProposal | null;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** How long each model turn and each lookup took, in milliseconds, for the server log. */
  timings: { turns: number[]; tools: { name: string; ms: number }[] };
};

function clip(value: unknown, length: number) {
  return String(value ?? "").slice(0, length);
}

/** Turns what the model sent to show_table into a table that is safe to draw, or null. */
export function tableBlock(input: Record<string, unknown>): AskBlock | null {
  const columns = Array.isArray(input.columns) ? input.columns.slice(0, 8).map((column) => clip(column, 40)) : [];
  if (columns.length === 0 || !Array.isArray(input.rows)) return null;
  const rows = input.rows.slice(0, 50).flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const cells = columns.map((_, index) => clip(row[index], 120));
    return [cells];
  });
  if (rows.length === 0) return null;
  return { type: "table", title: input.title ? clip(input.title, 80) : undefined, columns, rows };
}

/** Turns what the model sent to show_chart into a bar chart that is safe to draw, or null. */
export function chartBlock(input: Record<string, unknown>): AskBlock | null {
  if (!Array.isArray(input.labels) || !Array.isArray(input.values)) return null;
  const size = Math.min(24, input.labels.length, input.values.length);
  const labels: string[] = [];
  const values: number[] = [];
  for (let index = 0; index < size; index += 1) {
    const value = Number(input.values[index]);
    if (!Number.isFinite(value)) continue;
    labels.push(clip(input.labels[index], 24));
    values.push(value);
  }
  if (values.length === 0) return null;
  return { type: "chart", title: input.title ? clip(input.title, 80) : undefined, unit: input.unit ? clip(input.unit, 12) : undefined, labels, values };
}

function cardsFrom(tool: string, result: unknown): AskDoc[] {
  if (!result || typeof result !== "object") return [];
  const record = result as { documents?: unknown; document?: unknown };
  const items = Array.isArray(record.documents) ? record.documents : record.document ? [record.document] : [];
  const eDocument = tool.includes("e_document");
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const document = item as { id?: string; document_number?: string; status?: string; party_name?: string; seller_name?: string; buyer_name?: string };
    if (!document.id) return [];
    const status = document.status ?? "";
    const card: AskDoc = {
      ref: document.document_number || document.id,
      title: (eDocument ? document.seller_name || document.buyer_name : document.party_name) || document.document_number || "Document",
      store: eDocument ? "e_documents" : "transaction_headers",
      status,
      statusColor: STATUS_COLOURS[status] ?? "#2452b8",
      recordId: document.id,
    };
    return [card];
  });
}

/**
 * Runs the question through the model and the tools. emit is called as things happen: a status line
 * for each lookup, each piece of text as it streams, then the cards, tables, charts and follow ups.
 */
export async function runAiStream(
  options: {
    supabase: SupabaseClient;
    organisationId: string;
    /** The signed in person. Without it no action can be proposed. */
    userId?: string;
    question: string;
    history: AiMessage[];
    context?: AskContext | null;
    provider: string;
    model: string;
    config: Record<string, string>;
    apiKey: string;
    adapter?: AiAdapter;
  },
  emit: (event: AskEvent) => void = () => {},
): Promise<AiRun> {
  const adapter = options.adapter ?? adapterFor({
    provider: options.provider,
    model: options.model,
    config: options.config,
    apiKey: options.apiKey,
  });
  const system = systemPromptFor(options.context);
  const allowed = new Set<string>(ASK_TOOLS.map((tool) => tool.name));
  const messages: AiMessage[] = [...options.history.slice(-6), { role: "user", text: options.question }];
  const run: AiRun = { text: "", cards: [], blocks: [], followups: [], proposal: null, toolCalls: 0, inputTokens: 0, outputTokens: 0, timings: { turns: [], tools: [] } };
  const seen = new Set<string>();

  const say = (delta: string) => {
    if (!delta) return;
    run.text += delta;
    emit({ type: "text", delta });
  };

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let streamed = 0;
    const turnStarted = Date.now();
    const turn = await adapter.complete({ system, messages, tools: [...ASK_TOOLS] }, (delta) => {
      streamed += delta.length;
      say(delta);
    });
    run.timings.turns.push(Date.now() - turnStarted);
    run.inputTokens += turn.inputTokens;
    run.outputTokens += turn.outputTokens;
    if (streamed === 0 && turn.text) say(turn.text);

    const calls = turn.toolCalls;
    if (calls.length === 0) break;

    // Lookups in one turn do not depend on each other, so they run together.
    const lookups = calls.map((call) => {
      if (!allowed.has(call.name) || PRESENTATION_TOOLS.has(call.name) || ACTION_TOOLS.has(call.name) || run.toolCalls >= MAX_TOOL_CALLS) return null;
      run.toolCalls += 1;
      emit({ type: "status", text: STATUS_LABELS[call.name] ?? "Looking that up" });
      const started = Date.now();
      return runAskTool(options.supabase, options.organisationId, call.name, call.input).then((output) => {
        run.timings.tools.push({ name: call.name, ms: Date.now() - started });
        return output;
      });
    });

    const results: AiToolResult[] = [];
    for (const [index, call] of calls.entries()) {
      let output: unknown;
      const lookup = lookups[index];
      if (lookup) {
        output = await lookup;
        const fresh = cardsFrom(call.name, output).filter((card) => {
          const key = `${card.store}:${card.recordId}`;
          if (seen.has(key) || run.cards.length >= MAX_CARDS) return false;
          seen.add(key);
          return true;
        });
        if (fresh.length > 0) run.cards.push(...fresh);
        const reminder = call.name === "draft_reminder" && output && typeof output === "object" ? (output as { reminder?: { to?: string; subject?: string; body?: string } }).reminder : undefined;
        if (reminder?.subject && reminder.body) {
          const block: AskBlock = { type: "message", title: "Payment reminder", to: String(reminder.to ?? ""), subject: reminder.subject, body: reminder.body };
          run.blocks.push(block);
          emit({ type: "block", block });
        }
      } else if (call.name === "propose_action" && allowed.has(call.name)) {
        const proposed = options.userId ? await proposeAction(options.supabase, options.organisationId, options.userId, call.input) : { error: "Actions are not available." };
        if ("proposal" in proposed) {
          run.proposal = proposed.proposal;
          emit({ type: "proposal", proposal: proposed.proposal });
          output = { proposed: true, note: "Waiting for the person to confirm. It has not been done." };
        } else {
          output = { error: proposed.error };
        }
      } else if (!allowed.has(call.name) || !PRESENTATION_TOOLS.has(call.name)) {
        output = { error: "That tool is not available." };
      } else if (call.name === "suggest_followups") {
        const items = Array.isArray(call.input.questions) ? call.input.questions.slice(0, 3).map((question) => clip(question, 90)).filter(Boolean) : [];
        if (items.length > 0) {
          run.followups = items;
          emit({ type: "followups", items });
        }
        output = { shown: true };
      } else {
        const block = call.name === "show_table" ? tableBlock(call.input) : chartBlock(call.input);
        if (block) {
          run.blocks.push(block);
          emit({ type: "block", block });
        }
        output = { shown: true };
      }
      results.push({ id: call.id, name: call.name, output: JSON.stringify(output).slice(0, 16_000) });
    }
    // A turn that only presented what it had already said needs no further model call.
    if (run.text.trim() && calls.every((call) => PRESENTATION_TOOLS.has(call.name))) break;
    messages.push({ role: "assistant", text: turn.text, toolCalls: calls });
    messages.push({ role: "tool", results });
  }

  if (!run.text.trim()) say("I do not have that data.");
  if (run.cards.length > 0) emit({ type: "docs", docs: run.cards });
  return run;
}

/** The same as runAiStream without a stream, for callers that only want the finished answer. */
export function runAiAnswer(options: Parameters<typeof runAiStream>[0]) {
  return runAiStream(options);
}
