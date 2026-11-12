import { AskExplainButton } from "@/components/AskExplain";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EDocumentView, formatEDocumentDate } from "@/components/EDocumentView";
import viewStyles from "@/components/EDocument.module.css";
import { ImportEInvoice } from "@/components/ImportEInvoice";
import { RegenerateEInvoice } from "@/components/RegenerateEInvoice";
import { RejectEInvoice, ReleaseDuplicate } from "@/components/RejectEInvoice";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { semanticAt } from "@/lib/einvoice/semantic-read";
import { parseUbl } from "@/lib/einvoice/ubl";
import { formatMoney } from "@/lib/documents";
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
        defaultTypeId={typeId ?? ""}
        failures={failures.map((failure) => ({
          ruleId: failure.rule_id,
          severity: failure.severity,
          message: failure.message,
        }))}
        canReject={canManage(workspace.current.role)}
      />
    );
  }

  const view = importing ? semantic : await currentSemantic(supabase, row.id, row.semantic);
  const partyName =
    row.direction === "inbound"
      ? row.seller_name || semanticAt(view, "BG-4", "BT-27")
      : row.buyer_name || semanticAt(view, "BG-7", "BT-44");
  let documentHref: string | null = null;
  if (row.header_id) {
    const linked = await supabase
      .from("transaction_headers")
      .select("id, transaction_types!inner(code)")
      .eq("id", row.header_id)
      .maybeSingle();
    const code = (linked.data as { transaction_types?: { code?: string } | { code?: string }[] } | null)?.transaction_types;
    const typeCode = Array.isArray(code) ? code[0]?.code : code?.code;
    if (typeCode) documentHref = `/transactions/${typeCode}?open=${row.header_id}`;
  }
  const manage = canManage(workspace.current.role);
  const history = (events ?? []) as { at: string; from_status: string | null; to_status: string }[];
  const tone = row.status === "imported" || row.status === "valid" || row.status === "sent" ? "ok" : row.status === "invalid" || row.status === "rejected" || row.status === "duplicate" ? "warn" : undefined;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{row.document_number ?? "E-document"}</h1>
        <p className={styles.lede}>
          {[
            `${row.direction === "inbound" ? "Received" : "Sent"}${partyName ? ` ${row.direction === "inbound" ? "from" : "to"} ${partyName}` : ""}`,
            row.issue_date ? formatEDocumentDate(row.issue_date) : "",
            row.total_amount != null ? `${row.currency_code ? `${row.currency_code} ` : ""}${formatMoney(row.total_amount)}` : "",
            row.amount_due != null ? `${formatMoney(row.amount_due)} due` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className={styles.statusRow}>
        <span className={viewStyles.status} data-tone={tone}>
          {row.status}
        </span>
        {documentHref ? (
          <Link prefetch className={styles.primary} href={documentHref}>
            {row.direction === "inbound" ? "View purchase document" : "View sales document"}
          </Link>
        ) : null}
        <a className={styles.quiet} href={`/api/einvoice/${row.id}/xml`}>
          Download XML
        </a>
        <Link className={styles.quiet} href={`/e-documents?direction=${row.direction}`}>
          Back
        </Link>
        {row.direction === "outbound" && row.header_id && (outboundValid?.count ?? 0) === 0 ? (
          <RegenerateEInvoice headerId={row.header_id} />
        ) : null}
        {row.direction === "inbound" && row.status === "duplicate" && manage ? <ReleaseDuplicate id={row.id} /> : null}
        {row.direction === "inbound" && (row.status === "invalid" || row.status === "duplicate") && manage ? <RejectEInvoice id={row.id} /> : null}
      </div>
      {row.rejection_reason ? <p className={styles.alert}>{row.rejection_reason}</p> : null}
      <EDocumentView semantic={view} />
      <div className={viewStyles.pair}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span>Validation</span>
            <span className={styles.panelMeta}>Rules {row.rules_version ?? "not recorded"}</span>
          </div>
          <div className={viewStyles.body}>
            {failures.length > 0 ? (
              <AskExplainButton question="Why did this e-document fail validation, and how do I fix it?" />
            ) : null}
            {failures.length === 0 ? (
              <p className={viewStyles.muted}>No rule failures.</p>
            ) : (
              LAYERS.map((layer) => {
                const group = failures
                  .filter((result) => result.layer === layer)
                  .sort((left, right) => (left.severity === right.severity ? 0 : left.severity === "fatal" ? -1 : 1));
                if (group.length === 0) return null;
                return (
                  <div key={layer}>
                    <h3 className={styles.sectionLabel}>{layer}</h3>
                    <ul className={viewStyles.list}>
                      {group.map((result) => (
                        <li key={`${result.layer}-${result.rule_id}-${result.message}`}>
                          <span className={viewStyles.when}>{result.severity}</span>
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
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHead}>History</div>
          <div className={viewStyles.body}>
            {history.length === 0 ? (
              <p className={viewStyles.muted}>No history recorded.</p>
            ) : (
              <ul className={viewStyles.list}>
                {history.map((event) => (
                  <li key={event.at}>
                    <span className={viewStyles.when}>{formatWhen(event.at)}</span>
                    <span>
                      {event.from_status ?? "new"} → {event.to_status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The invoice as the current reader sees the stored file. Older rows hold what an earlier reader found. */
async function currentSemantic(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  stored: Record<string, unknown> | null,
) {
  const content = await supabase.from("e_document_contents").select("xml").eq("e_document_id", id).maybeSingle();
  const xml = (content.data as { xml?: string } | null)?.xml;
  if (!xml) return stored;
  try {
    return parseUbl(xml) as Record<string, unknown>;
  } catch {
    return stored;
  }
}
