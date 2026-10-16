import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PurchaseInvoiceManager from "@/components/PurchaseInvoiceManager";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
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
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ code }, query] = await Promise.all([params, searchParams]);
  const { tile, error } = await getTransactionTypeByCode(code);
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

  if (tile.type !== "Purchases") {
    return (
      <section className={styles.stack}>
        <div>
          <h1 className={styles.heading}>{tile.description}</h1>
          <p className={styles.lede}>
            {tile.code} is a {tile.type} transaction type. Sales documents are not entered on this page yet.{" "}
            <Link href={`/forms/${tile.code}`}>Design the printed form.</Link>
          </p>
        </div>
      </section>
    );
  }

  const listed = await listPurchaseInvoices(tile.code);

  return (
    <PurchaseInvoiceManager
      title={tile.description}
      summary={`The reference for ${tile.code} comes from this type, and the next number is one more than its last reference. Amounts in the home currency are the foreign amounts divided by the exchange rate.`}
      typeCode={tile.code}
      rows={listed.rows}
      choices={listed.choices}
      loadError={listed.error}
      actionError={query.error}
    />
  );
}
