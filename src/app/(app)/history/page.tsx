import { redirect } from "next/navigation";
import HistoryGrid from "@/components/HistoryGrid";
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
        <p className={styles.lede}>Owners and admins can read the change history for {workspace.current.organisationName}.</p>
      </section>
    );
  }

  const { rows, error } = await listAuditLog(workspace.current.organisationId);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Change history</h1>
        <p className={styles.lede}>
          Recent changes in {workspace.current.organisationName}.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <HistoryGrid rows={rows} />
    </section>
  );
}
