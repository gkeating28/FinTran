"use client";

import type { ReactNode } from "react";
import { useNavHistory } from "@/components/useNavHistory";

/**
 * A Back link for a screen outside the title bar. It returns to where the person came from, and goes to `fallback` when it
 * has no record, as when the page was opened directly. The address is also the link's href, so it still works without script.
 */
export default function BackLink({ fallback, className, children }: { fallback: string; className?: string; children: ReactNode }) {
  const { target, goBack } = useNavHistory();
  return (
    <a
      className={className}
      href={target ?? fallback}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        goBack(fallback);
      }}
    >
      {children}
    </a>
  );
}
