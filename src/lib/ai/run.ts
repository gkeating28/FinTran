import type { SupabaseClient } from "@supabase/supabase-js";
import { ASK_SYSTEM_PROMPT, ASK_TOOLS } from "./prompt";
import { adapterFor } from "./providers";
import { runAskTool } from "./tools";
import type { AiAdapter, AiMessage } from "./adapter";

export async function runAiAnswer(options: {
  supabase: SupabaseClient;
  organisationId: string;
  question: string;
  history: AiMessage[];
  provider: string;
  model: string;
  config: Record<string, string>;
  apiKey: string;
  adapter?: AiAdapter;
}) {
  const adapter = options.adapter ?? adapterFor({
    provider: options.provider,
    model: options.model,
    config: options.config,
    apiKey: options.apiKey,
  });
  const messages: AiMessage[] = [...options.history.slice(-6), { role: "user", text: options.question }];
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const cards: { ref: string; title: string; store: string; status: string; statusColor: string; recordId?: string }[] = [];
  for (let step = 0; step < 8; step += 1) {
    const turn = await adapter.complete({ system: ASK_SYSTEM_PROMPT, messages, tools: [...ASK_TOOLS] });
    inputTokens += turn.inputTokens;
    outputTokens += turn.outputTokens;
    if (turn.toolCalls.length === 0) {
      return { text: turn.text || "I do not have that data.", cards, toolCalls, inputTokens, outputTokens };
    }
    for (const call of turn.toolCalls) {
      if (toolCalls >= 8) break;
      toolCalls += 1;
      const result = await runAskTool(options.supabase, options.organisationId, call.name, call.input);
      const documents = result && typeof result === "object" && "documents" in result && Array.isArray(result.documents) ? result.documents : [];
      for (const document of documents) {
        if (!document || typeof document !== "object") continue;
        const record = document as { id?: string; document_number?: string; status?: string };
        if (!record.id) continue;
        const { data } = await options.supabase.from("transaction_headers").select("id").eq("organisation_id", options.organisationId).eq("id", record.id).maybeSingle();
        if (!data && call.name.includes("e_document")) {
          const eDoc = await options.supabase.from("e_documents").select("id").eq("organisation_id", options.organisationId).eq("id", record.id).maybeSingle();
          if (!eDoc.data) continue;
        } else if (!data && !call.name.includes("e_document")) {
          continue;
        }
        cards.push({
          ref: record.document_number || record.id,
          title: record.document_number || "Document",
          store: call.name.includes("e_document") ? "e_documents" : "transaction_headers",
          status: record.status || "",
          statusColor: "#2c4c78",
          recordId: record.id,
        });
      }
      messages.push({ role: "assistant", text: `${call.name} ${JSON.stringify(result).slice(0, 4000)}` });
    }
  }
  return { text: "I do not have that data.", cards, toolCalls, inputTokens, outputTokens };
}
