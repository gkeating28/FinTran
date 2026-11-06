import Link from "next/link";
import styles from "@/components/OpsPage.module.css";
import type { HomeOverview as Overview } from "@/lib/home-data";

const SHORTCUTS = [
  { href: "/transactions", label: "Transactions", meta: "Purchase and sales documents" },
  { href: "/suppliers", label: "Suppliers", meta: "Who you buy from" },
  { href: "/customers", label: "Customers", meta: "Who you sell to" },
  { href: "/e-documents", label: "E-documents", meta: "Send and receive e-invoices" },
  { href: "/admin", label: "Admin", meta: "Codes, rates, forms and access" },
];

function count(value: number | null) {
  return value === null ? "-" : String(value);
}

export default function HomeOverview({
  organisationName,
  tenantName,
  role,
  organisationCount,
  memberCount,
  error,
  overview,
}: {
  organisationName: string;
  tenantName: string;
  role: string;
  organisationCount: number;
  memberCount: number | null;
  error?: string | null;
  overview: Overview;
}) {
  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{organisationName}</h1>
        <p className={styles.lede}>
          Drafts and e-invoices are the work waiting for you.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}

      <h2 className={styles.menuHeading}>Needs attention</h2>
      <div className={styles.cards}>
        <Link href="/transactions" className={`${styles.card} ${styles.cardLink}`}>
          <div className={styles.cardLabel}>Draft documents</div>
          <div className={styles.cardValue}>{count(overview.draftDocuments)}</div>
          <div className={styles.cardNote}>waiting to be posted</div>
        </Link>
        <Link href="/e-documents" className={`${styles.card} ${styles.cardLink}`}>
          <div className={styles.cardLabel}>E-invoices ready to import</div>
          <div className={styles.cardValue}>{count(overview.eDocumentsReady)}</div>
          <div className={styles.cardNote}>received and valid</div>
        </Link>
        <Link href="/e-documents" className={`${styles.card} ${styles.cardLink}`}>
          <div className={styles.cardLabel}>E-invoices to review</div>
          <div className={styles.cardValue}>{count(overview.eDocumentsNeedReview)}</div>
          <div className={styles.cardNote}>duplicates and invalid files</div>
        </Link>
        <Link href="/transactions" className={`${styles.card} ${styles.cardLink}`}>
          <div className={styles.cardLabel}>Posted this month</div>
          <div className={styles.cardValue}>{count(overview.postedThisMonth)}</div>
          <div className={styles.cardNote}>documents</div>
        </Link>
      </div>

      <h2 className={styles.menuHeading}>Go to</h2>
      <div className={styles.shortcutGrid}>
        {SHORTCUTS.map((shortcut) => (
          <Link key={shortcut.href} href={shortcut.href} className={`${styles.adminTile} ${styles.shortcut}`}>
            <span className={styles.adminTileLabel}>{shortcut.label}</span>
            <span className={styles.adminTileMeta}>{shortcut.meta}</span>
          </Link>
        ))}
      </div>

      <h2 className={styles.menuHeading}>Workspace</h2>
      <div className={styles.panel}>
        <dl className={styles.workspaceList}>
          <div>
            <dt>Tenant</dt>
            <dd>{tenantName}</dd>
          </div>
          <div>
            <dt>Your role</dt>
            <dd>{role}</dd>
          </div>
          <div>
            <dt>Organisations you can open</dt>
            <dd>{organisationCount}</dd>
          </div>
          <div>
            <dt>People with access</dt>
            <dd>{count(memberCount)}</dd>
          </div>
        </dl>
      </div>

      <p className={styles.lede}>Version check: this page was last updated on 6 November 2026.</p>
    </section>
  );
}
