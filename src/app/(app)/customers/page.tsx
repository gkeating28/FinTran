import { redirect } from "next/navigation";
import PartyManager from "@/components/PartyManager";
import { getWorkspace } from "@/lib/data";
import { listParties } from "@/lib/party-data";

export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listParties("customers");
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, currencies, homeCurrencyId, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <PartyManager
      kind="customers"
      rows={rows}
      currencies={currencies}
      homeCurrencyId={homeCurrencyId}
      loadError={error}
      actionError={params.error}
    />
  );
}
