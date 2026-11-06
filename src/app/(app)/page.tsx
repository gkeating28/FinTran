import { redirect } from "next/navigation";
import { CreateTenantForm } from "@/components/Forms";
import HomeOverview from "@/components/HomeOverview";
import styles from "@/components/OpsPage.module.css";
import { listIsoCurrencies } from "@/lib/currency-data";
import { getWorkspace, listOrganisationMembers } from "@/lib/data";
import { getHomeOverview } from "@/lib/home-data";
import { roleLabel } from "@/lib/types";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status === "error") return null;

  if (workspace.status === "needs-tenant") {
    const currencies = await listIsoCurrencies();
    return (
      <section className={styles.stack}>
        <div>
          <h1 className={styles.heading}>Create a tenant</h1>
          <p className={styles.lede}>
            A tenant is the account that owns one or more organisations. You become the owner of
            the first organisation, and you can grant other people access to it afterwards.
          </p>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span>New tenant</span>
            <CreateTenantForm currencies={currencies} />
          </div>
          <p className={styles.empty}>
            The tenant and its first organisation are created together. You can add more organisations
            after that.
          </p>
        </div>
      </section>
    );
  }

  const { current, memberships } = workspace;
  const inTenant = memberships.filter((membership) => membership.tenantId === current.tenantId);
  const [{ members, error }, overview] = await Promise.all([
    listOrganisationMembers(current.organisationId),
    getHomeOverview(current.organisationId),
  ]);

  return (
    <HomeOverview
      organisationName={current.organisationName}
      tenantName={current.tenantName}
      role={roleLabel(current.role)}
      organisationCount={inTenant.length}
      memberCount={error ? null : members.length}
      error={error}
      overview={overview}
    />
  );
}
