"use client";

import { useState } from "react";
import styles from "@/components/OpsPage.module.css";

/**
 * The fields for keeping questions and answers with a rating. Keeping them needs its own notice, which names the number
 * of days, so the notice appears when keeping is being switched on or the number of days is being changed.
 */
export default function AskQulaLogFields({ logAnswers, retentionDays }: { logAnswers: boolean; retentionDays: number }) {
  const [keep, setKeep] = useState(logAnswers);
  const [days, setDays] = useState(String(retentionDays));
  const number = Number(days);
  const valid = Number.isInteger(number) && number >= 1 && number <= 365;
  const needsNotice = keep && (!logAnswers || number !== retentionDays);

  return (
    <>
      <label className={`${styles.checkLine} ${styles.wide}`}>
        <input type="checkbox" name="logAnswers" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
        When someone rates an answer, keep the question and the answer with the rating so you can review it. Off by default. With it off only the thumb and any comment are kept.
      </label>
      <label className={styles.field}>
        Keep the text for (days, 1 to 365)
        <input name="retentionDays" value={days} onChange={(event) => setDays(event.target.value)} inputMode="numeric" maxLength={3} title="After this many days the question, answer and comment are deleted automatically. The rating is kept." />
      </label>
      {needsNotice ? (
        <label className={`${styles.checkLine} ${styles.wide}`}>
          <input type="checkbox" name="logNotice" required />
          Questions and answers will be stored for {valid ? number : "the chosen number of"} days and visible to owners and admins.
        </label>
      ) : null}
    </>
  );
}
