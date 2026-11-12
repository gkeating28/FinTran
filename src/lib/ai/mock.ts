import type { AiAdapter, AiMessage, AiToolCall, AiTurn } from "./adapter";

/**
 * The mock provider, for tests and for trying Ask Qula without a key. It never calls a service. It follows a fixed
 * script driven by the question, so a test can make it look something up and propose an action, the way a real model
 * would, and everything after that (the lookup, the cards, the proposal and its token) is the real code.
 *
 * - A question that mentions drafts looks up drafts, for the supplier or customer named after "for" if there is one.
 * - A question that asks to post also proposes posting the first draft found.
 * - Anything else gets a one-line answer.
 */
export function mockProvider(): AiAdapter {
  return {
    async complete({ messages }) {
      const question = lastQuestion(messages);
      const last = messages[messages.length - 1];
      const posting = /\bpost\b/i.test(question);

      if (last?.role === "tool") {
        const [result] = last.results;
        if (result?.name === "search_transactions" && posting) {
          const id = firstDocumentId(result.output);
          return id ? turn("", [{ id: "mock-propose", name: "propose_action", input: { action: "post_draft", id } }]) : turn("There is no draft to post.");
        }
        if (result?.name === "propose_action") return turn("That is waiting for your confirmation.");
        return turn("Here is what I found.");
      }

      if (posting || /\bdrafts?\b/i.test(question)) {
        const party = /\bfor\s+([\p{L}][\p{L}\p{N} &'.-]*?)\s*[?.!]*$/iu.exec(question)?.[1];
        return turn("", [{ id: "mock-search", name: "search_transactions", input: { status: "draft", ...(party ? { party } : {}) } }]);
      }
      return turn("Mock answer.");
    },
  };
}

function turn(text: string, toolCalls: AiToolCall[] = []): AiTurn {
  return { text, toolCalls, inputTokens: 1, outputTokens: 1 };
}

function lastQuestion(messages: AiMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return message.text;
  }
  return "";
}

function firstDocumentId(output: string) {
  try {
    const parsed = JSON.parse(output) as { documents?: { id?: unknown }[] };
    const id = parsed.documents?.[0]?.id;
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}
