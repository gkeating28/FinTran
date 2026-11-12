"use client";

import Link from "next/link";
import { useState } from "react";
import FormModal from "@/components/FormModal";
import { readinessHref } from "@/lib/en16931";
import type { DocumentRow } from "@/lib/documents";
import { AskExplainButton } from "@/components/AskExplain";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";

export function readinessStatus(items: DocumentRow["readiness"]) {
  if (items.some((item) => item.severity === "error")) return "error" as const;
  if (items.length > 0) return "warning" as const;
  return "ready" as const;
}

export function readinessSummary(items: DocumentRow["readiness"], direction: "Sales" | "Purchases" = "Purchases") {
  const errors = items.filter((item) => item.severity === "error").length;
  const warnings = items.filter((item) => item.severity === "warning").length;
  if (errors > 0) {
    return `${errors} error${errors === 1 ? "" : "s"}. Posting is blocked until these are fixed.`;
  }
  if (warnings > 0) {
    return direction === "Sales"
      ? `${warnings} warning${warnings === 1 ? "" : "s"}.`
      : `${warnings} warning${warnings === 1 ? "" : "s"}. A purchase can still be posted.`;
  }
  return "Ready. This document has the data needed for an EN 16931 invoice.";
}

export function ReadinessList({ items, direction }: { items: DocumentRow["readiness"]; direction: "Sales" | "Purchases" }) {
  const question = `Explain these e-invoice issues on a ${direction === "Sales" ? "sales" : "purchase"} document and how to fix each: ${items.map((item) => `${item.ruleId} (${item.businessTerm})`).join(", ")}.`;
  return (
    <>
      <ul className={documentStyles.readinessList}>
        {items.map((item, index) => {
          const href = readinessHref(item.businessTerm, direction);
          const label = href === "/customers" ? "Open Customers" : href === "/suppliers" ? "Open Suppliers" : "Open Organisations";
          return (
            <li key={`${item.ruleId}-${item.businessTerm}-${index}`} className={documentStyles.readinessItem} data-status={item.severity}>
              <div className={documentStyles.readinessRule}>{item.ruleId}</div>
              <p>{item.message}</p>
              {href ? <Link href={href}>{label}</Link> : <p className={styles.panelMeta}>Enter this on the document.</p>}
            </li>
          );
        })}
      </ul>
      <AskExplainButton question={question} />
    </>
  );
}

export function ReadinessControl({
  items,
  direction,
  pending = false,
}: {
  items: DocumentRow["readiness"];
  direction: "Sales" | "Purchases";
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = pending ? "pending" : readinessStatus(items);

  return (
    <>
      <button
        className={documentStyles.readinessButton}
        data-status={status}
        type="button"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        Readiness
      </button>
      {open ? (
        <FormModal title="Readiness" className={documentStyles.readinessDialog} onClose={() => setOpen(false)}>
          <div className={documentStyles.readinessBody}>
            <p className={documentStyles.readinessSummary} data-status={status}>
              {readinessSummary(items, direction)}
            </p>
            {items.length > 0 ? <ReadinessList items={items} direction={direction} /> : null}
          </div>
        </FormModal>
      ) : null}
    </>
  );
}
