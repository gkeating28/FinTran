import Link from "next/link";
import { redirect } from "next/navigation";
import { DocumentIcon } from "@/components/icons";
import styles from "@/components/OpsPage.module.css";
import dashboardStyles from "@/components/Dashboard.module.css";
import { getWorkspace } from "@/lib/data";
import { formatInteger } from "@/lib/numbers";
import { listTransactionMenu, type TransactionMenuTile } from "@/lib/transaction-type-data";
import { documentKindLabel } from "@/lib/transaction-types";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const menu = listTransactionMenu();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { tiles, error } = await menu;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Transactions</h1>
        <p className={styles.lede}>
          Transactions for {workspace.current.organisationName}.
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
        <div className={dashboardStyles.menuGroups}>
          <TransactionGroup title="Purchase transactions" tiles={tiles.filter((tile) => tile.type === "Purchases")} />
          <hr className={dashboardStyles.menuDivider} />
          <TransactionGroup title="Sales transactions" tiles={tiles.filter((tile) => tile.type === "Sales")} />
        </div>
      )}
    </section>
  );
}

function TransactionGroup({ title, tiles }: { title: string; tiles: TransactionMenuTile[] }) {
  return (
    <section className={dashboardStyles.menuSection}>
      <h2 className={dashboardStyles.menuHeading}>{title}</h2>
      {tiles.length === 0 ? (
        <p className={styles.panelMeta}>No {title.toLowerCase()} yet.</p>
      ) : (
        <div className={dashboardStyles.adminGrid}>
          {tiles.map((tile) => (
            <Link key={tile.id} prefetch href={`/transactions/${tile.code}`} className={dashboardStyles.adminTile}>
              <span className={dashboardStyles.adminTileIcon}>
                <DocumentIcon size={22} />
              </span>
              <span className={dashboardStyles.adminTileLabel}>{tile.description}</span>
              <span className={dashboardStyles.adminTileCount}>{formatInteger(tile.count)}</span>
              <span className={dashboardStyles.adminTileMeta}>
                {tile.code} · {documentKindLabel(tile.documentKind)}
              </span>
              <span className={dashboardStyles.adminTileMeta}>
                {tile.statusCounts.map((item) => `${formatInteger(item.count)} ${item.status}`).join(" · ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}


