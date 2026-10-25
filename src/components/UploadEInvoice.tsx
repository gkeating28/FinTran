"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/OpsPage.module.css";

export function UploadEInvoice() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className={styles.readinessBar}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setError(null);
        const response = await fetch("/api/einvoice/inbound", { method: "POST", body: form });
        const body = (await response.json()) as { id?: string; error?: string };
        setPending(false);
        if (!response.ok || !body.id) {
          setError(body.error ?? "The file could not be received.");
          return;
        }
        router.push(`/e-documents/${body.id}`);
        router.refresh();
      }}
    >
      <input name="file" type="file" accept=".xml,text/xml,application/xml" required />
      <button className={styles.primary} type="submit" disabled={pending}>
        {pending ? "Checking…" : "Upload UBL"}
      </button>
      {error ? <span className={styles.alert}>{error}</span> : null}
    </form>
  );
}
