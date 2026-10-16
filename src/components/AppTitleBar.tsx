"use client";

import { usePathname } from "next/navigation";
import { signOut } from "@/lib/actions";
import styles from "./AppTitleBar.module.css";

const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/transactions": "Transactions",
  "/customers": "Customers",
  "/suppliers": "Suppliers",
  "/admin": "Admin",
  "/gl-codes": "GL codes",
  "/departments": "Departments",
  "/cost-centres": "Cost centres",
  "/vat-rates": "VAT rates",
  "/currencies": "Currencies",
  "/transaction-types": "Transaction types",
  "/products": "Products",
  "/organisations": "Organisations",
  "/access": "Access",
  "/forms": "Forms",
};

export default function AppTitleBar({
  organisationName,
  logoUrl = null,
  setup = false,
}: {
  organisationName: string;
  logoUrl?: string | null;
  setup?: boolean;
}) {
  const pathname = usePathname();
  const typeCode = pathname.match(/^\/(?:transactions|forms)\/([A-Za-z0-9]+)$/)?.[1];
  const pageLabel = setup ? "Set up" : typeCode ? typeCode.toUpperCase() : (PAGE_LABELS[pathname] ?? "Home");

  return (
    <div className={styles.bar}>
      <div className={styles.breadcrumb}>
        {logoUrl ? <img src={logoUrl} alt="" className={styles.orgLogo} /> : null}
        <span className={styles.crumbText}>
          Managing: <strong>{organisationName}</strong>
          <span className={styles.sep}>/</span>
          <strong>{pageLabel}</strong>
        </span>
      </div>
      <div className={styles.actions}>
        <form action={signOut}>
          <button className={styles.exitBtn} type="submit">
            Exit
          </button>
        </form>
      </div>
    </div>
  );
}
