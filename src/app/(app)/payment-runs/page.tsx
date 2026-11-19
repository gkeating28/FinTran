import { redirect } from "next/navigation";
import PaymentRunManager from "@/components/PaymentRunManager";
import { getWorkspace } from "@/lib/data";
import { listPaymentRuns } from "@/lib/payment-run-data";

export const metadata = { title: "Payment runs" };

export default async function PaymentRunsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const listed = listPaymentRuns();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, choices, error }, params] = await Promise.all([listed, searchParams]);

  return <PaymentRunManager rows={rows} choices={choices} loadError={error} organisationName={workspace.current.organisationName} openId={params.open} />;
}
