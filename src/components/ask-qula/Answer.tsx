"use client";

import { useState } from "react";
import { docHref, type AskBlock, type AskDoc } from "@/lib/ask-qula";
import { downloadCsv } from "@/lib/export/download";
import RichText from "@/components/RichText";
import styles from "@/components/AskQula.module.css";
import type { AskMessage } from "./storage";

export function Answer({ text, blocks, docs, onOpen }: { text: string; blocks?: AskBlock[]; docs?: AskDoc[]; onOpen: (doc: AskDoc) => void }) {
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

export function ProposalCard({ message, onDecide }: { message: AskMessage; onDecide: (message: AskMessage, confirm: boolean) => Promise<void> }) {
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

export function MessageBlock({ block }: { block: Extract<AskBlock, { type: "message" }> }) {
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

export function RatingRow({ message, onRate }: { message: AskMessage; onRate: (message: AskMessage, rating: 1 | -1, comment: string) => void }) {
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

export function TableBlock({ block }: { block: Extract<AskBlock, { type: "table" }> }) {
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

export function ChartBlock({ block }: { block: Extract<AskBlock, { type: "chart" }> }) {
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

export function DocCard({ doc, onOpen }: { doc: AskDoc; onOpen: (doc: AskDoc) => void }) {
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
