"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormChrome, usePageLabel } from "@/components/FormChrome";
import { MenuIcon } from "@/components/icons";
import { useNav } from "@/components/NavState";
import { useNavHistory } from "@/components/useNavHistory";
import { previousPage } from "@/lib/previous-page";
import styles from "./AppTitleBar.module.css";

const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/transactions": "Transactions",
  "/payment-runs": "Payment runs",
  "/reports": "Reports",
  "/reports/aged-debtors": "Aged debtors",
  "/reports/aged-creditors": "Aged creditors",
  "/customers": "Customers",
  "/suppliers": "Suppliers",
  "/admin": "Admin",
  "/gl-codes": "GL codes",
  "/departments": "Departments",
  "/cost-centres": "Cost centres",
  "/vat-rates": "VAT rates",
  "/currencies": "Currencies",
  "/bank-accounts": "Bank accounts",
  "/approval-rules": "Approval rules",
  "/transaction-types": "Transaction types",
  "/products": "Products",
  "/organisations": "Organisations",
  "/access": "Access",
  "/forms": "Forms",
  "/history": "Change history",
  "/e-documents": "E-documents",
  "/journal-export": "Journal export",
  "/ledger": "Ledger",
  "/ledger/trial-balance": "Trial balance",
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
  const nav = useNav();
  const history = useNavHistory();
  const formTitle = useFormChrome();
  const registeredLabel = usePageLabel();
  const transactionCode = pathname.match(/^\/transactions\/([A-Za-z0-9]+)$/)?.[1];
  const formCode = pathname.match(/^\/forms\/([A-Za-z0-9]+)$/)?.[1];
  const pageLabel = setup
    ? "Set up"
    : transactionCode
      ? transactionCode.toUpperCase()
      : pathname.startsWith("/e-documents/")
        ? "E-document"
        : pathname.startsWith("/ledger/accounts/")
          ? "Account enquiry"
          : (PAGE_LABELS[pathname] ?? "Home");
  const back = previousPage(pathname);

  // A document that came with the address (a link from a report, say) is not something the person opened here, so Back goes
  // straight to where the link was. Once it has been closed, or when the person opened a form themselves, Back closes the form.
  const open = Boolean(formTitle);
  const wasOpen = useRef(false);
  const { closedDocument } = history;
  useEffect(() => {
    if (wasOpen.current && !open) closedDocument();
    wasOpen.current = open;
  }, [open, closedDocument]);

  function exit() {
    if (formTitle && !history.arrivedOpen) {
      formTitle.close();
      return;
    }
    history.goBack(back);
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
                <Link href="/forms" prefetch className={styles.crumbLink}>
                  Forms
                </Link>
                <span className={styles.sep}>/</span>
                <strong>{formCode.toUpperCase()}</strong>
              </>
            ) : (
              <>
                <strong>{transactionCode && registeredLabel ? registeredLabel : pageLabel}</strong>
                {transactionCode && registeredLabel ? <> ({transactionCode.toUpperCase()})</> : null}
              </>
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
        {formTitle || back || history.target ? (
          <button className={styles.exitBtn} type="button" onClick={exit}>
            Back
          </button>
        ) : null}
        {toolbar}
      </div>
    </div>
  );
}
