"use client";

import { useCallback, useState } from "react";

/** How long an action may run before the screen stops showing it as busy. */
const SLOW_ACTION_MS = 15_000;

/**
 * Runs an action and keeps a busy flag for it. The flag clears as soon as the action's own work has finished, and it never waits for
 * a page refresh, so a refresh that stalls cannot leave a button disabled. When the work has not finished after SLOW_ACTION_MS the flag
 * clears and a notice says to check where things stand. The work returns an error message, or null when it succeeded. A late result
 * replaces that notice.
 */
export function useGuardedAction(setError: (message: string | null) => void) {
  const [busy, setBusy] = useState(false);
  const start = useCallback(
    (work: () => Promise<string | null>) => {
      setError(null);
      setBusy(true);
      const timer = setTimeout(() => {
        setBusy(false);
        setError("This is taking longer than expected. Reload the page to see where it stands before trying again.");
      }, SLOW_ACTION_MS);
      work()
        .then((message) => setError(message))
        .catch(() => setError("That did not complete. Reload the page to see where it stands before trying again."))
        .finally(() => {
          clearTimeout(timer);
          setBusy(false);
        });
    },
    [setError],
  );
  return [busy, start] as const;
}
