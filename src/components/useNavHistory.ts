"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { arrivedOpen, backTarget, documentClosed, goneBack, parseStack } from "@/lib/nav-history";
import { readRaw, readStack, subscribe, writeStack } from "@/lib/nav-store";

const serverRecord = () => "[]";

/** Back for the screen on show: where the person came from, or the screen's usual parent when there is no record. */
export function useNavHistory() {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, () => readRaw() ?? "[]", serverRecord);
  const stack = useMemo(() => parseStack(raw), [raw]);

  const goBack = useCallback(
    (fallback: string | null) => {
      const current = readStack();
      const target = backTarget(current);
      if (target) {
        writeStack(goneBack(current));
        router.push(target);
        return;
      }
      if (fallback) router.push(fallback);
    },
    [router],
  );

  /** The document the address opened has been closed. */
  const closedDocument = useCallback(() => writeStack(documentClosed(readStack())), []);

  return { target: backTarget(stack), arrivedOpen: arrivedOpen(stack), goBack, closedDocument };
}
