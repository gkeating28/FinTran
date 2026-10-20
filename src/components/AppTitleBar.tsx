"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormChrome } from "@/components/FormChrome";
import { previousPage } from "@/lib/previous-page";
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
  "/history": "Change history",
};

export default function AppTitleBar({
  organisationName,
  setup = false,
}: {
  organisationName: string;
  setup?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const formTitle = useFormChrome();
  const transactionCode = pathname.match(/^\/transactions\/([A-Za-z0-9]+)$/)?.[1];
  const formCode = pathname.match(/^\/forms\/([A-Za-z0-9]+)$/)?.[1];
  const pageLabel = setup ? "Set up" : transactionCode ? transactionCode.toUpperCase() : (PAGE_LABELS[pathname] ?? "Home");
  const back = previousPage(pathname);

  function exit() {
    if (formTitle) {
      formTitle.close();
      return;
    }
    if (back) router.push(back);
  }

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
        {formTitle ? (
          <>
            <span className={styles.sep}>/</span>
            <strong id={formTitle.titleId} className={styles.formTitle}>
              {formTitle.title}
            </strong>
          </>
        ) : null}
      </div>
      <div className={styles.actions}>
        {formTitle || back ? (
          <button className={styles.exitBtn} type="button" onClick={exit}>
            Exit
          </button>
        ) : null}
      </div>
    </div>
  );
}
