import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

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
  let aiEnabled = false;
  if (current) {
    const supabase = await createClient();
    const settings = await supabase.from("ai_settings").select("enabled").eq("organisation_id", current.organisationId).maybeSingle();
    aiEnabled = Boolean((settings.data as { enabled?: boolean } | null)?.enabled);
  }

  return (
    <AppShell profile={workspace.profile} memberships={memberships} current={current} aiEnabled={aiEnabled}>
      {children}
    </AppShell>
  );
}
