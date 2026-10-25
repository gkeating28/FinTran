import { redirect } from "next/navigation";
import OrganisationGrid from "@/components/OrganisationGrid";
import styles from "@/components/OpsPage.module.css";
import { emptyOrganisationProfile, listDefaultsByOrganisation, listIsoCurrencies } from "@/lib/currency-data";
import { getWorkspace } from "@/lib/data";
import { listCodeLists } from "@/lib/reference-data";

export const metadata = { title: "Organisations" };

export default async function OrganisationsPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, memberships } = workspace;
  const organisations = memberships.filter((membership) => membership.tenantId === current.tenantId);
  const [{ byOrganisation, error }, codes, currencies] = await Promise.all([
    listDefaultsByOrganisation(organisations.map((organisation) => organisation.organisationId)),
    listCodeLists(),
    listIsoCurrencies(),
  ]);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Organisations</h1>
        <p className={styles.lede}>
          These are the organisations in {current.tenantName} that you can open. Edit an organisation
          to set its logo, home currency, address, contact, registration, banking details, and the
          Purchases types used when a received e-invoice is imported.
        </p>
      </div>
      {error || codes.error ? (
        <p className={styles.alert} role="alert">
          {error || codes.error}
        </p>
      ) : null}
      <OrganisationGrid
        tenantId={current.tenantId}
        canAdd={organisations.some((organisation) => organisation.role === "owner")}
        countries={codes.countries}
        schemes={codes.schemes}
        currencies={currencies}
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
            hasDocuments: defaults?.hasDocuments ?? false,
            inboundInvoiceTypeId: defaults?.inboundInvoiceTypeId ?? null,
            inboundCreditNoteTypeId: defaults?.inboundCreditNoteTypeId ?? null,
            purchaseTypes: defaults?.purchaseTypes ?? [],
          };
        })}
      />
    </section>
  );
}
