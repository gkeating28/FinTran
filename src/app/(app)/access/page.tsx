import { redirect } from "next/navigation";
import AccessGrid from "@/components/AccessGrid";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace, listOrganisationMembers } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Access" };

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, profile } = workspace;
  const [{ members, error }, params] = await Promise.all([
    listOrganisationMembers(current.organisationId),
    searchParams,
  ]);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Access</h1>
        <p className={styles.lede}>
          People listed here can open {current.organisationName}. Someone must already have a
          FinTran account before you can grant them access.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {params.error ? (
        <p className={styles.alert} role="alert">
          {params.error}
        </p>
      ) : null}
      <AccessGrid
        organisationId={current.organisationId}
        callerRole={current.role}
        canManage={canManage(current.role)}
        rows={members.map((member) => ({
          id: member.userId,
          name: member.displayName,
          email: member.email,
          role: member.role,
          isYou: member.email === profile.email,
        }))}
      />
    </section>
  );
}
