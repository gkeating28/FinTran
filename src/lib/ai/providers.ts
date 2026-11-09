import type { AiAdapter, AiMessage, AiTool, AiToolCall, AiTurn } from "./adapter";

type Settings = { provider: string; model: string; config: Record<string, string>; apiKey: string };
type Input = { system: string; messages: AiMessage[]; tools: AiTool[]; cachePrefix?: string };
type Json = Record<string, unknown>;

async function failure(response: Response) {
  const body = await response.json().catch(() => ({}));
  const message = typeof body === "object" && body && "error" in body ? JSON.stringify((body as { error: unknown }).error) : response.statusText;
  return new Error(message || "The AI provider could not answer.");
}

async function readJson(response: Response) {
  if (!response.ok) throw await failure(response);
  return (await response.json().catch(() => ({}))) as Json;
}

/** Reads a server sent event stream and calls onEvent with the parsed data of each event. */
export async function readEvents(response: Response, onEvent: (data: Json) => void) {
  if (!response.ok) throw await failure(response);
  if (!response.body) throw new Error("The AI provider sent no answer.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf("\n\n");
    while (split >= 0) {
      const block = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (data && data !== "[DONE]") {
        try {
          onEvent(JSON.parse(data) as Json);
        } catch {
          // A line that is not JSON carries nothing we need.
        }
      }
      split = buffer.indexOf("\n\n");
    }
  }
}

function parseInput(raw: string): Json {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Json) : {};
  } catch {
    return {};
  }
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
    async complete(input, onText) {
      if (settings.provider === "anthropic") return anthropic(settings, input, onText);
      return openAi(settings, input, onText);
    },
  };
}

function anthropicMessages(messages: AiMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "user",
        content: message.results.map((result) => ({ type: "tool_result", tool_use_id: result.id, content: result.output })),
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(message.text ? [{ type: "text", text: message.text }] : []),
          ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.input })),
        ],
      };
    }
    return { role: message.role, content: message.text };
  });
}

/**
 * The instructions and tools are the same for every question, so they are marked to be cached. The provider then
 * does not have to read about 2,500 tokens again on every turn. The parts that change, today's date and the page
 * the person is on, come after the marked block so they do not spoil it.
 */
export function anthropicSystem(system: string, cachePrefix?: string) {
  if (cachePrefix && system.startsWith(cachePrefix)) {
    const rest = system.slice(cachePrefix.length).trim();
    return [
      { type: "text", text: cachePrefix, cache_control: { type: "ephemeral" } },
      ...(rest ? [{ type: "text", text: rest }] : []),
    ];
  }
  return system;
}

async function anthropic(settings: Settings, { system, messages, tools, cachePrefix }: Input, onText?: (delta: string) => void): Promise<AiTurn> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1500,
      system: anthropicSystem(system, cachePrefix),
      stream: Boolean(onText),
      messages: anthropicMessages(messages),
      ...(tools.length
        ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }
        : {}),
    }),
  });

  if (!onText) {
    const body = await readJson(response);
    const content = Array.isArray(body.content) ? body.content : [];
    const usage = typeof body.usage === "object" && body.usage ? (body.usage as Json) : {};
    return {
      cachedTokens: Number(usage.cache_read_input_tokens ?? 0),
      text: content.filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "text").map((item) => String((item as { text?: string }).text ?? "")).join("\n"),
      toolCalls: content.flatMap((item) => {
        if (!item || typeof item !== "object" || (item as { type?: string }).type !== "tool_use") return [];
        const record = item as { id?: string; name?: string; input?: Json };
        return [{ id: String(record.id ?? record.name), name: String(record.name ?? ""), input: record.input ?? {} }];
      }),
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
    };
  }

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  await readEvents(response, (event) => {
    const type = String(event.type ?? "");
    const index = Number(event.index ?? 0);
    if (type === "message_start") {
      const message = (event.message ?? {}) as { usage?: { input_tokens?: number; cache_read_input_tokens?: number } };
      inputTokens = Number(message.usage?.input_tokens ?? 0);
      cachedTokens = Number(message.usage?.cache_read_input_tokens ?? 0);
    } else if (type === "content_block_start") {
      const block = (event.content_block ?? {}) as { type?: string; id?: string; name?: string };
      if (block.type === "tool_use") blocks.set(index, { id: String(block.id ?? block.name), name: String(block.name ?? ""), json: "" });
    } else if (type === "content_block_delta") {
      const delta = (event.delta ?? {}) as { type?: string; text?: string; partial_json?: string };
      if (delta.type === "text_delta" && delta.text) {
        text += delta.text;
        onText(delta.text);
      } else if (delta.type === "input_json_delta") {
        const block = blocks.get(index);
        if (block) block.json += delta.partial_json ?? "";
      }
    } else if (type === "message_delta") {
      const usage = (event.usage ?? {}) as { output_tokens?: number };
      outputTokens = Number(usage.output_tokens ?? outputTokens);
    } else if (type === "error") {
      throw new Error("The AI provider stopped the answer.");
    }
  });
  const toolCalls: AiToolCall[] = [...blocks.values()].map((block) => ({ id: block.id, name: block.name, input: parseInput(block.json) }));
  return { text, toolCalls, inputTokens, outputTokens, cachedTokens };
}

function openAiMessages(system: string, messages: AiMessage[]) {
  const out: Json[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "tool") {
      for (const result of message.results) out.push({ role: "tool", tool_call_id: result.id, content: result.output });
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: message.text || null,
        tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input) } })),
      });
    } else {
      out.push({ role: message.role, content: message.text });
    }
  }
  return out;
}

async function openAi(settings: Settings, { system, messages, tools }: Input, onText?: (delta: string) => void): Promise<AiTurn> {
  const azure = settings.provider === "azure_openai";
  const base = (settings.config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("The AI base URL must use https.");
  const url = azure
    ? `${base}/openai/deployments/${encodeURIComponent(settings.config.deployment || settings.model)}/chat/completions?api-version=${encodeURIComponent(settings.config.apiVersion || "2024-10-21")}`
    : `${base}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: azure ? "" : `Bearer ${settings.apiKey}`,
      "api-key": azure ? settings.apiKey : "",
    },
    body: JSON.stringify({
      model: azure ? undefined : settings.model,
      messages: openAiMessages(system, messages),
      ...(onText ? { stream: true, stream_options: { include_usage: true } } : {}),
      ...(tools.length
        ? { tools: tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) }
        : {}),
    }),
  });

  if (!onText) return openAiTurn(await readJson(response));

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const calls = new Map<number, { id: string; name: string; json: string }>();
  await readEvents(response, (event) => {
    const usage = (event.usage ?? null) as { prompt_tokens?: number; completion_tokens?: number } | null;
    if (usage) {
      inputTokens = Number(usage.prompt_tokens ?? inputTokens);
      outputTokens = Number(usage.completion_tokens ?? outputTokens);
    }
    const choice = Array.isArray(event.choices) ? (event.choices[0] as { delta?: Json } | undefined) : undefined;
    const delta = choice?.delta ?? {};
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    const pieces = Array.isArray(delta.tool_calls) ? (delta.tool_calls as Json[]) : [];
    for (const piece of pieces) {
      const index = Number(piece.index ?? 0);
      const fn = (piece.function ?? {}) as { name?: string; arguments?: string };
      const call = calls.get(index) ?? { id: "", name: "", json: "" };
      if (typeof piece.id === "string" && piece.id) call.id = piece.id;
      if (fn.name) call.name += fn.name;
      if (fn.arguments) call.json += fn.arguments;
      calls.set(index, call);
    }
  });
  const toolCalls: AiToolCall[] = [...calls.values()].map((call) => ({ id: call.id || call.name, name: call.name, input: parseInput(call.json) }));
  return { text, toolCalls, inputTokens, outputTokens };
}

function openAiTurn(body: Json): AiTurn {
  const choice = Array.isArray(body.choices) ? (body.choices[0] as Json | undefined) : undefined;
  const message = choice && typeof choice.message === "object" && choice.message ? (choice.message as Json) : {};
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const usage = typeof body.usage === "object" && body.usage ? (body.usage as Json) : {};
  return {
    text: typeof message.content === "string" ? message.content : "",
    toolCalls: calls.flatMap((call) => {
      if (!call || typeof call !== "object") return [];
      const record = call as Json;
      const fn = typeof record.function === "object" && record.function ? (record.function as Json) : {};
      return [{ id: String(record.id ?? fn.name ?? "tool"), name: String(fn.name ?? ""), input: parseInput(String(fn.arguments ?? "{}")) }];
    }),
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
  };
}
