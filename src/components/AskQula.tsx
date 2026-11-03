"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const chat = useSyncExternalStore(subscribe, () => clientSnapshot(organisationId), serverSnapshot);
  const drawerRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const isClient = useSyncExternalStore(subscribeClient, clientTrue, serverFalse);
  const { messages, open } = chat;

  useLayoutEffect(() => {
    if (!isClient) return;
    const place = () => {
      const bar = buttonRef.current?.closest("[data-title-bar]");
      const drawer = drawerRef.current;
      if (!(bar instanceof HTMLElement) || !drawer) return;
      drawer.style.top = `${Math.round(bar.getBoundingClientRect().bottom)}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isClient, open]);

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

  const drawer = (
      <section
        ref={drawerRef}
        className={styles.drawer}
        id={panelId}
        role="dialog"
        aria-labelledby={titleId}
        aria-hidden={!open}
        data-open={open ? "true" : "false"}
        inert={!open}
        style={{ top: 60 }}
      >
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
  );

  return (
    <>
      <button
        ref={buttonRef}
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Ask Qula"
        title="Ask Qula"
        onClick={() => setOpen(!open)}
      >
        <Sparkle />
      </button>
      {isClient ? createPortal(drawer, document.body) : null}
    </>
  );
}

function Sparkle() {
  return (
    <svg viewBox="1.6 0.8 21.2 19.6" aria-hidden="true">
      <path fill="#f4f8ff" d="M11.1 1.8 13.4 8.1 19.8 10.2 13.4 12.3 11.1 18.6 8.8 12.3 2.4 10.2 8.8 8.1Z" />
      <path fill="#d5c6ff" d="M17.6 2.2 19 5.2 22 6.4 19 7.6 17.6 10.6 16.2 7.6 13.2 6.4 16.2 5.2Z" />
      <path fill="#9ecbff" d="M6.2 13.4 7.2 15.6 9.5 16.5 7.2 17.4 6.2 19.6 5.2 17.4 2.9 16.5 5.2 15.6Z" />
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

function subscribeClient() {
  return () => {};
}

function clientTrue() {
  return true;
}

function serverFalse() {
  return false;
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
