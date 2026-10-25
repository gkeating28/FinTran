import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/components/OpsPage.module.css";
import { UploadEInvoice } from "@/components/UploadEInvoice";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "E-documents" };

const STATUSES = ["received", "generated", "valid", "invalid", "duplicate", "imported", "rejected"] as const;

type Row = {
  id: string;
  direction: string;
  status: string;
  document_number: string | null;
  issue_date: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  total_amount: number | null;
  header_id: string | null;
};

function dateParam(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export default async function EDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; error?: string; status?: string; party?: string; from?: string; to?: string; number?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  const query = await searchParams;
  const direction = query.direction === "outbound" ? "outbound" : "inbound";
  const status = STATUSES.includes(query.status as (typeof STATUSES)[number]) ? query.status! : "";
  const party = (query.party ?? "").trim().slice(0, 80);
  const from = dateParam(query.from);
  const to = dateParam(query.to);
  const number = (query.number ?? "").trim().slice(0, 60);
  const supabase = await createClient();
  let request = supabase
    .from("e_documents")
    .select("id, direction, status, document_number, issue_date, seller_name, buyer_name, total_amount, header_id")
    .eq("organisation_id", workspace.current.organisationId)
    .eq("direction", direction)
    .order("created_at", { ascending: false });
  if (status) request = request.eq("status", status);
  if (from) request = request.gte("issue_date", from);
  if (to) request = request.lte("issue_date", to);
  if (number) request = request.ilike("document_number", `%${number.replace(/[%_]/g, "")}%`);
  if (party) {
    const column = direction === "inbound" ? "seller_name" : "buyer_name";
    request = request.ilike(column, `%${party.replace(/[%_]/g, "")}%`);
  }
  const { data, error } = await request;
  const rows = (data ?? []) as Row[];
  const headerIds = rows.flatMap((row) => (row.header_id ? [row.header_id] : []));
  const links = new Map<string, string>();
  if (headerIds.length) {
    const headers = await supabase.from("transaction_headers").select("id, transaction_types(code)").in("id", headerIds);
    for (const header of headers.data ?? []) {
      const type = header.transaction_types as { code?: string } | { code?: string }[] | null;
      const code = Array.isArray(type) ? type[0]?.code : type?.code;
      if (code) links.set(header.id, `/transactions/${code}?open=${header.id}`);
    }
  }

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>E-documents</h1>
        <p className={styles.lede}>
          Received files are uploaded here. Sent files are generated when a sales invoice or credit note is posted.
        </p>
      </div>
      <div className={styles.readinessBar}>
        <Link className={direction === "inbound" ? styles.primary : styles.quiet} href="/e-documents?direction=inbound">
          Received
        </Link>
        <Link className={direction === "outbound" ? styles.primary : styles.quiet} href="/e-documents?direction=outbound">
          Sent
        </Link>
        {direction === "inbound" ? <UploadEInvoice /> : null}
      </div>
      <form className={styles.readinessBar} method="get">
        <input type="hidden" name="direction" value={direction} />
        <label className={styles.field}>
          Status
          <select name="status" defaultValue={status}>
            <option value="">Any</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Party
          <input name="party" defaultValue={party} maxLength={80} />
        </label>
        <label className={styles.field}>
          From
          <input name="from" type="date" defaultValue={from} />
        </label>
        <label className={styles.field}>
          To
          <input name="to" type="date" defaultValue={to} />
        </label>
        <label className={styles.field}>
          Number
          <input name="number" defaultValue={number} maxLength={60} />
        </label>
        <button className={styles.quiet} type="submit">
          Filter
        </button>
      </form>
      {query.error || error ? (
        <p className={styles.alert} role="alert">
          {query.error || error?.message}
        </p>
      ) : null}
      <div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Number</th>
              <th>Party</th>
              <th>Total</th>
              <th>Status</th>
              <th>Document</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>No e-documents yet.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.issue_date ?? "—"}</td>
                  <td>
                    <Link href={`/e-documents/${row.id}`}>{row.document_number ?? "Untitled"}</Link>
                  </td>
                  <td>{direction === "inbound" ? row.seller_name : row.buyer_name}</td>
                  <td>{row.total_amount ?? "—"}</td>
                  <td>{row.status}</td>
                  <td>{row.header_id && links.get(row.header_id) ? <Link href={links.get(row.header_id)!}>Open</Link> : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
