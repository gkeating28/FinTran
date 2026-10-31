const URL_TOKEN =
  /^(?:https?:\/\/|www\.)\S+$/i;

const DOMAIN_TOKEN =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:[/?#]\S*)?$/i;

const EMAIL_TOKEN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function spellingCandidates(text: string) {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[\s"'([{]+/u, "").replace(/[)\]}"',.;:!?]+$/u, "");
    if (!token || skipToken(token)) continue;
    const key = token.toLocaleLowerCase("en-GB");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(token);
  }
  return found;
}

export function unknownSpellings(
  text: string,
  correct: (word: string) => boolean,
  ignored: ReadonlySet<string>,
) {
  return spellingCandidates(text).filter((word) => !knownWord(word, correct, ignored));
}

function skipToken(token: string) {
  if (token.length < 2) return true;
  if (URL_TOKEN.test(token) || DOMAIN_TOKEN.test(token) || EMAIL_TOKEN.test(token)) return true;
  if (token.includes("://") || token.includes("@") || /^(?:[a-z]\.){1,3}[a-z]?$/i.test(token)) return true;
  if (/\d/.test(token)) return true;
  if (token.length > 1 && token === token.toLocaleUpperCase("en-GB") && /[A-Z]/.test(token)) return true;
  return false;
}

function knownWord(word: string, correct: (word: string) => boolean, ignored: ReadonlySet<string>): boolean {
  const lower = word.toLocaleLowerCase("en-GB");
  if (ignored.has(lower)) return true;
  if (correct(word) || correct(lower)) return true;
  const stem = lower.endsWith("'s") ? lower.slice(0, -2) : lower;
  if (stem !== lower && (ignored.has(stem) || correct(stem))) return true;
  if (word.includes("-")) {
    const parts = word.split("-").filter(Boolean);
    return parts.length > 1 && parts.every((part) => knownWord(part, correct, ignored));
  }
  return false;
}
