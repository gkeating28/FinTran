import nspell from "nspell";

type Spell = {
  correct(word: string): boolean;
};

let pending: Promise<Spell> | null = null;

export function loadSpellingDictionary() {
  if (!pending) {
    pending = fetch("/api/spelling-dictionary")
      .then((response) => {
        if (!response.ok) throw new Error("The spelling dictionary could not be loaded.");
        return response.json() as Promise<{ aff: string; dic: string }>;
      })
      .then(({ aff, dic }) => nspell(aff, dic))
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
