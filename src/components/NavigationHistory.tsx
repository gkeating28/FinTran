"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { visit } from "@/lib/nav-history";
import { readStack, writeStack } from "@/lib/nav-store";

/**
 * Records each screen the person visits in this tab, so Back (the title bar button and the Back links on the print and
 * e-document screens) can return to where they came from. It draws nothing. See src/lib/nav-history.ts for the rules.
 */
export default function NavigationHistory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const byHistory = useRef(false);

  // The browser's own back and forward buttons fire popstate before the address changes. The flag is dropped after a moment
  // so a popstate that changed nothing cannot colour the next ordinary move.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mark = () => {
      byHistory.current = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        byHistory.current = false;
      }, 1500);
    };
    window.addEventListener("popstate", mark);
    return () => {
      window.removeEventListener("popstate", mark);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const raw = search ? `${pathname}?${search}` : pathname;
    writeStack(visit(readStack(), raw, byHistory.current));
    byHistory.current = false;
  }, [pathname, search]);

  return null;
}
