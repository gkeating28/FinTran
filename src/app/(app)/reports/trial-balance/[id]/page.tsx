import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { todayInZone } from "@/lib/dates";
import { formatMoney } from "@/lib/documents";
import { drCr, yearToDate } from "@/lib/ledger";
import { getAccountEnquiry } from "@/lib/ledger-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Account enquiry" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AccountEnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; dept?: string; cc?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  if (!canManage(workspace.current.role)) redirect("/");

  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const range = yearToDate(todayInZone());
  const from = DATE.test(query.from ?? "") ? (query.from as string) : range.from;
  const to = DATE.test(query.to ?? "") ? (query.to as string) : range.to;
  const departmentId = UUID.test(query.dept ?? "") ? (query.dept as string) : "";
  const costCentreId = UUID.test(query.cc ?? "") ? (query.cc as string) : "";

  const enquiry = await getAccountEnquiry(id, { from, to, departmentId, costCentreId });
  if (!enquiry.error && !enquiry.account) notFound();
  const closing = enquiry.lines.length > 0 ? enquiry.lines[enquiry.lines.length - 1].balance : enquiry.opening;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>
          {enquiry.account ? `${enquiry.account.code} ${enquiry.account.description}` : "Account enquiry"}
        </h1>
        <p className={styles.lede}>
          {from} to {to}.
        </p>
      </div>
      {enquiry.error ? (
        <p className={styles.alert} role="alert">
          {enquiry.error}
        </p>
      ) : null}
      <div className={styles.tableScroll}>
        <table className={styles.table} aria-label="Account enquiry">
          <thead>
            <tr>
              <th>No.</th>
              <th>Date</th>
              <th>Reference</th>
              <th>Description</th>
              <th className={styles.numeric}>Debit</th>
              <th className={styles.numeric}>Credit</th>
              <th className={styles.numeric}>Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6}>Opening balance</td>
              <td className={`${styles.mono} ${styles.numeric}`}>{drCr(Math.round(enquiry.opening * 100))}</td>
            </tr>
            {enquiry.lines.map((line) => (
              <tr key={line.id}>
                <td className={styles.mono}>
                  <Link href={`/reports/general-ledger?open=${line.entryId}`}>{line.number}</Link>
                </td>
                <td className={styles.mono}>{line.date}</td>
                <td className={styles.mono}>{line.sourceRef}</td>
                <td>{line.description}</td>
                <td className={`${styles.mono} ${styles.numeric}`}>{line.debit ? formatMoney(line.debit) : ""}</td>
                <td className={`${styles.mono} ${styles.numeric}`}>{line.credit ? formatMoney(line.credit) : ""}</td>
                <td className={`${styles.mono} ${styles.numeric}`}>{drCr(Math.round(line.balance * 100))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Closing balance</td>
              <td className={`${styles.mono} ${styles.numeric}`} data-testid="enquiry-closing">
                {drCr(Math.round(closing * 100))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
