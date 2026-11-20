import { parseStack, type NavEntry } from "@/lib/nav-history";

/** Browser-side storage for the navigation record. It lives in the tab's session storage, so a reload keeps it and a new tab starts empty. */
const KEY = "qula.nav";
const EVENT = "qula-nav";

export function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function readStack(): NavEntry[] {
  return parseStack(readRaw());
}

export function writeStack(stack: NavEntry[]) {
  const next = JSON.stringify(stack);
  if (next === (readRaw() ?? "[]")) return;
  try {
    window.sessionStorage.setItem(KEY, next);
  } catch {
    // Storage can be blocked. Back then falls back to the screen's usual parent.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
