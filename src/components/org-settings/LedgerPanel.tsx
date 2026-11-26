"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { QuietInput } from "@/components/QuietField";
import { saveLedgerSettings, switchLedgerMode } from "@/lib/ledger-actions";
import type { LedgerSettings } from "@/lib/ledger-data";
import styles from "@/components/OpsPage.module.css";

function dayBefore(date: string) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** What stops a switch, each with the place to put it right. The database refuses the same things. */
export function modeBlockers(settings: LedgerSettings, to: "feed" | "book", organisationId: string) {
  const lockHref = `/organisations?edit=${organisationId}`;
  const blockers: { text: string; href?: string; label?: string }[] = [];
  if (to === "book") {
    if (!settings.startDate) blockers.push({ text: "Set the go-live date." });
    else if (settings.lockDate && settings.lockDate > dayBefore(settings.startDate)) blockers.push({ text: `The lock date (${settings.lockDate}) is after the day before go-live. Move the lock date back first.`, href: lockHref, label: "Open the lock date" });
  } else {
    if (!settings.lockDate) blockers.push({ text: "Set a lock date, so the books you hand over cannot change.", href: lockHref, label: "Open the lock date" });
    if (settings.drafts > 0) blockers.push({ text: `Post or delete the ${settings.drafts} draft manual journal${settings.drafts === 1 ? "" : "s"}.`, href: "/ledger", label: "Open the journals" });
  }
  return blockers;
}

/**
 * How the ledger is used in this organisation: the go-live date, whether exported periods are locked, the opening balance
 * journal, and the mode. The mode is for owners. The rest is for owners and admins.
 */
export default function LedgerPanel({
  organisationId,
  settings,
  role,
  isCurrent,
}: {
  organisationId: string;
  settings: LedgerSettings;
  role: string;
  isCurrent: boolean;
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(settings.startDate);
  const [lockExported, setLockExported] = useState(settings.lockExported);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "alert" | "notice"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const target = settings.mode === "book" ? "feed" : "book";
  const blockers = modeBlockers(settings, target, organisationId);

  async function save() {
    setPending(true);
    const result = await saveLedgerSettings(organisationId, { startDate, lockExported });
    setPending(false);
    setMessage(result.ok ? { tone: "notice", text: result.message ?? "Saved." } : { tone: "alert", text: result.error });
    if (result.ok) router.refresh();
  }

  async function switchMode() {
    setPending(true);
    const result = await switchLedgerMode(organisationId, target, reason);
    setPending(false);
    setMessage(result.ok ? { tone: "notice", text: result.message ?? "Changed." } : { tone: "alert", text: result.error });
    if (result.ok) {
      setReason("");
      router.refresh();
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>Ledger</div>
      <div className={styles.partyFields}>
        {message ? (
          <p className={`${message.tone === "alert" ? styles.alert : styles.notice} ${styles.wide}`} role={message.tone === "alert" ? "alert" : "status"}>
            {message.text}
          </p>
        ) : null}
        <p className={`${styles.panelMeta} ${styles.wide}`}>
          <strong data-testid="ledger-mode">{settings.mode === "book" ? "Book of record" : "Feed"}.</strong>{" "}
          {settings.mode === "book"
            ? "Qula Plus is where your accounts are kept. Journals, the trial balance and the account enquiry are the record."
            : "Qula Plus sends documents and payments to your accounting system. It keeps the same entries, so you can switch to the book of record when you are ready."}{" "}
          Both modes post the same entries. The mode changes the controls, the screens and the export.
        </p>
        <label className={styles.field}>
          Go-live date
          <input type="date" name="ledger_start_date" value={startDate} disabled={settings.openingPosted} onChange={(event) => setStartDate(event.target.value)} />
          <small>{settings.openingPosted ? "Fixed, because the opening balance journal is posted." : "The opening balance journal is dated the day before."}</small>
        </label>
        <label className={styles.field}>
          <span>
            <input type="checkbox" name="lock_exported" checked={lockExported} onChange={(event) => setLockExported(event.target.checked)} /> Lock exported periods
          </span>
          <small>
            Refuses a new posting dated on or before the last export{settings.exportedThrough ? ` (${settings.exportedThrough})` : ""}. A void is never refused.
          </small>
        </label>
        <div className={`${styles.modalActions} ${styles.wide}`}>
          <span className={styles.actionStart} />
          <button className={styles.primary} type="button" disabled={pending} onClick={() => void save()}>
            Save ledger settings
          </button>
        </div>
        <p className={`${styles.panelMeta} ${styles.wide}`}>
          <strong>Opening balance journal.</strong>{" "}
          {settings.openingPosted
            ? "Posted."
            : !settings.startDate
              ? "Set and save the go-live date first."
              : isCurrent
                ? "Not posted yet."
                : "Open this organisation from the menu to post it."}{" "}
          {!settings.openingPosted && settings.startDate && isCurrent ? <Link href="/ledger?opening=1">Post the opening balances</Link> : null}
        </p>
        {role === "owner" ? (
          <>
            <p className={`${styles.panelMeta} ${styles.wide}`}>
              <strong>Switch to {target === "book" ? "the book of record" : "feed"}.</strong>
            </p>
            {blockers.length > 0 ? (
              <ul className={styles.wide}>
                {blockers.map((blocker) => (
                  <li key={blocker.text}>
                    {blocker.text} {blocker.href ? <Link href={blocker.href}>{blocker.label}</Link> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {target === "book" && !settings.openingPosted ? (
              <p className={`${styles.panelMeta} ${styles.wide}`}>No opening balance journal is posted. Your reason is kept as the reason it was waived.</p>
            ) : null}
            <label className={`${styles.field} ${styles.wide}`}>
              Reason
              <QuietInput name="ledger_reason" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
              <small>Kept in the change history.</small>
            </label>
            <div className={`${styles.modalActions} ${styles.wide}`}>
              <span className={styles.actionStart} />
              <button className={styles.quiet} type="button" disabled={pending || blockers.length > 0 || !reason.trim()} onClick={() => void switchMode()}>
                Switch to {target === "book" ? "book of record" : "feed"}
              </button>
            </div>
          </>
        ) : (
          <p className={`${styles.panelMeta} ${styles.wide}`}>Only an owner can switch the mode.</p>
        )}
      </div>
    </div>
  );
}
