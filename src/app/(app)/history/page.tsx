import { redirect } from "next/navigation";
import DataGrid from "@/components/DataGrid";
import styles from "@/components/OpsPage.module.css";
import { listAuditLog } from "@/lib/audit-data";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Change history" };

export default async function HistoryPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  if (!canManage(workspace.current.role)) {
    return (
      <section className={styles.stack}>
        <h1 className={styles.heading}>Change history</h1>
        <p className={styles.lede}>Owners and admins can read the change history for this organisation.</p>
      </section>
    );
  }

  const { rows, error } = await listAuditLog(workspace.current.organisationId);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Change history</h1>
        <p className={styles.lede}>
          Recent changes in {workspace.current.organisationName}. Amount-only recalculations on documents are not
          listed.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <DataGrid
        rows={rows}
        searchPlaceholder="Search changes"
        searchText={(row) => `${row.tableName} ${row.action} ${row.who} ${row.summary}`}
        emptyLabel="No changes have been recorded for this organisation yet."
        minWidth="980px"
        columns={[
          {
            key: "when",
            label: "When",
            sortValue: (row) => row.when,
            render: (row) => formatWhen(row.when),
          },
          {
            key: "who",
            label: "Who",
            sortValue: (row) => row.who,
            render: (row) => row.who,
          },
          {
            key: "table",
            label: "Record",
            sortValue: (row) => row.tableName,
            render: (row) => row.tableName,
          },
          {
            key: "action",
            label: "Action",
            sortValue: (row) => row.action,
            render: (row) => row.action,
          },
          {
            key: "summary",
            label: "Detail",
            sortValue: (row) => row.summary,
            render: (row) => row.summary,
          },
        ]}
      />
    </section>
  );
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
