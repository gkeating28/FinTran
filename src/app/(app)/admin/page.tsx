import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import styles from "@/components/OpsPage.module.css";
import { adminCounts } from "@/lib/admin";
import { formatInteger } from "@/lib/numbers";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Admin" };

const TILES = [
  { href: "/gl-codes", label: "GL codes", count: "glCodes", icon: <HashIcon /> },
  { href: "/departments", label: "Departments", count: "departments", icon: <DeptIcon /> },
  { href: "/cost-centres", label: "Cost centres", count: "costCentres", icon: <CentreIcon /> },
  { href: "/vat-rates", label: "VAT rates", count: "vatRates", icon: <VatIcon /> },
  { href: "/currencies", label: "Currencies", count: "currencies", icon: <CurrencyIcon /> },
  { href: "/transaction-types", label: "Transaction types", count: "transactionTypes", icon: <TypeIcon /> },
  { href: "/products", label: "Products", count: "products", icon: <ProductIcon /> },
  { href: "/organisations", label: "Organisations", count: "organisations", icon: <OrgIcon /> },
  { href: "/access", label: "Access", count: "access", icon: <PeopleIcon /> },
] as const;

export default async function AdminPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, memberships } = workspace;
  const totals = await adminCounts(current.organisationId);
  const organisations = memberships.filter((membership) => membership.tenantId === current.tenantId).length;
  const counts = { ...totals, organisations };

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Admin</h1>
        <p className={styles.lede}>
          Setup for {current.organisationName}. Each tile opens that list.
        </p>
      </div>
      {totals.error ? (
        <p className={styles.alert} role="alert">
          {totals.error}
        </p>
      ) : null}
      <div className={styles.adminGrid}>
        {TILES.map((tile) => {
          const count = counts[tile.count];
          return (
            <Link key={tile.href} href={tile.href} className={styles.adminTile}>
              <span className={styles.adminTileIcon}>{tile.icon}</span>
              <span className={styles.adminTileLabel}>{tile.label}</span>
              <span className={styles.adminTileCount}>{count === null ? "—" : formatInteger(count)}</span>
              <span className={styles.adminTileMeta}>{count === 1 ? "record" : count === null ? "Unavailable" : "records"}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function TileIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function HashIcon() {
  return (
    <TileIcon>
      <path d="M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16" />
    </TileIcon>
  );
}

function DeptIcon() {
  return (
    <TileIcon>
      <path d="M4 20V7l8-3 8 3v13" />
      <path d="M9 20v-6h6v6" />
    </TileIcon>
  );
}

function CentreIcon() {
  return (
    <TileIcon>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </TileIcon>
  );
}

function VatIcon() {
  return (
    <TileIcon>
      <path d="M19 5 5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </TileIcon>
  );
}

function CurrencyIcon() {
  return (
    <TileIcon>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5v9" />
      <path d="M9.5 9.2c.4-.8 1.3-1.2 2.5-1.2 1.6 0 2.6.8 2.6 2s-1 1.9-2.6 1.9-2.6.8-2.6 2 1 2 2.6 2c1.2 0 2.1-.4 2.5-1.2" />
    </TileIcon>
  );
}

function TypeIcon() {
  return (
    <TileIcon>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v6h6" />
      <path d="M9 13h6M9 17h4" />
    </TileIcon>
  );
}

function ProductIcon() {
  return (
    <TileIcon>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
      <path d="M3.3 8 12 13l8.7-5" />
      <path d="M12 13v8" />
    </TileIcon>
  );
}

function OrgIcon() {
  return (
    <TileIcon>
      <path d="M4 20V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v14" />
      <path d="M14 10h5a1 1 0 0 1 1 1v9" />
      <path d="M8 9h2M8 13h2M8 17h2M17 14h1M17 17h1" />
    </TileIcon>
  );
}

function PeopleIcon() {
  return (
    <TileIcon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13a3 3 0 0 1 0 5.75" />
    </TileIcon>
  );
}
