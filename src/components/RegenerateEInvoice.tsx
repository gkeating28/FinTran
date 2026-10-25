"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/OpsPage.module.css";

export function RegenerateEInvoice({ headerId, label = "Regenerate" }: { headerId: string; label?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <span>
      <button
        className={styles.primary}
        type="button"
        disabled={pending || !headerId}
        onClick={async () => {
          setPending(true);
          setError(null);
          const response = await fetch(`/api/einvoice/outbound/${headerId}`, { method: "POST" });
          const body = (await response.json()) as { id?: string; error?: string };
          setPending(false);
          if (!response.ok || !body.id) {
            setError(body.error ?? "The e-invoice could not be generated.");
            return;
          }
          router.push(`/e-documents/${body.id}`);
          router.refresh();
        }}
      >
        {pending ? "Generating…" : label}
      </button>
      {error ? <span className={styles.alert}>{error}</span> : null}
    </span>
  );
}
