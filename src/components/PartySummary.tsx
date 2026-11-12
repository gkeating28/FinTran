"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRegion } from "@/components/useRegion";
import { formatDate } from "@/lib/dates";
import { PARTY_META, type PartyKind } from "@/lib/parties";
import { partyChecks, partyReadiness, type PartyReadinessInput } from "@/lib/party-readiness";
import type { PartySummary as Summary } from "@/lib/party-summary";
import { loadPartySummary } from "@/lib/party-summary-actions";
import { formatMoney } from "@/lib/documents";
import { documentStatusLabel, type DocumentStatus } from "@/lib/transaction-types";
import documentStyles from "@/components/Document.module.css";
import styles from "@/components/PartySummary.module.css";

function statusTone(status: DocumentStatus) {
  if (status === "posted" || status === "closed") return "ready";
  if (status === "void" || status === "cancelled") return "error";
  if (status === "open") return "warning";
  return undefined;
}

const READINESS_TITLE = { ready: "Ready for e-invoices", warning: "E-invoice details incomplete", error: "Not ready for e-invoices" } as const;

/**
 * Beside the customer or supplier form: whether the record has what an e-invoice needs, checked as it is
 * typed, and what this organisation has done with them. A new record has no history, so only the check shows.
 */
export default function PartySummary({
  kind,
  partyId,
  currencyCode,
  values,
}: {
  kind: PartyKind;
  partyId: string | null;
  currencyCode: string;
  values: PartyReadinessInput;
}) {
  const region = useRegion();
  const [loaded, setLoaded] = useState<{ id: string; summary: Summary | null } | null>(null);
  const summary = loaded && loaded.id === partyId ? loaded.summary : undefined;

  useEffect(() => {
    if (!partyId) return;
    let cancelled = false;
    loadPartySummary(kind, partyId).then((result) => {
      if (!cancelled) setLoaded({ id: partyId, summary: result });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, partyId]);

  const checks = partyChecks(kind, values);
  const readiness = partyReadiness(checks);
  const customer = kind === "customers";
  const money = (value: number) => `${formatMoney(value)}${currencyCode ? ` ${currencyCode}` : ""}`;

  return (
    <aside className={styles.side} aria-label={`${PARTY_META[kind].singular} summary`}>
      <section className={styles.card}>
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle}>E-invoicing</h3>
          <span className={documentStyles.statusTag} data-status={readiness}>
            {readiness === "ready" ? "Ready" : readiness === "warning" ? "Check" : "Not ready"}
          </span>
        </div>
        <p className={styles.lede}>{READINESS_TITLE[readiness]}</p>
        <ul className={styles.checks}>
          {checks.map((check) => (
            <li key={check.id} data-ok={check.ok} data-required={check.required}>
              <span className={styles.mark} aria-hidden="true">
                {check.ok ? "✓" : check.required ? "!" : "–"}
              </span>
              <span>
                <span className={styles.checkLabel}>{check.label}</span>
                {check.ok ? null : <span className={styles.hint}>{check.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {partyId ? (
        <>
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>{customer ? "They owe you" : "You owe them"}</h3>
            {summary === undefined ? (
              <p className={styles.muted}>Loading…</p>
            ) : summary === null ? (
              <p className={styles.muted}>The figures could not be loaded.</p>
            ) : (
              <>
                <p className={styles.big}>{money(summary.due)}</p>
                <dl className={styles.facts}>
                  <dt>Past due</dt>
                  <dd data-alert={summary.overdue > 0}>
                    {money(summary.overdue)}
                    {summary.overdueCount > 0 ? ` · ${summary.overdueCount} document${summary.overdueCount === 1 ? "" : "s"}` : ""}
                  </dd>
                  <dt>{customer ? "Sales" : "Spend"} in {summary.year}</dt>
                  <dd>{money(summary.yearTotal)}</dd>
                  <dt>Active orders</dt>
                  <dd>{summary.activeOrders}</dd>
                  {summary.activeOrders > 0 ? (
                    <>
                      <dt>Left to invoice</dt>
                      <dd>{money(summary.toInvoice)} nett</dd>
                    </>
                  ) : null}
                  <dt>Documents</dt>
                  <dd>
                    {summary.documentCount}
                    {summary.lastDate ? ` · last ${formatDate(summary.lastDate, region)}` : ""}
                  </dd>
                </dl>
              </>
            )}
          </section>

          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Recent documents</h3>
            {summary === undefined ? (
              <p className={styles.muted}>Loading…</p>
            ) : !summary || summary.recent.length === 0 ? (
              <p className={styles.muted}>No documents yet.</p>
            ) : (
              <ul className={styles.documents}>
                {summary.recent.map((document) => (
                  <li key={document.id}>
                    <Link prefetch={false} href={`/transactions/${document.typeCode}?open=${document.id}`} className={styles.documentLink}>
                      {document.typeCode} {document.number || "draft"}
                    </Link>
                    <span className={styles.muted}>{formatDate(document.date, region)}</span>
                    <span className={documentStyles.statusTag} data-status={statusTone(document.status)}>
                      {documentStatusLabel(document.status)}
                    </span>
                    <span className={styles.amount}>{formatMoney(document.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>History</h3>
          <p className={styles.muted}>Amounts due, orders and recent documents show here once the {PARTY_META[kind].singular.toLowerCase()} is saved and has documents.</p>
        </section>
      )}
    </aside>
  );
}
