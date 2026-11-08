"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { getAskContext } from "@/components/askContext";
import { ASK_SUGGESTIONS, docHref, type AskBlock, type AskDoc } from "@/lib/ask-qula";
import { applyEvent, EMPTY_LIVE, readAskStream, tableCsv, type LiveAnswer } from "@/lib/ask-stream";
import { SparkleIcon } from "@/components/icons";
import RichText from "@/components/RichText";
import styles from "@/components/AskQula.module.css";

type AskMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  docs?: AskDoc[];
  blocks?: AskBlock[];
  followups?: string[];
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
  aiEnabled = false,
}: {
  organisationId: string;
  organisationName: string;
  aiEnabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const panelId = useId();
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const chat = useSyncExternalStore(subscribe, () => clientSnapshot(organisationId), serverSnapshot);
  const drawerRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [live, setLive] = useState<LiveAnswer>(EMPTY_LIVE);
  const isClient = useSyncExternalStore(subscribeClient, clientTrue, serverFalse);
  const { messages, open } = chat;
  const last = messages[messages.length - 1];
  const lastFollowups = !pending && last?.role === "assistant" && last.followups?.length ? last.followups : null;

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
  }, [messages, pending, live, open]);

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

  /** What the person is looking at, so "this invoice" can mean the open one. */
  function pageContext() {
    const open = getAskContext();
    if (open) return open;
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "e-documents" && parts[1]) return { kind: "e-document", id: parts[1] };
    return parts[0] ? { kind: "page", section: parts[0] } : null;
  }

  async function send(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    const history = clientSnapshot(organisationId).messages.slice(-6).map((message) => ({ role: message.role, text: message.text }));
    append({ id: newId(), role: "user", text });
    setDraft("");
    setPending(true);
    let answer = EMPTY_LIVE;
    setLive(answer);
    try {
      const response = await fetch("/api/ask-qula", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, organisationId, history, context: pageContext(), stream: true }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        append({ id: newId(), role: "assistant", text: body.error || "That could not be answered." });
        return;
      }
      // The answer is complete at "done". The server may still be writing the usage record, so do not wait for it.
      let finished: () => void = () => {};
      const complete = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const reading = readAskStream(response, (event) => {
        answer = applyEvent(answer, event);
        setLive(answer);
        if (event.type === "done" || event.type === "error") finished();
      });
      reading.catch(() => {});
      await Promise.race([reading, complete]);
      const reply = [answer.text.trim() || (answer.error ? "" : "Nothing matched that."), answer.error].filter(Boolean).join("\n\n");
      append({
        id: newId(),
        role: "assistant",
        text: reply,
        docs: answer.docs.length ? answer.docs : undefined,
        blocks: answer.blocks.length ? answer.blocks : undefined,
        followups: answer.followups.length ? answer.followups : undefined,
      });
    } catch {
      const partial = answer.text.trim();
      append({ id: newId(), role: "assistant", text: partial ? `${partial}\n\nThe answer stopped early.` : "Ask Qula could not be reached." });
    } finally {
      setPending(false);
      setLive(EMPTY_LIVE);
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
              {aiEnabled
                ? "Ask Qula understands plain questions, such as which suppliers we owe the most, VAT by rate this quarter, or what we invoiced a customer in September. Open a document and ask about this invoice."
                : "Ask Qula answers a fixed set of questions: overdue items, recent transactions, drafts, and received e-documents."}
            </p>
          ) : null}
          {messages.map((message) => (
            <article key={message.id} className={message.role === "user" ? styles.user : styles.assistant}>
              <Answer text={message.text} blocks={message.blocks} docs={message.docs} onOpen={openDocument} />
            </article>
          ))}
          {pending ? (
            <>
              {live.text || live.blocks.length > 0 || live.docs.length > 0 ? (
                <article className={styles.assistant} aria-live="off">
                  <Answer text={live.text} blocks={live.blocks} docs={live.docs} onOpen={openDocument} />
                </article>
              ) : null}
              <p className={styles.typing} role="status">
                {live.status || (live.text ? "Writing" : "Thinking")}
                <span className={styles.dots} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </p>
            </>
          ) : null}
        </div>
        <div className={styles.chips} aria-label="Suggestions">
          {(lastFollowups ?? ASK_SUGGESTIONS).map((suggestion) => (
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
        <SparkleIcon />
      </button>
      {isClient ? createPortal(drawer, document.body) : null}
    </>
  );
}


function Answer({ text, blocks, docs, onOpen }: { text: string; blocks?: AskBlock[]; docs?: AskDoc[]; onOpen: (doc: AskDoc) => void }) {
  return (
    <>
      {text ? <RichText className={styles.text} text={text} /> : null}
      {blocks?.map((block, index) => (block.type === "table" ? <TableBlock key={index} block={block} /> : <ChartBlock key={index} block={block} />))}
      {docs && docs.length > 0 ? (
        <div className={styles.cards}>
          {docs.map((doc) => (
            <DocCard key={`${doc.store}-${doc.recordId ?? doc.ref}`} doc={doc} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function TableBlock({ block }: { block: Extract<AskBlock, { type: "table" }> }) {
  function download() {
    const url = URL.createObjectURL(new Blob([`\uFEFF${tableCsv(block)}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(block.title || "ask-qula").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ask-qula"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <figure className={styles.block}>
      {block.title ? <figcaption className={styles.blockTitle}>{block.title}</figcaption> : null}
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={block.title || "Table"}>
        <table className={styles.table}>
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th key={index} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className={styles.blockAction} type="button" onClick={download}>
        Download CSV
      </button>
    </figure>
  );
}

function ChartBlock({ block }: { block: Extract<AskBlock, { type: "chart" }> }) {
  const peak = Math.max(...block.values.map((value) => Math.abs(value)), 1);
  return (
    <figure className={styles.block}>
      {block.title ? <figcaption className={styles.blockTitle}>{block.title}</figcaption> : null}
      <ul className={styles.chart}>
        {block.labels.map((label, index) => (
          <li key={index} className={styles.chartRow}>
            <span className={styles.chartLabel}>{label}</span>
            <span className={styles.chartTrack} aria-hidden="true">
              <span className={block.values[index] < 0 ? styles.chartBarNegative : styles.chartBar} style={{ width: `${Math.max(2, Math.round((Math.abs(block.values[index]) / peak) * 100))}%` }} />
            </span>
            <span className={styles.chartValue}>
              {block.unit === "€" || block.unit === "$" || block.unit === "£" ? block.unit : ""}
              {block.values[index].toLocaleString("en-IE", { minimumFractionDigits: Number.isInteger(block.values[index]) ? 0 : 2, maximumFractionDigits: 2 })}
              {block.unit && !["€", "$", "£"].includes(block.unit) ? ` ${block.unit}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </figure>
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
  if (message.blocks != null && (!Array.isArray(message.blocks) || !message.blocks.every(isBlock))) return false;
  if (message.followups != null && (!Array.isArray(message.followups) || !message.followups.every((item) => typeof item === "string"))) return false;
  return true;
}

function isBlock(value: unknown): value is AskBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as AskBlock;
  if (block.type === "table") return Array.isArray(block.columns) && Array.isArray(block.rows) && block.rows.every(Array.isArray);
  if (block.type === "chart") return Array.isArray(block.labels) && Array.isArray(block.values) && block.values.every((item) => typeof item === "number");
  return false;
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
