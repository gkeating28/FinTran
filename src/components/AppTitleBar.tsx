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
  "/organisations": "Organisations",
  "/access": "Access",
};

export default function AppTitleBar({
  organisationName,
  setup = false,
}: {
  organisationName: string;
  setup?: boolean;
}) {
  const pathname = usePathname();
  const pageLabel = setup
    ? "Set up"
    : (PAGE_LABELS[pathname] ?? "Home");

  return (
    <div className={styles.bar}>
      <div className={styles.breadcrumb}>
        Managing: <strong>{organisationName}</strong>
        <span className={styles.sep}>/</span>
        <strong>{pageLabel}</strong>
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
