import { redirect } from "next/navigation";
import CurrencyManager from "@/components/CurrencyManager";
import { listCurrencies } from "@/lib/currency-data";
import { getWorkspace } from "@/lib/data";
import { listCodeLists } from "@/lib/reference-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Currencies" };

export default async function CurrenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listCurrencies();
  const lists = listCodeLists();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, error }, codes, params] = await Promise.all([listed, lists, searchParams]);

  return (
    <CurrencyManager
      rows={rows}
      isoCurrencies={codes.currencies}
      loadError={error ?? codes.error}
      actionError={params.error}
      canEdit={canManage(workspace.current.role)}
    />
  );
}
