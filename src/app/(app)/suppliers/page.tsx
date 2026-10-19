import { redirect } from "next/navigation";
import PartyManager from "@/components/PartyManager";
import { getWorkspace } from "@/lib/data";
import { listParties } from "@/lib/party-data";
import { listCodeLists } from "@/lib/reference-data";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listParties("suppliers");
  const lists = listCodeLists();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, currencies, homeCurrencyId, error }, codes, params] = await Promise.all([listed, lists, searchParams]);

  return (
    <PartyManager
      kind="suppliers"
      rows={rows}
      currencies={currencies}
      countries={codes.countries}
      schemes={codes.schemes}
      homeCurrencyId={homeCurrencyId}
      loadError={error ?? codes.error}
      actionError={params.error}
    />
  );
}
