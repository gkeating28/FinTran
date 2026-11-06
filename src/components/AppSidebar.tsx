"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminIcon, CustomerIcon, DocumentIcon, EDocumentIcon, HomeIcon, SupplierIcon } from "@/components/icons";
import { useNav } from "@/components/NavState";
import { selectOrganisation, signOut } from "@/lib/actions";
import type { Membership, Profile } from "@/lib/types";
import styles from "./AppSidebar.module.css";

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  section: "workspace" | "admin";
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: <HomeIcon />, section: "workspace" },
  { href: "/transactions", label: "Transactions", icon: <DocumentIcon />, section: "workspace" },
  { href: "/customers", label: "Customers", icon: <CustomerIcon />, section: "workspace" },
  { href: "/suppliers", label: "Suppliers", icon: <SupplierIcon />, section: "workspace" },
  { href: "/e-documents", label: "E-documents", icon: <EDocumentIcon />, section: "workspace" },
  { href: "/admin", label: "Admin", icon: <AdminIcon />, section: "admin" },
];







export default function AppSidebar({
  profile,
  memberships,
  current,
}: {
  profile: Profile;
  memberships: Membership[];
  current: Membership | null;
}) {
  const pathname = usePathname();
  const nav = useNav();
  const multipleTenants = new Set(memberships.map((membership) => membership.tenantId)).size > 1;

  return (
    <>
      {nav.open ? <button className={styles.scrim} type="button" aria-label="Close menu" onClick={nav.close} /> : null}
      <aside id="app-sidebar" className={nav.open ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar}>
        <div className={styles.brand}>
          <Image src="/qula-logo.png" alt="" width={48} height={48} priority className={styles.brandMark} />
          <div>
            <div className={styles.brandName}>Qula Tran</div>
            <div className={styles.brandSub}>TRANSACTIONS</div>
          </div>
        </div>

        <div className={styles.orgBlock}>
          <label className={styles.orgLabel} htmlFor="organisation">
            ORGANISATION
          </label>
          {memberships.length === 0 ? (
            <div className={styles.orgEmpty}>No organisation yet</div>
          ) : (
            <form action={selectOrganisation}>
              <select
                id="organisation"
                name="organisationId"
                className={styles.orgSelect}
                key={current?.organisationId}
                defaultValue={current?.organisationId}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                {memberships.map((membership) => (
                  <option key={membership.organisationId} value={membership.organisationId}>
                    {multipleTenants
                      ? `${membership.organisationName} · ${membership.tenantName}`
                      : membership.organisationName}
                  </option>
                ))}
              </select>
            </form>
          )}
        </div>

        {current ? (
          <nav className={styles.nav} aria-label="Qula Tran">
            <div className={styles.sectionLabel}>WORKSPACE</div>
            {NAV.filter((item) => item.section === "workspace").map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
            <div className={styles.sectionLabel}>ADMIN</div>
            {NAV.filter((item) => item.section === "admin").map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>
        ) : (
          <div className={styles.nav} />
        )}

        <div className={styles.footer}>
          <div className={styles.footerName}>{profile.displayName}</div>
          <div className={styles.footerEmail}>{profile.email}</div>
          <form action={signOut}>
            <button className={styles.signOut} type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active =
    item.href === "/"
      ? pathname === "/"
      : item.href === "/admin"
        ? pathname === "/admin" || pathname.startsWith("/forms") || pathname.startsWith("/history")
        : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      prefetch
      className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
      aria-current={active ? "page" : undefined}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}
