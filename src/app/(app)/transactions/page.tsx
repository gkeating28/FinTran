import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { formatInteger } from "@/lib/numbers";
import { listTransactionMenu, type TransactionMenuTile } from "@/lib/transaction-type-data";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { tiles, error } = await listTransactionMenu();

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Transactions</h1>
        <p className={styles.lede}>
          Transactions for {workspace.current.organisationName}. Each tile opens that transaction type.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {tiles.length === 0 ? (
        <p className={styles.empty}>
          No transaction types yet. Add them under Admin, then they will appear here.
        </p>
      ) : (
        <div className={styles.menuGroups}>
          <TransactionGroup title="Purchase transactions" tiles={tiles.filter((tile) => tile.type === "Purchases")} />
          <hr className={styles.menuDivider} />
          <TransactionGroup title="Sales transactions" tiles={tiles.filter((tile) => tile.type === "Sales")} />
        </div>
      )}
    </section>
  );
}

function TransactionGroup({ title, tiles }: { title: string; tiles: TransactionMenuTile[] }) {
  return (
    <section className={styles.menuSection}>
      <h2 className={styles.menuHeading}>{title}</h2>
      {tiles.length === 0 ? (
        <p className={styles.panelMeta}>No {title.toLowerCase()} yet.</p>
      ) : (
        <div className={styles.adminGrid}>
          {tiles.map((tile) => (
            <Link key={tile.id} href={`/transactions/${tile.code}`} prefetch={false} className={styles.adminTile}>
              <span className={styles.adminTileIcon}>
                <DocumentIcon />
              </span>
              <span className={styles.adminTileLabel}>{tile.description}</span>
              <span className={styles.adminTileCount}>{formatInteger(tile.count)}</span>
              <span className={styles.adminTileMeta}>
                {tile.code} · {tile.count === 1 ? "invoice" : "invoices"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function DocumentIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <IconPath />
    </svg>
  );
}

function IconPath(): ReactNode {
  return (
    <>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v6h6" />
      <path d="M9 13h6M9 17h4" />
    </>
  );
}
