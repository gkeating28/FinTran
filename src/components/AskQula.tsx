"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { onAskRequest } from "@/components/askBus";
import { getAskContext } from "@/components/askContext";
import { ASK_SUGGESTIONS, docHref, type AskDoc } from "@/lib/ask-qula";
import { applyEvent, EMPTY_LIVE, readAskStream, type LiveAnswer } from "@/lib/ask-stream";
import { SparkleIcon } from "@/components/icons";
import styles from "@/components/AskQula.module.css";
import { clientSnapshot, newId, serverSnapshot, subscribe, writeStored, type AskMessage } from "@/components/ask-qula/storage";
import { Answer, ProposalCard, RatingRow } from "@/components/ask-qula/Answer";

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



function subscribeClient() {
  return () => {};
}

function clientTrue() {
  return true;
}

function serverFalse() {
  return false;
}
