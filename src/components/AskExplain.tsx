"use client";

import { createContext, useContext, type ReactNode } from "react";
import { requestAsk } from "@/components/askBus";
import styles from "@/components/OpsPage.module.css";

const Availability = createContext(false);

/** Says whether the organisation has Ask Qula's AI switched on, so a button that needs it can hide itself. */
export function AskProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <Availability.Provider value={enabled}>{children}</Availability.Provider>;
}

/** A button that opens Ask Qula and asks a question about what is on the screen. It shows only when AI is on. */
export function AskExplainButton({ question, label = "Ask Qula to explain" }: { question: string; label?: string }) {
  const enabled = useContext(Availability);
  if (!enabled) return null;
  return (
    <button className={styles.quiet} type="button" onClick={() => requestAsk(question)}>
      {label}
    </button>
  );
}
