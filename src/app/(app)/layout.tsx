import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = await getWorkspace();

  if (workspace.status === "signed-out") redirect("/login");

  if (workspace.status === "error") {
    return (
      <div className={styles.shell}>
        <div className={styles.page}>
          <p className={styles.alert} role="alert">
            {workspace.message}
          </p>
        </div>
      </div>
    );
  }

  const current = workspace.status === "ready" ? workspace.current : null;
  const memberships = workspace.status === "ready" ? workspace.memberships : [];

  return (
    <AppShell profile={workspace.profile} memberships={memberships} current={current}>
      {children}
    </AppShell>
  );
}
