import { redirect } from "next/navigation";
import OrganisationGrid from "@/components/OrganisationGrid";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Organisations" };

export default async function OrganisationsPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, memberships } = workspace;
  const organisations = memberships.filter((membership) => membership.tenantId === current.tenantId);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Organisations</h1>
        <p className={styles.lede}>
          These are the organisations in {current.tenantName} that you can open. Access is granted
          per organisation, not to every organisation in the tenant.
        </p>
      </div>
      <OrganisationGrid
        tenantId={current.tenantId}
        canAdd={canManage(current.role)}
        rows={organisations.map((organisation) => ({
          id: organisation.organisationId,
          name: organisation.organisationName,
          slug: organisation.organisationSlug,
          role: organisation.role,
        }))}
      />
    </section>
  );
}
