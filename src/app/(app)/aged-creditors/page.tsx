import { redirect } from "next/navigation";
import AgedReport from "@/components/AgedReport";
import { getAgedReport } from "@/lib/aged-data";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Aged creditors" };

export default async function AgedCreditorsPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const params = await searchParams;
  const { report, truncated, error } = await getAgedReport("Purchases", params.asOf);

  return <AgedReport direction="Purchases" report={report} truncated={truncated} loadError={error} organisationName={workspace.current.organisationName} />;
}
