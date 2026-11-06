export type AiMessage = { role: "user" | "assistant"; text: string };

export type AiTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiToolCall = { id: string; name: string; input: Record<string, unknown> };

export type AiTurn = {
  text: string;
  toolCalls: AiToolCall[];
  inputTokens: number;
  outputTokens: number;
};

export type AiAdapter = {
  complete(input: { system: string; messages: AiMessage[]; tools: AiTool[] }): Promise<AiTurn>;
};

export function mockAdapter(script: AiTurn[]): AiAdapter {
  let index = 0;
  return {
    async complete() {
      const turn = script[Math.min(index, script.length - 1)] ?? { text: "I do not have that data.", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      index += 1;
      return turn;
    },
  };
}
