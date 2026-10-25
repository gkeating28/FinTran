"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
  { href: "/", label: "Home", icon: <GridIcon />, section: "workspace" },
  { href: "/transactions", label: "Transactions", icon: <LedgerIcon />, section: "workspace" },
  { href: "/customers", label: "Customers", icon: <CustomerIcon />, section: "workspace" },
  { href: "/suppliers", label: "Suppliers", icon: <SupplierIcon />, section: "workspace" },
  { href: "/e-documents", label: "E-documents", icon: <LedgerIcon />, section: "workspace" },
  { href: "/admin", label: "Admin", icon: <AdminIcon />, section: "admin" },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
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

function GridIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
  );
}

function LedgerIcon() {
  return (
    <Icon>
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </Icon>
  );
}

function AdminIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </Icon>
  );
}

function CustomerIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="3" />
      <path d="M5 19v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
    </Icon>
  );
}

function SupplierIcon() {
  return (
    <Icon>
      <path d="M3 8h11v7H3z" />
      <path d="M14 11h4l3 3v1h-7" />
      <circle cx="7" cy="17.5" r="1.5" />
      <circle cx="17" cy="17.5" r="1.5" />
    </Icon>
  );
}

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
  const multipleTenants = new Set(memberships.map((membership) => membership.tenantId)).size > 1;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <img src="/qula-logo.png" alt="" width={48} height={48} className={styles.brandMark} />
        <div>
          <div className={styles.brandName}>Qula</div>
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
        <nav className={styles.nav} aria-label="Qula">
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
