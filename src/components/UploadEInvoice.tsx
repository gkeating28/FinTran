"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/components/OpsPage.module.css";

export function UploadEInvoice({ onError }: { onError?: (message: string | null) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fileName, setFileName] = useState("");

  return (
    <form
      className={styles.uploadRow}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const file = new FormData(form).get("file");
        if (!(file instanceof File) || file.size === 0) {
          onError?.("Choose a UBL file.");
          return;
        }
        setPending(true);
        onError?.(null);
        const response = await fetch("/api/einvoice/inbound", { method: "POST", body: new FormData(form) });
        const body = (await response.json()) as { id?: string; error?: string };
        setPending(false);
        if (!response.ok || !body.id) {
          onError?.(body.error ?? "The file could not be received.");
          return;
        }
        router.push(`/e-documents/${body.id}`);
        router.refresh();
      }}
    >
      <label className={styles.quiet}>
        {fileName || "Choose XML"}
        <input
          className={styles.fileInput}
          name="file"
          type="file"
          accept=".xml,text/xml,application/xml"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
        />
      </label>
      <button className={styles.primary} type="submit" disabled={pending}>
        {pending ? "Checking…" : "Upload"}
      </button>
    </form>
  );
}
