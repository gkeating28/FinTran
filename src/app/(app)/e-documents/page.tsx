import { redirect } from "next/navigation";
import { EDocumentList, type EDocumentListRow } from "@/components/EDocumentList";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "E-documents" };

type Row = {
  id: string;
  direction: string;
  status: string;
  document_number: string | null;
  issue_date: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  currency_code: string | null;
  total_amount: number | null;
  header_id: string | null;
};

export default async function EDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; error?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  const query = await searchParams;
  const direction = query.direction === "outbound" ? "outbound" : "inbound";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("e_documents")
    .select("id, direction, status, document_number, issue_date, seller_name, buyer_name, currency_code, total_amount, header_id")
    .eq("organisation_id", workspace.current.organisationId)
    .order("created_at", { ascending: false });

  const source = (data ?? []) as Row[];
  const headerIds = source.flatMap((row) => (row.header_id ? [row.header_id] : []));
  const links = new Map<string, string>();
  if (headerIds.length) {
    const headers = await supabase.from("transaction_headers").select("id, transaction_types(code)").in("id", headerIds);
    for (const header of headers.data ?? []) {
      const type = header.transaction_types as { code?: string } | { code?: string }[] | null;
      const code = Array.isArray(type) ? type[0]?.code : type?.code;
      if (code) links.set(header.id, `/transactions/${code}?open=${header.id}`);
    }
  }
  const rows: EDocumentListRow[] = source.map((row) => ({
    id: row.id,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    status: row.status,
    documentNumber: row.document_number ?? "Untitled",
    issueDate: row.issue_date ?? "",
    party: row.direction === "inbound" ? (row.seller_name ?? "") : (row.buyer_name ?? ""),
    total: row.total_amount == null ? "" : `${row.total_amount}${row.currency_code ? ` ${row.currency_code}` : ""}`,
    documentHref: row.header_id ? (links.get(row.header_id) ?? null) : null,
  }));

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>E-documents</h1>
        <p className={styles.lede}>
          Received files are uploaded here. Sent files are generated when a sales invoice or credit note is posted.
        </p>
      </div>
      {query.error || error ? (
        <p className={styles.alert} role="alert">
          {query.error || error?.message}
        </p>
      ) : null}
      <EDocumentList key={direction} rows={rows} initialDirection={direction} />
    </section>
  );
}
