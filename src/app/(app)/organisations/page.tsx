import { redirect } from "next/navigation";
import OrganisationGrid, { type SettingsTabId } from "@/components/OrganisationGrid";
import AccessPointSettings from "@/components/org-settings/AccessPointSettings";
import AccountingSettings from "@/components/org-settings/AccountingSettings";
import AskQulaSettings from "@/components/org-settings/AskQulaSettings";
import styles from "@/components/OpsPage.module.css";
import { emptyOrganisationProfile, listDefaultsByOrganisation, listIsoCurrencies } from "@/lib/currency-data";
import { getWorkspace } from "@/lib/data";
import { listCodeLists } from "@/lib/reference-data";
import { canManage } from "@/lib/types";

const SETTINGS_TABS: SettingsTabId[] = ["ask-qula", "access-point", "accounting"];

export const metadata = { title: "Organisations" };

export default async function OrganisationsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; tab?: string; error?: string; message?: string }>;
}) {
  const codeLists = listCodeLists();
  const isoCurrencies = listIsoCurrencies();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const params = await searchParams;
  const { current, memberships } = workspace;
  const organisations = memberships.filter((membership) => membership.tenantId === current.tenantId);
  const [{ byOrganisation, error }, codes, currencies] = await Promise.all([
    listDefaultsByOrganisation(organisations.map((organisation) => organisation.organisationId)),
    codeLists,
    isoCurrencies,
  ]);

  // The settings of an organisation are tabs of its edit screen. They are shown only to its owners and admins, and only for
  // the one organisation the address names.
  const target = params.edit ? organisations.find((organisation) => organisation.organisationId === params.edit) : undefined;
  const tab = target && canManage(target.role) ? SETTINGS_TABS.find((id) => id === params.tab) ?? null : null;
  const failed = Boolean(params.error);
  const status = params.error ?? params.message ?? null;
  const panel =
    target && tab === "ask-qula" ? (
      <AskQulaSettings organisationId={target.organisationId} status={status} failed={failed} />
    ) : target && tab === "access-point" ? (
      <AccessPointSettings organisationId={target.organisationId} organisationName={target.organisationName} status={status} failed={failed} />
    ) : target && tab === "accounting" ? (
      <AccountingSettings organisationId={target.organisationId} organisationName={target.organisationName} status={status} failed={failed} />
    ) : null;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Organisations</h1>
        <p className={styles.lede}>
          These are the organisations in {current.tenantName} that you can open.
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
        openId={target?.organisationId ?? null}
        tab={tab}
        panel={panel}
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
