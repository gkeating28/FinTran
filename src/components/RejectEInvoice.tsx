"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FormModal from "@/components/FormModal";
import styles from "@/components/OpsPage.module.css";
import { createClient } from "@/lib/supabase/client";

export function RejectEInvoice({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button className={styles.danger} type="button" onClick={() => { setError(null); setOpen(true); }}>
        Reject
      </button>
      {open ? (
        <FormModal title="Reject e-invoice" onClose={() => setOpen(false)} className={styles.lineDialog}>
          <form
            className={`${styles.modalForm} ${styles.partyForm}`}
            autoComplete="off"
            onSubmit={async (event) => {
              event.preventDefault();
              const supabase = createClient();
              const { error: rejected } = await supabase.rpc("reject_e_document", { p_id: id, p_reason: reason });
              if (rejected) {
                setError(rejected.message);
                return;
              }
              setOpen(false);
              router.refresh();
            }}
          >
            {error ? (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            ) : null}
            <label className={`${styles.field} ${styles.wide}`}>
              Rejection reason
              <input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} autoFocus />
            </label>
            <div className={styles.modalActions}>
              <button className={styles.quiet} type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className={styles.danger} type="submit">
                Reject
              </button>
            </div>
          </form>
        </FormModal>
      ) : null}
    </>
  );
}
