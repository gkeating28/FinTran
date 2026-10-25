"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RegenerateEInvoice } from "@/components/RegenerateEInvoice";
import styles from "@/components/OpsPage.module.css";
import { semanticAt } from "@/lib/einvoice/semantic-read";
import { createClient } from "@/lib/supabase/client";

type DocumentRow = {
  id: string;
  direction: string;
  status: string;
  document_number: string | null;
  semantic: Record<string, unknown> | null;
};

export function EInvoicePanel({
  headerId,
  sales,
  posted,
  documentKind,
  foreignNett,
  foreignVat,
  foreignTotal,
}: {
  headerId: string;
  sales: boolean;
  posted: boolean;
  documentKind: string;
  foreignNett: string;
  foreignVat: string;
  foreignTotal: string;
}) {
  const showSales = sales && posted && (documentKind === "invoice" || documentKind === "credit_note");
  const [rows, setRows] = useState<DocumentRow[] | null>(null);
  const [fatals, setFatals] = useState(0);

  useEffect(() => {
    if (!showSales && sales) return;
    const supabase = createClient();
    void supabase
      .from("e_documents")
      .select("id, direction, status, document_number, semantic")
      .eq("header_id", headerId)
      .order("created_at", { ascending: false })
      .then(async ({ data }) => {
        const documents = (data ?? []) as DocumentRow[];
        setRows(documents);
        const current = documents[0];
        if (!current) return;
        const results = await supabase
          .from("e_document_validation_results")
          .select("id", { count: "exact", head: true })
          .eq("e_document_id", current.id)
          .eq("severity", "fatal");
        setFatals(results.count ?? 0);
      });
  }, [headerId, sales, showSales]);

  if (sales && !showSales) return null;
  if (!sales && (rows === null || rows.length === 0)) return null;

  const current = rows?.[0];
  const imported = rows?.find((row) => row.direction === "inbound" && row.status === "imported") ?? current;
  const hasValid = rows?.some((row) => row.direction === "outbound" && row.status === "valid") ?? false;
  const nett = semanticAt(imported?.semantic, "BG-22", "BT-109");
  const vat = semanticAt(imported?.semantic, "BG-22", "BT-110");
  const total = semanticAt(imported?.semantic, "BG-22", "BT-112");

  return (
    <div className={styles.stack}>
      <h2 className={styles.heading}>E-invoice</h2>
      {!current ? (
        <p className={styles.panelMeta}>No e-invoice is stored for this document.</p>
      ) : (
        <p className={styles.panelMeta}>
          {current.document_number ?? "E-invoice"} · {current.status}
          {fatals ? ` · ${fatals} fatal ${fatals === 1 ? "rule" : "rules"}` : " · no fatal rules"}
        </p>
      )}
      {!sales && imported ? (
        <p className={styles.panelMeta}>
          Nett {foreignNett} / {nett || "—"} · VAT {foreignVat} / {vat || "—"} · Total {foreignTotal} / {total || "—"}. The first
          figure is FinTran and the second is the e-invoice.
        </p>
      ) : null}
      <div className={styles.readinessBar}>
        {current ? (
          <Link className={styles.quiet} href={`/e-documents/${current.id}`}>
            Open e-document
          </Link>
        ) : null}
        {current ? (
          <a className={styles.quiet} href={`/api/einvoice/${current.id}/xml`}>
            Download XML
          </a>
        ) : null}
        {showSales && !hasValid ? <RegenerateEInvoice headerId={headerId} label={current ? "Regenerate" : "Generate"} /> : null}
      </div>
    </div>
  );
}
