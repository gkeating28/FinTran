"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/OpsPage.module.css";
import { createClient } from "@/lib/supabase/client";

export function RejectEInvoice({ id }: { id: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className={styles.stack}
      onSubmit={async (event) => {
        event.preventDefault();
        const supabase = createClient();
        const { error: rejected } = await supabase.rpc("reject_e_document", { p_id: id, p_reason: reason });
        if (rejected) {
          setError(rejected.message);
          return;
        }
        router.refresh();
      }}
    >
      <label className={styles.field}>
        Rejection reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} />
      </label>
      <button className={styles.primary} type="submit">
        Reject
      </button>
      {error ? <p className={styles.alert}>{error}</p> : null}
    </form>
  );
}
