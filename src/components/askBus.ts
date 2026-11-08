type Listener = (question: string) => void;

const listeners = new Set<Listener>();
let waiting: string | null = null;

/** Opens Ask Qula and sends a question, from any screen. If the chat is not on the page yet it is sent when it is. */
export function requestAsk(question: string) {
  if (listeners.size === 0) {
    waiting = question;
    return;
  }
  for (const listener of listeners) listener(question);
}

export function onAskRequest(listener: Listener) {
  listeners.add(listener);
  if (waiting) {
    const question = waiting;
    waiting = null;
    queueMicrotask(() => listener(question));
  }
  return () => {
    listeners.delete(listener);
  };
}
