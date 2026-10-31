"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadSpellingDictionary } from "@/lib/spelling-dictionary";
import { unknownSpellings } from "@/lib/spelling";
import styles from "@/components/OpsPage.module.css";

const STORAGE_KEY = "fintran.spelling.ignored";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readIgnored() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function ignoredWords(serialized: string) {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((word): word is string => typeof word === "string"));
  } catch {
    return new Set<string>();
  }
}

function ignoreWord(word: string) {
  const key = word.toLocaleLowerCase("en-GB");
  const ignored = ignoredWords(readIgnored());
  ignored.add(key);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ignored]));
  } catch {
    // The word still stays ignored for this view when storage is blocked.
  }
  emit();
}

export default function SpellingNote({ text }: { text: string }) {
  const stored = useSyncExternalStore(subscribe, readIgnored, () => "[]");
  const ignored = useMemo(() => ignoredWords(stored), [stored]);
  const [correct, setCorrect] = useState<((word: string) => boolean) | null>(null);

  useEffect(() => {
    let cancel = false;
    loadSpellingDictionary()
      .then((spell) => {
        if (!cancel) setCorrect(() => (word: string) => spell.correct(word));
      })
      .catch(() => {
        if (!cancel) setCorrect(null);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const words = useMemo(
    () => (correct ? unknownSpellings(text, correct, ignored) : []),
    [correct, ignored, text],
  );
  if (words.length === 0) return null;

  return (
    <p className={styles.spelling}>
      <span>Spelling</span>
      {words.slice(0, 8).map((word) => (
        <span key={word.toLocaleLowerCase("en-GB")}>
          {word}
          <button type="button" onClick={() => ignoreWord(word)}>
            Ignore
          </button>
        </span>
      ))}
    </p>
  );
}
