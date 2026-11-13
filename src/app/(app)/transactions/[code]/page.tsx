import { notFound, redirect } from "next/navigation";
import DocumentManager from "@/components/DocumentManager";
import PaymentManager from "@/components/PaymentManager";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { listDocuments } from "@/lib/document-data";
import { getTransactionTypeByCode } from "@/lib/transaction-type-data";
import { listPayments } from "@/lib/payment-data";
import { parsePaymentPrefill } from "@/lib/payments";
import { isOrderKind, isPaymentKind } from "@/lib/transaction-types";

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
  searchParams: Promise<{ error?: string; open?: string; ask?: string; new?: string; party?: string; allocate?: string }>;
}) {
  const { code } = await params;
  const typed = getTransactionTypeByCode(code);
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const query = await searchParams;
  const { tile, error } = await typed;
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

  // Payments and receipts have their own list and entry screen. Everything else is a document.
  if (isPaymentKind(tile.documentKind)) {
    const paid = await listPayments(tile.code);
    if (!paid.choices) {
      return (
        <section className={styles.stack}>
          <h1 className={styles.heading}>{tile.description}</h1>
          <p className={styles.alert} role="alert">
            {paid.error ?? "This payment type could not be loaded."}
          </p>
        </section>
      );
    }
    return (
      <PaymentManager
        title={tile.description}
        summary={`${tile.description} for ${workspace.current.organisationName}.`}
        rows={paid.rows}
        choices={paid.choices}
        loadError={paid.error}
        actionError={query.error}
        openId={query.open}
        openStamp={query.ask}
        startNew={query.new === "1"}
        prefill={parsePaymentPrefill(query)}
      />
    );
  }

  const listed = await listDocuments(code);

  return (
    <DocumentManager
      title={tile.description}
      summary={`${tile.description} for ${workspace.current.organisationName}.`}
      typeCode={tile.code}
      direction={tile.type}
      rows={listed.rows}
      choices={listed.choices}
      loadError={listed.error}
      actionError={query.error}
      openId={query.open}
      openStamp={query.ask}
      canVoid={canManage(workspace.current.role) && tile.type === "Purchases"}
      canDownload={canManage(workspace.current.role) && !isOrderKind(tile.documentKind)}
    />
  );
}
