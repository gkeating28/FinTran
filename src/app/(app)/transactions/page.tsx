import { documentStatusLabel } from "@/lib/transaction-types";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DocumentIcon } from "@/components/icons";
import styles from "@/components/OpsPage.module.css";
import dashboardStyles from "@/components/Dashboard.module.css";
import { getWorkspace } from "@/lib/data";
import { formatInteger } from "@/lib/numbers";
import { createStandardPaymentTypes } from "@/lib/payment-actions";
import { canManage } from "@/lib/types";
import { listTransactionMenu, type TransactionMenuTile } from "@/lib/transaction-type-data";
import { documentKindLabel, isPaymentKind } from "@/lib/transaction-types";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const menu = listTransactionMenu();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { tiles, error } = await menu;
  const query = await searchParams;
  // An owner or admin of an organisation without payment or receipt types is offered the standard four.
  const offerPaymentTypes = canManage(workspace.current.role) && !error && !tiles.some((tile) => isPaymentKind(tile.documentKind));

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
      {query.error ? (
        <p className={styles.alert} role="alert">
          {query.error}
        </p>
      ) : null}
      {offerPaymentTypes ? (
        <form action={createStandardPaymentTypes} className={styles.panel}>
          <h2 className={dashboardStyles.menuHeading}>Record payments and receipts</h2>
          <p className={styles.panelMeta}>
            Add the standard types: Customer receipt, Supplier payment, Customer refund and Supplier refund. You can change their
            descriptions and numbering afterwards.
          </p>
          <button className={styles.primary} type="submit">
            Add payment and receipt types
          </button>
        </form>
      ) : null}
      {tiles.length === 0 ? (
        <>
          <p className={styles.empty}>
            No transaction types yet. Add them under Admin, then they will appear here.
          </p>
          {canManage(workspace.current.role) ? (
            <div className={dashboardStyles.menuGroups}>
              <JournalsGroup />
            </div>
          ) : null}
        </>
      ) : (
        <div className={dashboardStyles.menuGroups}>
          <TransactionGroup title="Purchase transactions" tiles={tiles.filter((tile) => tile.type === "Purchases")} />
          <hr className={dashboardStyles.menuDivider} />
          <TransactionGroup title="Sales transactions" tiles={tiles.filter((tile) => tile.type === "Sales")} />
          <hr className={dashboardStyles.menuDivider} />
          {canManage(workspace.current.role) ? (
            <>
              <JournalsGroup />
              <hr className={dashboardStyles.menuDivider} />
            </>
          ) : null}
          <section className={dashboardStyles.menuSection}>
            <h2 className={dashboardStyles.menuHeading}>Payment runs</h2>
            <div className={dashboardStyles.adminGrid}>
              <Link prefetch href="/payment-runs" className={dashboardStyles.adminTile}>
                <span className={dashboardStyles.adminTileIcon}>
                  <DocumentIcon size={22} />
                </span>
                <span className={dashboardStyles.adminTileLabel}>Payment runs</span>
                <span className={dashboardStyles.adminTileMeta}>Pay many supplier invoices at once, approved as a whole</span>
              </Link>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

/** The manual journals. They do not depend on a transaction type, so the tile is there even before any type is added. */
function JournalsGroup() {
  return (
    <section className={dashboardStyles.menuSection}>
      <h2 className={dashboardStyles.menuHeading}>GL Journals</h2>
      <div className={dashboardStyles.adminGrid}>
        <Link prefetch href="/transactions/journals" className={dashboardStyles.adminTile}>
          <span className={dashboardStyles.adminTileIcon}>
            <DocumentIcon size={22} />
          </span>
          <span className={dashboardStyles.adminTileLabel}>Journals</span>
          <span className={dashboardStyles.adminTileMeta}>Accruals, adjustments and opening balances</span>
        </Link>
      </div>
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
                {tile.statusCounts.map((item) => `${formatInteger(item.count)} ${documentStatusLabel(item.status).toLowerCase()}`).join(" · ")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}


