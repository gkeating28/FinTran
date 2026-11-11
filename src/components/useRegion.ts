"use client";

import { useMemo, useSyncExternalStore } from "react";
import { DEFAULT_REGION, type Region } from "@/lib/dates";

function subscribe(notify: () => void) {
  window.addEventListener("languagechange", notify);
  return () => window.removeEventListener("languagechange", notify);
}

function browserRegion() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_REGION.timeZone;
  return `${navigator.language || DEFAULT_REGION.locale}|${timeZone}`;
}

function serverRegion() {
  return `${DEFAULT_REGION.locale}|${DEFAULT_REGION.timeZone}`;
}

/**
 * The person's regional setting, taken from the browser. The server and the first render in the browser
 * use the default, so the page matches what the server sent, and the browser's own setting follows.
 */
export function useRegion(): Region {
  const value = useSyncExternalStore(subscribe, browserRegion, serverRegion);
  return useMemo(() => {
    const [locale, timeZone] = value.split("|");
    return { locale, timeZone };
  }, [value]);
}
