import type { AiAdapter, AiMessage, AiTool, AiTurn } from "./adapter";

type Settings = { provider: string; model: string; config: Record<string, string>; apiKey: string };

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body ? JSON.stringify((body as { error: unknown }).error) : response.statusText;
    throw new Error(message || "The AI provider could not answer.");
  }
  return body as Record<string, unknown>;
}

function openAiTurn(body: Record<string, unknown>): AiTurn {
  const choice = Array.isArray(body.choices) ? (body.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = choice && typeof choice.message === "object" && choice.message ? (choice.message as Record<string, unknown>) : {};
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const usage = typeof body.usage === "object" && body.usage ? (body.usage as Record<string, unknown>) : {};
  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls: calls.flatMap((call) => {
      if (!call || typeof call !== "object") return [];
      const record = call as Record<string, unknown>;
      const fn = typeof record.function === "object" && record.function ? (record.function as Record<string, unknown>) : {};
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(String(fn.arguments ?? "{}")) as Record<string, unknown>;
      } catch {
        input = {};
      }
      return [{ id: String(record.id ?? fn.name ?? "tool"), name: String(fn.name ?? ""), input }];
    }),
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
  };
}

export function adapterFor(settings: Settings): AiAdapter {
  if (settings.provider === "mock") {
    return {
      async complete() {
        return { text: "Mock answer.", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    };
  }
  return {
    async complete({ system, messages, tools }) {
      if (settings.provider === "anthropic") return anthropic(settings, system, messages, tools);
      return openAi(settings, system, messages, tools);
    },
  };
}

async function anthropic(settings: Settings, system: string, messages: AiMessage[], tools: AiTool[]): Promise<AiTurn> {
  const body = await readJson(await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
      body: JSON.stringify({
      model: settings.model,
      max_tokens: 800,
      system,
      messages: messages.map((message) => ({ role: message.role, content: message.text })),
      ...(tools.length
        ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }
        : {}),
    }),
  }));
  const content = Array.isArray(body.content) ? body.content : [];
  const usage = typeof body.usage === "object" && body.usage ? (body.usage as Record<string, unknown>) : {};
  return {
    text: content.filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "text").map((item) => String((item as { text?: string }).text ?? "")).join("\n"),
    toolCalls: content.flatMap((item) => {
      if (!item || typeof item !== "object" || (item as { type?: string }).type !== "tool_use") return [];
      const record = item as { id?: string; name?: string; input?: Record<string, unknown> };
      return [{ id: String(record.id ?? record.name), name: String(record.name ?? ""), input: record.input ?? {} }];
    }),
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
  };
}

async function openAi(settings: Settings, system: string, messages: AiMessage[], tools: AiTool[]): Promise<AiTurn> {
  const azure = settings.provider === "azure_openai";
  const base = (settings.config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("The AI base URL must use https.");
  const url = azure
    ? `${base}/openai/deployments/${encodeURIComponent(settings.config.deployment || settings.model)}/chat/completions?api-version=${encodeURIComponent(settings.config.apiVersion || "2024-10-21")}`
    : `${base}/chat/completions`;
  const body = await readJson(await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: azure ? "" : `Bearer ${settings.apiKey}`,
      "api-key": azure ? settings.apiKey : "",
    },
    body: JSON.stringify({
      model: azure ? undefined : settings.model,
      messages: [{ role: "system", content: system }, ...messages.map((message) => ({ role: message.role, content: message.text }))],
      ...(tools.length
        ? { tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) }
        : {}),
    }),
  }));
  return openAiTurn(body);
}
