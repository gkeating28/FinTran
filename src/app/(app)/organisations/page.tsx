import { redirect } from "next/navigation";
import OrganisationGrid from "@/components/OrganisationGrid";
import styles from "@/components/OpsPage.module.css";
import { emptyOrganisationProfile, listDefaultsByOrganisation } from "@/lib/currency-data";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Organisations" };

export default async function OrganisationsPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, memberships } = workspace;
  const organisations = memberships.filter((membership) => membership.tenantId === current.tenantId);
  const { byOrganisation, error } = await listDefaultsByOrganisation(
    organisations.map((organisation) => organisation.organisationId),
  );

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Organisations</h1>
        <p className={styles.lede}>
          These are the organisations in {current.tenantName} that you can open. Edit an organisation
          to set its logo, home currency, address, contact, registration, and banking details.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <OrganisationGrid
        tenantId={current.tenantId}
        canAdd={canManage(current.role)}
        rows={organisations.map((organisation) => {
          const defaults = byOrganisation[organisation.organisationId];
          return {
            id: organisation.organisationId,
            name: organisation.organisationName,
            slug: organisation.organisationSlug,
            role: organisation.role,
            homeCurrencyId: defaults?.homeCurrencyId ?? null,
            currencies: defaults?.currencies ?? [],
            profile: defaults?.profile ?? emptyOrganisationProfile,
            logoUrl: defaults?.logoUrl ?? null,
          };
        })}
      />
    </section>
  );
}
