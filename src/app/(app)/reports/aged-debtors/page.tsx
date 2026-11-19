import { redirect } from "next/navigation";
import AgedReport from "@/components/AgedReport";
import { getAgedReport } from "@/lib/aged-data";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Aged debtors" };

export default async function AgedDebtorsPage({ searchParams }: { searchParams: Promise<{ asOf?: string; basis?: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const params = await searchParams;
  const { report, truncated, error } = await getAgedReport("Sales", params.asOf, params.basis);

  return <AgedReport direction="Sales" report={report} truncated={truncated} loadError={error} organisationName={workspace.current.organisationName} />;
}
