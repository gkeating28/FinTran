"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { selectOrganisation } from "@/lib/actions";
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
  { href: "/organisations", label: "Organisations", icon: <OrgIcon />, section: "admin" },
  { href: "/access", label: "Access", icon: <PeopleIcon />, section: "admin" },
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

function OrgIcon() {
  return (
    <Icon>
      <path d="M4 20V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v14" />
      <path d="M14 10h5a1 1 0 0 1 1 1v9" />
      <path d="M8 9h2M8 13h2M8 17h2M17 14h1M17 17h1" />
    </Icon>
  );
}

function PeopleIcon() {
  return (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13a3 3 0 0 1 0 5.75" />
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
        <div className={styles.brandMark}>F</div>
        <div>
          <div className={styles.brandName}>FinTran</div>
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
        <nav className={styles.nav} aria-label="FinTran">
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
      </div>
    </aside>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={active ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
      aria-current={active ? "page" : undefined}
    >
      {item.icon}
      {item.label}
    </Link>
  );
}
