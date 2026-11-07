import { redirect } from "next/navigation";
import AccessGrid from "@/components/AccessGrid";
import styles from "@/components/OpsPage.module.css";
import { forOrganisation, getWorkspace, listOrganisationMembers } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Access" };

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = forOrganisation(listOrganisationMembers);
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, profile } = workspace;
  const [loaded, params] = await Promise.all([listed, searchParams]);
  const { members, error } = loaded ?? { members: [], error: null };

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Access</h1>
        <p className={styles.lede}>
          People listed here can open {current.organisationName}.
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
