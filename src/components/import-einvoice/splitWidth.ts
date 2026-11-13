

export const SPLIT_WIDTH_KEY = "fintran.transactionSplitWidth";
export const SPLIT_HANDLE = 10;
export const SPLIT_MIN = 280;

export const splitListeners = new Set<() => void>();
let splitSnapshot: { raw: string | null; width: number | null } = { raw: null, width: null };

export function emitSplitWidth() {
  for (const listener of splitListeners) listener();
}

export function subscribeSplitWidth(listener: () => void) {
  splitListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SPLIT_WIDTH_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    splitListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readSplitWidth() {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SPLIT_WIDTH_KEY);
  } catch {
    raw = null;
  }
  if (splitSnapshot.raw === raw) return splitSnapshot.width;
  const value = raw == null ? Number.NaN : Number(raw);
  const width = Number.isFinite(value) ? value : null;
  splitSnapshot = { raw, width };
  return width;
}

export function writeSplitWidth(width: number) {
  const raw = String(width);
  try {
    window.localStorage.setItem(SPLIT_WIDTH_KEY, raw);
  } catch {
    // The divider still moves for this view when storage is blocked.
  }
  splitSnapshot = { raw, width };
  emitSplitWidth();
}

export function clampSplit(width: number, container: number) {
  const max = Math.max(SPLIT_MIN, container - SPLIT_MIN - SPLIT_HANDLE);
  return Math.round(Math.min(max, Math.max(SPLIT_MIN, width)));
}
