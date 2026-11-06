import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EDocumentBody } from "@/components/EDocumentBody";
import { ImportEInvoice } from "@/components/ImportEInvoice";
import { RegenerateEInvoice } from "@/components/RegenerateEInvoice";
import { RejectEInvoice, ReleaseDuplicate } from "@/components/RejectEInvoice";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { parseUbl } from "@/lib/einvoice/ubl";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "E-document" };

const LAYERS = ["xsd", "en16931", "peppol", "national"] as const;

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Dublin",
  }).format(date);
}

export default async function EDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: document }, { data: results }, { data: events }] = await Promise.all([
    supabase.from("e_documents").select("*").eq("id", id).maybeSingle(),
    supabase.from("e_document_validation_results").select("layer, rule_id, severity, message").eq("e_document_id", id),
    supabase.from("e_document_events").select("at, from_status, to_status, detail").eq("e_document_id", id).order("at"),
  ]);
  if (!document) notFound();
  const row = document as {
    id: string;
    status: string;
    direction: string;
    document_number: string | null;
    issue_date: string | null;
    currency_code: string | null;
    seller_name: string | null;
    buyer_name: string | null;
    total_amount: number | null;
    amount_due: number | null;
    rejection_reason: string | null;
    semantic: Record<string, unknown> | null;
    header_id: string | null;
    rules_version: string | null;
    ubl_root: string;
  };
  const outboundValid =
    row.direction === "outbound" && row.header_id
      ? await supabase
          .from("e_documents")
          .select("id", { count: "exact", head: true })
          .eq("header_id", row.header_id)
          .eq("direction", "outbound")
          .eq("status", "valid")
      : null;
  const failures = (results ?? []) as { layer: string; rule_id: string; severity: string; message: string }[];
  const importing = row.direction === "inbound" && row.status === "valid";
  let semantic = row.semantic;
  if (importing) {
    const content = await supabase.from("e_document_contents").select("xml").eq("e_document_id", row.id).maybeSingle();
    const xml = (content.data as { xml?: string } | null)?.xml;
    if (xml) {
      try {
        semantic = parseUbl(xml) as Record<string, unknown>;
      } catch {
        semantic = row.semantic;
      }
    }
  }

  if (importing) {
    const creditNote = row.ubl_root === "CreditNote";
    const defaults = await supabase
      .from("organisation_defaults")
      .select("home_currency_id, inbound_invoice_type_id, inbound_credit_note_type_id")
      .eq("organisation_id", workspace.current.organisationId)
      .maybeSingle();
    const defaultsRow = defaults.data as {
      home_currency_id: string | null;
      inbound_invoice_type_id: string | null;
      inbound_credit_note_type_id: string | null;
    } | null;
    const typeId = creditNote ? defaultsRow?.inbound_credit_note_type_id : defaultsRow?.inbound_invoice_type_id;
    const typeResult = typeId
      ? await supabase
          .from("transaction_types")
          .select("description, flex1_label, flex2_label, flex3_label, flex4_label, flex5_label")
          .eq("id", typeId)
          .maybeSingle()
      : null;
    const typeRow = typeResult?.data as {
      description: string;
      flex1_label: string | null;
      flex2_label: string | null;
      flex3_label: string | null;
      flex4_label: string | null;
      flex5_label: string | null;
    } | null;
    return (
      <ImportEInvoice
        id={row.id}
        semantic={semantic}
        organisationId={workspace.current.organisationId}
        documentNumber={row.document_number ?? ""}
        creditNote={creditNote}
        documentTitle={typeRow?.description ?? ""}
        flexLabels={[
          typeRow?.flex1_label ?? "",
          typeRow?.flex2_label ?? "",
          typeRow?.flex3_label ?? "",
          typeRow?.flex4_label ?? "",
          typeRow?.flex5_label ?? "",
        ]}
        homeCurrencyId={defaultsRow?.home_currency_id ?? ""}
        missingType={!typeRow}
        failures={failures.map((failure) => ({
          ruleId: failure.rule_id,
          severity: failure.severity,
          message: failure.message,
        }))}
        canReject={canManage(workspace.current.role)}
      />
    );
  }

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{row.document_number ?? "E-document"}</h1>
        <p className={styles.lede}>
          {row.direction === "inbound" ? "Received" : "Sent"} · {row.direction === "inbound" ? row.seller_name : row.buyer_name} · {row.status}
          {row.issue_date ? ` · ${row.issue_date}` : ""}
          {row.total_amount != null ? ` · ${row.total_amount}${row.currency_code ? ` ${row.currency_code}` : ""}` : ""}
          {row.amount_due != null ? ` · due ${row.amount_due}` : ""}
        </p>
      </div>
      <div className={styles.statusRow}>
        <a className={styles.quiet} href={`/api/einvoice/${row.id}/xml`}>
          Download XML
        </a>
        <Link className={styles.quiet} href={`/e-documents?direction=${row.direction}`}>
          Back
        </Link>
        {row.direction === "outbound" && row.header_id && (outboundValid?.count ?? 0) === 0 ? (
          <RegenerateEInvoice headerId={row.header_id} />
        ) : null}
        {row.direction === "inbound" && row.status === "duplicate" && canManage(workspace.current.role) ? <ReleaseDuplicate id={row.id} /> : null}
        {row.direction === "inbound" && (row.status === "valid" || row.status === "invalid" || row.status === "duplicate") && canManage(workspace.current.role) ? <RejectEInvoice id={row.id} /> : null}
      </div>
      {row.rejection_reason ? <p className={styles.alert}>{row.rejection_reason}</p> : null}
      <EDocumentBody semantic={semantic} />
      <div className={styles.recordPair}>
        <div>
          <h2 className={styles.heading}>Validation</h2>
          <p className={styles.panelMeta}>Rules {row.rules_version ?? "—"}.</p>
          {failures.length === 0 ? (
            <p className={styles.panelMeta}>No rule failures.</p>
          ) : (
            LAYERS.map((layer) => {
              const group = failures
                .filter((result) => result.layer === layer)
                .sort((left, right) => (left.severity === right.severity ? 0 : left.severity === "fatal" ? -1 : 1));
              if (group.length === 0) return null;
              return (
                <div key={layer}>
                  <h3 className={styles.sectionLabel}>{layer}</h3>
                  <ul className={styles.metaList}>
                    {group.map((result) => (
                      <li key={`${result.layer}-${result.rule_id}-${result.message}`}>
                        <span>{result.severity}</span>
                        <span>
                          {result.rule_id}: {result.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
        <div>
          <h2 className={styles.heading}>History</h2>
          <ul className={styles.metaList}>
            {(events as { at: string; from_status: string | null; to_status: string }[] | null)?.map((event) => (
              <li key={event.at}>
                <span>{formatWhen(event.at)}</span>
                <span>
                  {event.from_status ?? "new"} → {event.to_status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
