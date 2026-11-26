import Link from "next/link";
import { redirect } from "next/navigation";
import { ReportIcon } from "@/components/icons";
import styles from "@/components/OpsPage.module.css";
import dashboardStyles from "@/components/Dashboard.module.css";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Reports" };

const REPORTS = [
  { href: "/reports/aged-debtors", label: "Aged debtors", meta: "What customers owe, by how late it is" },
  { href: "/reports/aged-creditors", label: "Aged creditors", meta: "What is owed to suppliers, by how late it is" },
];

// The trial balance reads the ledger, which is for owners and admins.
const MANAGER_REPORTS = [
  { href: "/reports/trial-balance", label: "Trial balance", meta: "Every account's balance, and whether the ledger agrees" },
];

export default async function ReportsPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Reports</h1>
        <p className={styles.lede}>Reports for {workspace.current.organisationName}.</p>
      </div>
      <div className={dashboardStyles.adminGrid}>
        {[...REPORTS, ...(canManage(workspace.current.role) ? MANAGER_REPORTS : [])].map((report) => (
          <Link key={report.href} prefetch href={report.href} className={dashboardStyles.adminTile}>
            <span className={dashboardStyles.adminTileIcon}>
              <ReportIcon size={22} />
            </span>
            <span className={dashboardStyles.adminTileLabel}>{report.label}</span>
            <span className={dashboardStyles.adminTileMeta}>{report.meta}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
