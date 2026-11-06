import { answerQuestion } from "@/lib/ask-qula-data";
import type { AskAnswer } from "@/lib/ask-qula";
import { getSecret } from "@/lib/secrets";
import { createClient } from "@/lib/supabase/server";
import { runAiAnswer } from "./run";
import type { AiMessage } from "./adapter";

type SettingsRow = {
  enabled: boolean;
  provider_code: string | null;
  model: string | null;
  config: Record<string, string> | null;
  user_hourly_limit: number;
  organisation_monthly_limit: number | null;
};

export async function answerWithAi(organisationId: string, question: string, history: AiMessage[]): Promise<AskAnswer | null> {
  const supabase = await createClient();
  const settings = await supabase.from("ai_settings").select("enabled, provider_code, model, config, user_hourly_limit, organisation_monthly_limit").eq("organisation_id", organisationId).maybeSingle();
  const row = settings.data as SettingsRow | null;
  if (!row?.enabled || !row.provider_code || !row.model) return null;

  const allowance = await supabase.rpc("ai_usage_allowance", { p_organisation_id: organisationId });
  const counts = (Array.isArray(allowance.data) ? allowance.data[0] : allowance.data) as { user_hour?: number; organisation_month?: number } | null;
  const limited = Number(counts?.user_hour ?? 0) >= row.user_hourly_limit || (row.organisation_monthly_limit != null && Number(counts?.organisation_month ?? 0) >= row.organisation_monthly_limit);
  if (limited) {
    await supabase.rpc("record_ai_usage", { p_organisation_id: organisationId, p_provider_code: row.provider_code, p_model: row.model, p_input_tokens: 0, p_output_tokens: 0, p_tool_calls: 0, p_outcome: "limited" });
    return answerQuestion(organisationId, question);
  }

  const apiKey = await getSecret(organisationId, "ai_api_key");
  if (!apiKey) return null;

  try {
    const answer = await Promise.race([
      runAiAnswer({
        supabase,
        organisationId,
        question,
        history,
        provider: row.provider_code,
        model: row.model,
        config: row.config ?? {},
        apiKey,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
    ]);
    await supabase.rpc("record_ai_usage", {
      p_organisation_id: organisationId,
      p_provider_code: row.provider_code,
      p_model: row.model,
      p_input_tokens: answer.inputTokens,
      p_output_tokens: answer.outputTokens,
      p_tool_calls: answer.toolCalls,
      p_outcome: "ok",
    });
    return { intent: "ai" as AskAnswer["intent"], text: answer.text, docs: answer.cards };
  } catch {
    await supabase.rpc("record_ai_usage", {
      p_organisation_id: organisationId,
      p_provider_code: row.provider_code,
      p_model: row.model,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_tool_calls: 0,
      p_outcome: "fallback",
    });
    const keyword = await answerQuestion(organisationId, question);
    return { ...keyword, text: `${keyword.text} The AI assistant is unavailable.` };
  }
}
