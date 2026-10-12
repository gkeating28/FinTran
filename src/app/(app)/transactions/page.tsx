import { redirect } from "next/navigation";
import PurchaseInvoiceManager from "@/components/PurchaseInvoiceManager";
import { getWorkspace } from "@/lib/data";
import { listPurchaseInvoices } from "@/lib/purchase-invoice-data";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listPurchaseInvoices();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, choices, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <PurchaseInvoiceManager rows={rows} choices={choices} loadError={error} actionError={params.error} />
  );
}
