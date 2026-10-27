import { notFound, redirect } from "next/navigation";
import PurchaseInvoiceManager from "@/components/PurchaseInvoiceManager";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { listPurchaseInvoices } from "@/lib/purchase-invoice-data";
import { getTransactionTypeByCode } from "@/lib/transaction-type-data";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { tile } = await getTransactionTypeByCode(code);
  return { title: tile?.description ?? "Transaction" };
}

export default async function TransactionTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; open?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ code }, query] = await Promise.all([params, searchParams]);
  const [{ tile, error }, listed] = await Promise.all([
    getTransactionTypeByCode(code),
    listPurchaseInvoices(code),
  ]);
  if (error) {
    return (
      <section className={styles.stack}>
        <h1 className={styles.heading}>Transaction</h1>
        <p className={styles.alert} role="alert">
          {error}
        </p>
      </section>
    );
  }
  if (!tile) notFound();

  return (
    <PurchaseInvoiceManager
      title={tile.description}
      summary={`${tile.description} for ${workspace.current.organisationName}.`}
      typeCode={tile.code}
      direction={tile.type}
      rows={listed.rows}
      choices={listed.choices}
      loadError={listed.error}
      actionError={query.error}
      openId={query.open}
      canVoid={canManage(workspace.current.role) && tile.type === "Purchases"}
      canDownload={canManage(workspace.current.role) && tile.documentKind !== "order"}
    />
  );
}
