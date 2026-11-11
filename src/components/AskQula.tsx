"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { onAskRequest } from "@/components/askBus";
import { getAskContext } from "@/components/askContext";
import { ASK_SUGGESTIONS, docHref, type AskBlock, type AskDoc, type AskProposal } from "@/lib/ask-qula";
import { applyEvent, EMPTY_LIVE, readAskStream, type LiveAnswer } from "@/lib/ask-stream";
import { downloadCsv } from "@/lib/export/download";
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
  /** True when a model wrote the answer. Only those can be rated. */
  ai?: boolean;
  /** The question the answer replies to, kept so a rating can say what it was about. */
  question?: string;
  rated?: 1 | -1;
  /** Something Ask Qula proposed, and what became of it. */
  proposal?: AskProposal;
  proposalState?: "done" | "failed" | "cancelled";
  proposalResult?: string;
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
        proposal: answer.proposal ?? undefined,
        ...(answer.intent === "ai" && answer.text.trim() ? { ai: true, question: text } : {}),
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

  // A button elsewhere on the screen can ask a question for the person. Keep the latest send for it to call.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(
    () =>
      onAskRequest((question) => {
        writeStored(organisationId, { messages: clientSnapshot(organisationId).messages, open: true });
        void sendRef.current(question);
      }),
    [organisationId],
  );

  function openDocument(doc: AskDoc) {
    const href = docHref(doc);
    if (!href) return;
    writeStored(organisationId, { messages: clientSnapshot(organisationId).messages, open: true });
    const stamp = Date.now().toString(36);
    router.push(`${href}${href.includes("?") ? "&" : "?"}ask=${stamp}`);
  }

  function patchMessage(id: string, patch: Partial<AskMessage>) {
    const current = clientSnapshot(organisationId);
    writeStored(organisationId, { messages: current.messages.map((item) => (item.id === id ? { ...item, ...patch } : item)), open: current.open });
  }

  /** Confirms or cancels something Ask Qula proposed. Nothing happens until the person confirms. */
  async function decide(message: AskMessage, confirm: boolean) {
    if (!message.proposal?.token) return;
    if (!confirm) {
      patchMessage(message.id, { proposalState: "cancelled", proposalResult: "Cancelled. Nothing was changed." });
      return;
    }
    try {
      const response = await fetch("/api/ask-qula/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: message.proposal.token }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (response.ok && body.ok) {
        patchMessage(message.id, { proposalState: "done", proposalResult: body.message ?? "Done." });
        router.refresh();
      } else {
        patchMessage(message.id, { proposalState: "failed", proposalResult: body.error ?? "That could not be done." });
      }
    } catch {
      patchMessage(message.id, { proposalState: "failed", proposalResult: "Ask Qula could not be reached. Nothing was changed." });
    }
  }

  async function rate(message: AskMessage, rating: 1 | -1, comment: string) {
    const current = clientSnapshot(organisationId);
    writeStored(organisationId, { messages: current.messages.map((item) => (item.id === message.id ? { ...item, rated: rating } : item)), open: current.open });
    try {
      await fetch("/api/ask-qula/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId, rating, question: message.question ?? "", answer: message.text, comment }),
      });
    } catch {
      // The thumb stays on screen. A lost rating is not worth interrupting the chat for.
    }
  }

  /** Forgets the conversation. It lives only in this browser session, so nothing is kept elsewhere. */
  function clearChat() {
    writeStored(organisationId, { messages: [], open: true });
    setDraft("");
    requestAnimationFrame(() => inputRef.current?.focus());
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
          <div className={styles.headActions}>
            <button className={styles.close} type="button" onClick={clearChat} disabled={pending || messages.length === 0} aria-label="Clear the conversation">
              Clear
            </button>
            <button className={styles.close} type="button" onClick={() => setOpen(false)} aria-label="Close Ask Qula">
              Close
            </button>
          </div>
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
              {message.proposal ? <ProposalCard message={message} onDecide={decide} /> : null}
              {message.ai ? <RatingRow message={message} onRate={rate} /> : null}
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
      {blocks?.map((block, index) => (block.type === "table" ? <TableBlock key={index} block={block} /> : block.type === "chart" ? <ChartBlock key={index} block={block} /> : <MessageBlock key={index} block={block} />))}
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

function ProposalCard({ message, onDecide }: { message: AskMessage; onDecide: (message: AskMessage, confirm: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const proposal = message.proposal;
  if (!proposal) return null;
  const state = message.proposalState;
  return (
    <section className={styles.proposal} aria-label={proposal.title} data-state={state ?? "waiting"}>
      <p className={styles.proposalLabel}>{proposal.label ?? "Proposed by Ask Qula"}</p>
      <h3 className={styles.proposalTitle}>{proposal.title}</h3>
      <dl className={styles.proposalRows}>
        {(proposal.rows ?? []).map((row, index) => (
          <div key={index}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {(proposal.issues ?? []).length > 0 ? (
        <ul className={styles.proposalIssues} aria-label="Readiness">
          {proposal.issues.map((issue, index) => (
            <li key={index} data-severity={issue.severity}>
              {issue.severity === "error" ? "Error" : "Warning"}: {issue.message}
            </li>
          ))}
        </ul>
      ) : proposal.confirmLabel === "Post it" ? (
        <p className={styles.proposalReady}>Readiness: no problems found.</p>
      ) : null}
      <ul className={styles.proposalLines}>
        {proposal.lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      {state ? (
        <p className={styles.proposalResult} role="status">
          {message.proposalResult}
        </p>
      ) : !proposal.token ? null : (
        <div className={styles.proposalActions}>
          <button
            className={styles.send}
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onDecide(message, true);
              setBusy(false);
            }}
          >
            {busy ? "Working" : proposal.confirmLabel}
          </button>
          <button className={styles.close} type="button" disabled={busy} onClick={() => void onDecide(message, false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function MessageBlock({ block }: { block: Extract<AskBlock, { type: "message" }> }) {
  const [copied, setCopied] = useState(false);
  const href = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(block.to) || block.to === ""
    ? `mailto:${block.to}?subject=${encodeURIComponent(block.subject)}&body=${encodeURIComponent(block.body)}`
    : null;
  return (
    <figure className={styles.block}>
      {block.title ? <figcaption className={styles.blockTitle}>{block.title}</figcaption> : null}
      <div className={styles.message}>
        <p className={styles.messageHead}>
          {block.to ? `To ${block.to}. ` : "No email address is saved for this customer. "}
          Subject: {block.subject}
        </p>
        <p className={styles.messageBody}>{block.body}</p>
      </div>
      <div className={styles.messageActions}>
        <button
          className={styles.blockAction}
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`Subject: ${block.subject}\n\n${block.body}`);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {href ? (
          <a className={styles.blockAction} href={href}>
            Open in email
          </a>
        ) : null}
      </div>
    </figure>
  );
}

function RatingRow({ message, onRate }: { message: AskMessage; onRate: (message: AskMessage, rating: 1 | -1, comment: string) => void }) {
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  if (message.rated) {
    return <p className={styles.rated}>{message.rated === 1 ? "Thanks, glad it helped." : "Thanks, that helps us improve it."}</p>;
  }
  if (commenting) {
    return (
      <form
        className={styles.commentForm}
        onSubmit={(event) => {
          event.preventDefault();
          onRate(message, -1, comment);
        }}
      >
        <label className={styles.questionLabel} htmlFor={`${message.id}-comment`}>
          What was wrong
        </label>
        <input id={`${message.id}-comment`} className={styles.question} value={comment} maxLength={300} autoComplete="off" autoFocus onChange={(event) => setComment(event.target.value)} />
        <button className={styles.send} type="submit">
          Send
        </button>
        <button className={styles.close} type="button" onClick={() => onRate(message, -1, "")}>
          Skip
        </button>
      </form>
    );
  }
  return (
    <div className={styles.rating} role="group" aria-label="Was this answer helpful?">
      <button className={styles.thumb} type="button" aria-label="Helpful" title="Helpful" onClick={() => onRate(message, 1, "")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 11v9H4v-9h3zm0 0 4-8c1.7 0 3 1.3 3 3v3h5.3a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 18.1 20H7" />
        </svg>
      </button>
      <button className={styles.thumb} type="button" aria-label="Not helpful" title="Not helpful" onClick={() => setCommenting(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: "rotate(180deg)" }}>
          <path d="M7 11v9H4v-9h3zm0 0 4-8c1.7 0 3 1.3 3 3v3h5.3a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 18.1 20H7" />
        </svg>
      </button>
    </div>
  );
}

function TableBlock({ block }: { block: Extract<AskBlock, { type: "table" }> }) {
  function download() {
    const name = (block.title || "ask-qula").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ask-qula";
    downloadCsv(`${name}.csv`, block.columns, block.rows);
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
  if (message.ai != null && typeof message.ai !== "boolean") return false;
  if (message.rated != null && message.rated !== 1 && message.rated !== -1) return false;
  if (message.followups != null && (!Array.isArray(message.followups) || !message.followups.every((item) => typeof item === "string"))) return false;
  return true;
}

function isBlock(value: unknown): value is AskBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as AskBlock;
  if (block.type === "table") return Array.isArray(block.columns) && Array.isArray(block.rows) && block.rows.every(Array.isArray);
  if (block.type === "message") return typeof block.to === "string" && typeof block.subject === "string" && typeof block.body === "string";
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
