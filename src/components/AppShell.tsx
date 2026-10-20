import type { ReactNode } from "react";
import AppSidebar from "@/components/AppSidebar";
import AppTitleBar from "@/components/AppTitleBar";
import styles from "@/components/OpsPage.module.css";
import type { Membership, Profile } from "@/lib/types";

export default function AppShell({
  profile,
  memberships,
  current,
  children,
}: {
  profile: Profile;
  memberships: Membership[];
  current: Membership | null;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <AppSidebar profile={profile} memberships={memberships} current={current} />
      <div className={styles.main}>
        <AppTitleBar
          organisationName={current?.organisationName ?? "FinTran"}
          setup={!current}
        />
        <div className={styles.page} data-app-page="">
          {children}
        </div>
      </div>
    </div>
  );
}
