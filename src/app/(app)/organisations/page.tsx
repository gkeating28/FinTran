import { redirect } from "next/navigation";
import { CreateOrganisationForm } from "@/components/Forms";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { canManage, roleLabel } from "@/lib/types";

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
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          {current.tenantName}
          <span className={styles.panelMeta}>
            {organisations.length} organisation{organisations.length === 1 ? "" : "s"}
          </span>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Organisation</th>
              <th>Slug</th>
              <th>Your role</th>
            </tr>
          </thead>
          <tbody>
            {organisations.map((organisation) => (
              <tr key={organisation.organisationId}>
                <td>{organisation.organisationName}</td>
                <td>{organisation.organisationSlug}</td>
                <td>{roleLabel(organisation.role)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canManage(current.role) ? <CreateOrganisationForm tenantId={current.tenantId} /> : null}
      </div>
    </section>
  );
}
