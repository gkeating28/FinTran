import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CostCentreIcon,
  CurrencyIcon,
  DepartmentIcon,
  DocumentIcon,
  HashIcon,
  HistoryIcon,
  OrganisationIcon,
  PeopleIcon,
  ProductIcon,
  VatIcon,
} from "@/components/icons";
import styles from "@/components/OpsPage.module.css";
import dashboardStyles from "@/components/Dashboard.module.css";
import { adminCounts } from "@/lib/admin";
import { formatInteger } from "@/lib/numbers";
import { forOrganisation, getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Admin" };

const TILES = [
  { href: "/gl-codes", label: "GL codes", count: "glCodes", icon: <HashIcon size={22} /> },
  { href: "/departments", label: "Departments", count: "departments", icon: <DepartmentIcon size={22} /> },
  { href: "/cost-centres", label: "Cost centres", count: "costCentres", icon: <CostCentreIcon size={22} /> },
  { href: "/vat-rates", label: "VAT rates", count: "vatRates", icon: <VatIcon size={22} /> },
  { href: "/currencies", label: "Currencies", count: "currencies", icon: <CurrencyIcon size={22} /> },
  { href: "/transaction-types", label: "Transaction types", count: "transactionTypes", icon: <DocumentIcon size={22} /> },
  { href: "/forms", label: "Forms", count: "forms", icon: <DocumentIcon size={22} /> },
  { href: "/products", label: "Products", count: "products", icon: <ProductIcon size={22} /> },
  { href: "/organisations", label: "Organisations", count: "organisations", icon: <OrganisationIcon size={22} /> },
  { href: "/access", label: "Access", count: "access", icon: <PeopleIcon size={22} /> },
  { href: "/history", label: "Change history", count: "history", icon: <HistoryIcon size={22} /> },
] as const;

export default async function AdminPage() {
  const counted = forOrganisation(adminCounts);
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, memberships } = workspace;
  const totals = await counted;
  if (!totals) redirect("/");
  const organisations = memberships.filter((membership) => membership.tenantId === current.tenantId).length;
  const counts = { ...totals, organisations };

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Admin</h1>
        <p className={styles.lede}>
          Setup for {current.organisationName}.
        </p>
      </div>
      {totals.error ? (
        <p className={styles.alert} role="alert">
          {totals.error}
        </p>
      ) : null}
      <div className={dashboardStyles.adminGrid}>
        {TILES.filter((tile) => tile.href !== "/history" || canManage(current.role)).map((tile) => {
          const count = counts[tile.count];
          return (
            <Link key={tile.href} href={tile.href} className={dashboardStyles.adminTile}>
              <span className={dashboardStyles.adminTileIcon}>{tile.icon}</span>
              <span className={dashboardStyles.adminTileLabel}>{tile.label}</span>
              <span className={dashboardStyles.adminTileCount}>{count === null ? "—" : formatInteger(count)}</span>
              <span className={dashboardStyles.adminTileMeta}>{count === 1 ? "record" : count === null ? "Unavailable" : "records"}</span>
            </Link>
          );
        })}
      </div>
      {canManage(current.role) ? (
        <div className={dashboardStyles.adminGrid}>
          <Link href="/ask-qula" className={dashboardStyles.adminTile}>
            <span className={dashboardStyles.adminTileLabel}>Ask Qula</span>
            <span className={dashboardStyles.adminTileMeta}>AI settings</span>
          </Link>
          <Link href="/access-point" className={dashboardStyles.adminTile}>
            <span className={dashboardStyles.adminTileLabel}>Access Point</span>
            <span className={dashboardStyles.adminTileMeta}>Peppol settings</span>
          </Link>
        </div>
      ) : null}
    </section>
  );
}
