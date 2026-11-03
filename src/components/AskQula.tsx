"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ASK_SUGGESTIONS, docHref, type AskAnswer, type AskDoc } from "@/lib/ask-qula";
import styles from "@/components/AskQula.module.css";

type AskMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  docs?: AskDoc[];
};

type StoredChat = {
  messages: AskMessage[];
  open: boolean;
};

const EMPTY: StoredChat = { messages: [], open: false };
const listeners = new Set<() => void>();
const snapshots = new Map<string, { raw: string; value: StoredChat }>();

export default function AskQula({
  organisationId,
  organisationName,
}: {
  organisationId: string;
  organisationName: string;
}) {
  const router = useRouter();
  const panelId = useId();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const chat = useSyncExternalStore(subscribe, () => clientSnapshot(organisationId), serverSnapshot);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const { messages, open } = chat;

  useEffect(() => {
    const log = logRef.current;
    if (!log || !open) return;
    log.scrollTop = log.scrollHeight;
  }, [messages, pending, open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") writeStored(organisationId, { messages: clientSnapshot(organisationId).messages, open: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, organisationId]);

  function append(message: AskMessage) {
    const current = clientSnapshot(organisationId);
    writeStored(organisationId, { messages: [...current.messages, message], open: true });
  }

  async function send(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    append({ id: newId(), role: "user", text });
    setDraft("");
    setPending(true);
    try {
      const response = await fetch("/api/ask-qula", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, organisationId }),
      });
      const body = (await response.json()) as AskAnswer & { error?: string };
      const reply = response.ok ? body.text || "Nothing matched that." : body.error || "That could not be answered.";
      append({ id: newId(), role: "assistant", text: reply, docs: response.ok ? body.docs : undefined });
    } catch {
      append({ id: newId(), role: "assistant", text: "Ask Qula could not be reached." });
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function openDocument(doc: AskDoc) {
    const href = docHref(doc);
    if (!href) return;
    writeStored(organisationId, { messages: clientSnapshot(organisationId).messages, open: true });
    const stamp = Date.now().toString(36);
    router.push(`${href}${href.includes("?") ? "&" : "?"}ask=${stamp}`);
  }

  function setOpen(next: boolean) {
    writeStored(organisationId, { messages: clientSnapshot(organisationId).messages, open: next });
    if (next) requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className={styles.dock}>
      <section className={styles.panel} id={panelId} role="dialog" aria-labelledby={titleId} hidden={!open}>
        <header className={styles.head}>
          <div>
            <h2 id={titleId} className={styles.title}>
              Ask Qula
            </h2>
            <p className={styles.subtitle}>Records for {organisationName}.</p>
          </div>
          <button className={styles.close} type="button" onClick={() => setOpen(false)} aria-label="Close Ask Qula">
            Close
          </button>
        </header>
        <div className={styles.log} ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 ? (
            <p className={styles.intro}>
              Ask about transactions, e-documents, or what is overdue. The answer is looked up from this organisation.
            </p>
          ) : null}
          {messages.map((message) => (
            <article key={message.id} className={message.role === "user" ? styles.user : styles.assistant}>
              <p>{message.text}</p>
              {message.docs && message.docs.length > 0 ? (
                <div className={styles.cards}>
                  {message.docs.map((doc) => (
                    <DocCard key={`${doc.store}-${doc.recordId ?? doc.ref}`} doc={doc} onOpen={openDocument} />
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {pending ? (
            <p className={styles.typing} role="status">
              Looking that up
              <span className={styles.dots} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </p>
          ) : null}
        </div>
        <div className={styles.chips} aria-label="Suggestions">
          {ASK_SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} className={styles.chip} type="button" disabled={pending} onClick={() => void send(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label className={styles.questionLabel} htmlFor={`${panelId}-question`}>
            Question
          </label>
          <input
            id={`${panelId}-question`}
            ref={inputRef}
            className={styles.question}
            value={draft}
            maxLength={300}
            autoComplete="off"
            placeholder="Ask about a transaction"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className={styles.send} type="submit" disabled={pending || draft.trim() === ""}>
            Send
          </button>
        </form>
      </section>
      <button className={styles.fab} type="button" aria-label="Ask Qula" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <Sparkle />
      </button>
    </div>
  );
}

function Sparkle() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M12.2 8.2c.7 4.6 2.3 6.6 6.9 7.3-4.6.7-6.2 2.7-6.9 7.3-.7-4.6-2.3-6.6-6.9-7.3 4.6-.7 6.2-2.7 6.9-7.3z" />
      <path d="M23.4 4.6c.4 2.5 1.3 3.6 3.8 4-2.5.4-3.4 1.5-3.8 4-.4-2.5-1.3-3.6-3.8-4 2.5-.4 3.4-1.5 3.8-4z" />
      <path d="M24.8 15.2c.28 1.7.9 2.5 2.6 2.8-1.7.3-2.32 1.1-2.6 2.8-.28-1.7-.9-2.5-2.6-2.8 1.7-.3 2.32-1.1 2.6-2.8z" />
    </svg>
  );
}

function DocCard({ doc, onOpen }: { doc: AskDoc; onOpen: (doc: AskDoc) => void }) {
  const href = docHref(doc);
  const body = (
    <>
      <span className={styles.ref}>{doc.ref}</span>
      <span className={styles.cardTitle}>{doc.title}</span>
      <span className={styles.status}>
        <span className={styles.dot} style={{ background: doc.statusColor }} />
        {doc.status}
      </span>
    </>
  );
  if (!href) return <div className={styles.card}>{body}</div>;
  return (
    <button className={styles.card} type="button" onClick={() => onOpen(doc)}>
      {body}
    </button>
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function serverSnapshot() {
  return EMPTY;
}

function clientSnapshot(organisationId: string) {
  let raw = "";
  try {
    raw = sessionStorage.getItem(storageKey(organisationId)) ?? "";
  } catch {
    return snapshots.get(organisationId)?.value ?? EMPTY;
  }
  const cached = snapshots.get(organisationId);
  if (cached?.raw === raw) return cached.value;
  const value = parseStored(raw);
  snapshots.set(organisationId, { raw, value });
  return value;
}

function writeStored(organisationId: string, chat: StoredChat) {
  const messages = chat.messages.slice(-40);
  const value = messages.length === 0 && !chat.open ? EMPTY : { messages, open: chat.open };
  const raw = JSON.stringify({ messages: value.messages, open: value.open });
  try {
    sessionStorage.setItem(storageKey(organisationId), raw);
  } catch {
    snapshots.set(organisationId, { raw, value });
    for (const listener of listeners) listener();
    return;
  }
  snapshots.set(organisationId, { raw, value });
  for (const listener of listeners) listener();
}

function storageKey(organisationId: string) {
  return `fintran.ask-qula.${organisationId}`;
}

function parseStored(raw: string): StoredChat {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const record = parsed as { messages?: unknown; open?: unknown };
    const messages = Array.isArray(record.messages) ? record.messages.filter(isMessage).slice(-40) : [];
    if (messages.length === 0 && record.open !== true) return EMPTY;
    return { messages, open: record.open === true };
  } catch {
    return EMPTY;
  }
}

function isMessage(value: unknown): value is AskMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as AskMessage;
  if ((message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string" || typeof message.id !== "string") {
    return false;
  }
  if (message.docs != null && (!Array.isArray(message.docs) || !message.docs.every(isDoc))) return false;
  return true;
}

function isDoc(value: unknown): value is AskDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as AskDoc;
  return (
    typeof doc.ref === "string" &&
    typeof doc.title === "string" &&
    typeof doc.store === "string" &&
    typeof doc.status === "string" &&
    typeof doc.statusColor === "string"
  );
}

function newId() {
  return crypto.randomUUID();
}
