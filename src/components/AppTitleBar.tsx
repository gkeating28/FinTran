"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormChrome } from "@/components/FormChrome";
import { MenuIcon } from "@/components/icons";
import { useNav } from "@/components/NavState";
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
  "/e-documents": "E-documents",
  "/ask-qula": "Ask Qula",
  "/access-point": "Access Point",
};

export default function AppTitleBar({
  organisationName,
  setup = false,
  toolbar,
}: {
  organisationName: string;
  setup?: boolean;
  toolbar?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const nav = useNav();
  const formTitle = useFormChrome();
  const transactionCode = pathname.match(/^\/transactions\/([A-Za-z0-9]+)$/)?.[1];
  const formCode = pathname.match(/^\/forms\/([A-Za-z0-9]+)$/)?.[1];
  const pageLabel = setup
    ? "Set up"
    : transactionCode
      ? transactionCode.toUpperCase()
      : pathname.startsWith("/e-documents/")
        ? "E-document"
        : (PAGE_LABELS[pathname] ?? "Home");
  const back = previousPage(pathname);

  function exit() {
    if (formTitle) {
      formTitle.close();
      return;
    }
    if (back) router.push(back);
  }

  return (
    <div className={styles.bar} data-title-bar="">
      <div className={styles.lead}>
        <button
          className={styles.menuBtn}
          type="button"
          aria-label="Open menu"
          aria-controls="app-sidebar"
          aria-expanded={nav.open}
          onClick={nav.toggle}
        >
          <MenuIcon />
        </button>
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
      </div>
      <div className={styles.actions}>
        {formTitle || back ? (
          <button className={styles.exitBtn} type="button" onClick={exit}>
            Back
          </button>
        ) : null}
        {toolbar}
      </div>
    </div>
  );
}
