import { answerQuestion } from "@/lib/ask-qula-data";
import type { AskAnswer, AskBlock, AskDoc, AskEvent } from "@/lib/ask-qula";
import { getSecret } from "@/lib/secrets";
import { createClient } from "@/lib/supabase/server";
import { runAiStream } from "./run";
import type { AiMessage } from "./adapter";
import type { AskContext } from "./prompt";

type SettingsRow = {
  enabled: boolean;
  provider_code: string | null;
  model: string | null;
  config: Record<string, string> | null;
  user_hourly_limit: number;
  organisation_monthly_limit: number | null;
};

const TIMEOUT_MS = 50_000;

/** Sends a keyword answer as events, so the chat handles it the same way as a streamed one. */
function replay(answer: AskAnswer, emit: (event: AskEvent) => void) {
  emit({ type: "text", delta: answer.text });
  if (answer.docs?.length) emit({ type: "docs", docs: answer.docs });
  emit({ type: "done", intent: answer.intent });
}

/**
 * Answers a question for the chat. It uses the AI assistant when the organisation has switched it on and is within its
 * limits, and the fixed keyword answers otherwise. Everything it says goes through emit as it happens, and the finished
 * answer is returned for callers that do not stream.
 */
export async function answerAsk(
  organisationId: string,
  question: string,
  history: AiMessage[],
  context: AskContext | null,
  emit: (event: AskEvent) => void = () => {},
): Promise<AskAnswer> {
  const collected: AskAnswer = { intent: "ai", text: "", docs: [], blocks: [], followups: [] };
  const record = (event: AskEvent) => {
    if (event.type === "text") collected.text += event.delta;
    else if (event.type === "docs") collected.docs = event.docs;
    else if (event.type === "block") collected.blocks = [...(collected.blocks ?? []), event.block as AskBlock];
    else if (event.type === "followups") collected.followups = event.items;
    emit(event);
  };
  const keyword = async (note?: string) => {
    const answer = await answerQuestion(organisationId, question);
    const text = note ? `${answer.text} ${note}` : answer.text;
    replay({ ...answer, text }, record);
    return { ...answer, text } as AskAnswer;
  };

  const supabase = await createClient();
  const settings = await supabase.from("ai_settings").select("enabled, provider_code, model, config, user_hourly_limit, organisation_monthly_limit").eq("organisation_id", organisationId).maybeSingle();
  const row = settings.data as SettingsRow | null;
  if (!row?.enabled || !row.provider_code || !row.model) return keyword();

  const usage = (outcome: string, tokens = { input: 0, output: 0, tools: 0 }) =>
    supabase.rpc("record_ai_usage", {
      p_organisation_id: organisationId,
      p_provider_code: row.provider_code,
      p_model: row.model,
      p_input_tokens: tokens.input,
      p_output_tokens: tokens.output,
      p_tool_calls: tokens.tools,
      p_outcome: outcome,
    });

  // The allowance and the key do not depend on each other.
  const [allowance, apiKey] = await Promise.all([
    supabase.rpc("ai_usage_allowance", { p_organisation_id: organisationId }),
    getSecret(organisationId, "ai_api_key"),
  ]);
  const counts = (Array.isArray(allowance.data) ? allowance.data[0] : allowance.data) as { user_hour?: number; organisation_month?: number } | null;
  const limited = Number(counts?.user_hour ?? 0) >= row.user_hourly_limit || (row.organisation_monthly_limit != null && Number(counts?.organisation_month ?? 0) >= row.organisation_monthly_limit);
  if (limited) {
    await usage("limited");
    return keyword();
  }

  if (!apiKey) return keyword();

  let sent = false;
  const started = Date.now();
  try {
    const run = await Promise.race([
      runAiStream(
        { supabase, organisationId, question, history, context, provider: row.provider_code, model: row.model, config: row.config ?? {}, apiKey },
        (event) => {
          if (event.type === "text") sent = true;
          record(event);
        },
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    // The chat has everything now, so tell it before the usage is written.
    record({ type: "done", intent: "ai" });
    console.info(JSON.stringify({ askQula: { totalMs: Date.now() - started, turnsMs: run.timings.turns, tools: run.timings.tools, inputTokens: run.inputTokens, outputTokens: run.outputTokens } }));
    await usage("ok", { input: run.inputTokens, output: run.outputTokens, tools: run.toolCalls });
    return collected;
  } catch {
    await usage("fallback");
    if (sent) {
      // Part of the answer is already on screen, so say it stopped rather than replace it.
      record({ type: "error", text: "The AI assistant stopped before it finished." });
      return collected;
    }
    return keyword("The AI assistant is unavailable.");
  }
}

export type { AskDoc };
