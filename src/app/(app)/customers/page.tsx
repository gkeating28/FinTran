import { redirect } from "next/navigation";
import PartyManager from "@/components/PartyManager";
import { getWorkspace } from "@/lib/data";
import { listParties } from "@/lib/party-data";
import { listCodeLists } from "@/lib/reference-data";

export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listParties("customers");
  const lists = listCodeLists();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, currencies, homeCurrencyId, error }, codes, params] = await Promise.all([listed, lists, searchParams]);

  return (
    <PartyManager
      kind="customers"
      rows={rows}
      currencies={currencies}
      countries={codes.countries}
      schemes={codes.schemes}
      homeCurrencyId={homeCurrencyId}
      organisationName={workspace.current.organisationName}
      loadError={error ?? codes.error}
      actionError={params.error}
    />
  );
}
