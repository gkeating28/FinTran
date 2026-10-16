"use client";

import Link from "next/link";
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
  setup = false,
}: {
  organisationName: string;
  setup?: boolean;
}) {
  const pathname = usePathname();
  const transactionCode = pathname.match(/^\/transactions\/([A-Za-z0-9]+)$/)?.[1];
  const formCode = pathname.match(/^\/forms\/([A-Za-z0-9]+)$/)?.[1];
  const pageLabel = setup ? "Set up" : transactionCode ? transactionCode.toUpperCase() : (PAGE_LABELS[pathname] ?? "Home");

  return (
    <div className={styles.bar}>
      <div className={styles.breadcrumb}>
        <span className={styles.crumbText}>
          Managing: <strong>{organisationName}</strong>
          <span className={styles.sep}>/</span>
          {formCode ? (
            <>
              <Link href="/forms" className={styles.crumbLink}>
                Forms
              </Link>
              <span className={styles.sep}>/</span>
              <strong>{formCode.toUpperCase()}</strong>
            </>
          ) : (
            <strong>{pageLabel}</strong>
          )}
        </span>
      </div>
      <div className={styles.actions}>
        {formCode ? (
          <Link href="/forms" className={styles.exitBtn}>
            Exit
          </Link>
        ) : (
          <form id="fintran-sign-out" action={signOut}>
            <button className={styles.exitBtn} type="submit" form="fintran-sign-out">
              Exit
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
