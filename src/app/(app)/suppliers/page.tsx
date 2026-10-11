import { redirect } from "next/navigation";
import PartyManager from "@/components/PartyManager";
import { getWorkspace } from "@/lib/data";
import { listParties } from "@/lib/party-data";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listParties("suppliers");
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, currencies, homeCurrencyId, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <PartyManager
      kind="suppliers"
      rows={rows}
      currencies={currencies}
      homeCurrencyId={homeCurrencyId}
      loadError={error}
      actionError={params.error}
    />
  );
}
