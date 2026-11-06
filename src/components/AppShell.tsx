import type { ReactNode } from "react";
import AppSidebar from "@/components/AppSidebar";
import AppTitleBar from "@/components/AppTitleBar";
import AskQula from "@/components/AskQula";
import { FormChromeProvider } from "@/components/FormChrome";
import styles from "@/components/OpsPage.module.css";
import type { Membership, Profile } from "@/lib/types";

export default function AppShell({
  profile,
  memberships,
  current,
  children,
  aiEnabled = false,
}: {
  profile: Profile;
  memberships: Membership[];
  current: Membership | null;
  children: ReactNode;
  aiEnabled?: boolean;
}) {
  return (
    <div className={styles.shell}>
      <AppSidebar profile={profile} memberships={memberships} current={current} />
      <FormChromeProvider>
        <div className={styles.main}>
          <AppTitleBar
            organisationName={current?.organisationName ?? "Qula Tran"}
            setup={!current}
            toolbar={
              current ? (
                <AskQula organisationId={current.organisationId} organisationName={current.organisationName} aiEnabled={aiEnabled} />
              ) : null
            }
          />
          <div className={styles.page} data-app-page="">
            {children}
          </div>
        </div>
      </FormChromeProvider>
    </div>
  );
}
