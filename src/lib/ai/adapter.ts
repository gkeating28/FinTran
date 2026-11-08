export type AiToolCall = { id: string; name: string; input: Record<string, unknown> };

export type AiToolResult = { id: string; name: string; output: string };

/**
 * One message in a conversation. A tool call is part of the assistant message that made it, and its
 * results come back as a tool message, which is the shape both providers expect.
 */
export type AiMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: AiToolCall[] }
  | { role: "tool"; results: AiToolResult[] };

export type AiTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiTurn = {
  text: string;
  toolCalls: AiToolCall[];
  inputTokens: number;
  outputTokens: number;
};

export type AiAdapter = {
  /**
   * Runs one model turn. When onText is given the adapter streams and calls it with each piece of text as
   * it arrives. It always returns the whole turn.
   */
  complete(
    input: { system: string; messages: AiMessage[]; tools: AiTool[] },
    onText?: (delta: string) => void,
  ): Promise<AiTurn>;
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
