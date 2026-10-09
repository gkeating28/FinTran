import { redirect } from "next/navigation";
import { CreateTenantForm } from "@/components/Forms";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace, listOrganisationMembers } from "@/lib/data";
import { roleLabel } from "@/lib/types";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status === "error") return null;

  if (workspace.status === "needs-tenant") {
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
            <CreateTenantForm />
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
  const { members, error } = await listOrganisationMembers(current.organisationId);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{current.organisationName}</h1>
        <p className={styles.lede}>
          Organisations belong to a tenant. People are granted access to individual organisations
          inside that tenant. Transaction definitions will be specific to each organisation.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.cards}>
        <article className={styles.card}>
          <div className={styles.cardLabel}>Tenant</div>
          <div className={styles.cardValue}>{current.tenantName}</div>
        </article>
        <article className={styles.card}>
          <div className={styles.cardLabel}>Your role</div>
          <div className={styles.cardValue}>{roleLabel(current.role)}</div>
          <div className={styles.cardMeta}>{current.organisationSlug}</div>
        </article>
        <article className={styles.card}>
          <div className={styles.cardLabel}>Organisations you can open</div>
          <div className={styles.cardValue}>{inTenant.length}</div>
          <div className={styles.cardMeta}>in {current.tenantName}</div>
        </article>
        <article className={styles.card}>
          <div className={styles.cardLabel}>People with access</div>
          <div className={styles.cardValue}>{error ? "—" : members.length}</div>
        </article>
      </div>
    </section>
  );
}
