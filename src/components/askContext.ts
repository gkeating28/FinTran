import { useEffect } from "react";
import type { AskContext } from "@/lib/ai/prompt";

let current: AskContext | null = null;

/** The record the person has open, if a screen has said so. Ask Qula reads it when a question is sent. */
export function getAskContext() {
  return current;
}

/** Tells Ask Qula which record is open while this screen shows it. Pass no id when nothing is open. */
export function useAskContext(kind: "transaction" | "e-document", id: string | undefined, code?: string) {
  useEffect(() => {
    if (!id) return;
    const value: AskContext = { kind, id, code };
    current = value;
    return () => {
      if (current === value) current = null;
    };
  }, [kind, id, code]);
}
