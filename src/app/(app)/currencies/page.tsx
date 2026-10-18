import { redirect } from "next/navigation";
import CurrencyManager from "@/components/CurrencyManager";
import { listCurrencies } from "@/lib/currency-data";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Currencies" };

export default async function CurrenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listCurrencies();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <CurrencyManager
      rows={rows}
      loadError={error}
      actionError={params.error}
      canEdit={canManage(workspace.current.role)}
    />
  );
}
