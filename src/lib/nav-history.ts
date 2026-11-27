/**
 * Where the person has been in this tab, so Back can return to where they came from.
 *
 * The record is a short stack of screens. A screen is a path, and the record keeps the latest address it had, so coming back
 * to it brings back its filters. Moving between addresses of the same screen (a filter, a save that reloads the page, an error
 * message) changes the top entry and adds nothing. Back takes the top entry off and goes to the one below it.
 *
 * `open`, `opening`, `error`, `message`, `ask`, `edit` and `tab` in an address are one-off signals (open this document or organisation, show
 * this message), not part of where a screen was, so they are never kept: coming back to a list does not open a document or an
 * organisation the person had closed.
 */
export type NavEntry = {
  url: string;
  /** The person arrived by a link that opened a document, and has not closed it yet. Back then returns to where the link was. */
  arrivedOpen: boolean;
};

export const NAV_LIMIT = 40;

const TRANSIENT = ["open", "opening", "error", "message", "ask", "edit", "tab"];

/** Addresses that are not part of the signed-in app. Visiting one starts the record again. */
const UNTRACKED = /^\/(login|signup|auth|forbidden)(\/|$)/;

export function pathOf(url: string) {
  return url.split("#")[0].split("?")[0];
}

function queryOf(url: string) {
  return new URLSearchParams(url.split("#")[0].split("?")[1] ?? "");
}

export function hasOpenSignal(url: string) {
  const params = queryOf(url);
  return params.has("open") || params.has("opening");
}

/** The address without its one-off signals. */
export function cleanUrl(url: string) {
  const params = queryOf(url);
  for (const key of TRANSIENT) params.delete(key);
  const rest = params.toString();
  return rest ? `${pathOf(url)}?${rest}` : pathOf(url);
}

export function isTracked(url: string) {
  return !UNTRACKED.test(pathOf(url));
}

/**
 * Records that the person is now at this address. `byHistory` is true when the browser's own back or forward button moved
 * them: the screen is then looked for in the record, and everything after it is dropped.
 */
export function visit(stack: NavEntry[], raw: string, byHistory = false): NavEntry[] {
  if (!isTracked(raw)) return [];
  const url = cleanUrl(raw);
  const path = pathOf(url);
  const opened = hasOpenSignal(raw);

  if (byHistory) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (pathOf(stack[index].url) === path) {
        return [...stack.slice(0, index), { url, arrivedOpen: opened || (index === stack.length - 1 && stack[index].arrivedOpen) }];
      }
    }
  }

  const top = stack[stack.length - 1];
  if (top && pathOf(top.url) === path) {
    return [...stack.slice(0, -1), { url, arrivedOpen: opened || top.arrivedOpen }];
  }
  return [...stack, { url, arrivedOpen: opened }].slice(-NAV_LIMIT);
}

/** The screen before this one, or null when there is none. */
export function backTarget(stack: NavEntry[]): string | null {
  return stack.length > 1 ? stack[stack.length - 2].url : null;
}

/** The record after going back one screen. */
export function goneBack(stack: NavEntry[]): NavEntry[] {
  return stack.slice(0, -1);
}

export function arrivedOpen(stack: NavEntry[]) {
  return stack.length > 0 && stack[stack.length - 1].arrivedOpen;
}

/** The document that came with the address has been closed, so Back closes whatever is open next instead of leaving. */
export function documentClosed(stack: NavEntry[]): NavEntry[] {
  const top = stack[stack.length - 1];
  if (!top || !top.arrivedOpen) return stack;
  return [...stack.slice(0, -1), { ...top, arrivedOpen: false }];
}

export function parseStack(raw: string | null): NavEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const entry = item as { url?: unknown; arrivedOpen?: unknown };
      return typeof entry.url === "string" && entry.url.startsWith("/") ? [{ url: entry.url, arrivedOpen: entry.arrivedOpen === true }] : [];
    });
  } catch {
    return [];
  }
}
