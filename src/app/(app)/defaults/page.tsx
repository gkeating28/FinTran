import { redirect } from "next/navigation";
import DefaultsManager from "@/components/DefaultsManager";
import { listOrganisationDefaults } from "@/lib/currency-data";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Defaults" };

export default async function DefaultsPage() {
  const listed = listOrganisationDefaults();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { currencies, homeCurrencyId, error } = await listed;

  return (
    <DefaultsManager currencies={currencies} homeCurrencyId={homeCurrencyId} loadError={error} />
  );
}
