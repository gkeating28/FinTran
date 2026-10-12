import { redirect } from "next/navigation";
import TransactionTypeManager from "@/components/TransactionTypeManager";
import { getWorkspace } from "@/lib/data";
import { listTransactionTypes } from "@/lib/transaction-type-data";

export const metadata = { title: "Transaction types" };

export default async function TransactionTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listTransactionTypes();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, error }, params] = await Promise.all([listed, searchParams]);

  return <TransactionTypeManager rows={rows} loadError={error} actionError={params.error} />;
}
