import { redirect } from "next/navigation";
import ReferenceManager from "@/components/ReferenceManager";
import { getWorkspace } from "@/lib/data";
import { listReference } from "@/lib/reference-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "VAT rates" };

export default async function VatRatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listReference("vat_rates");
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <ReferenceManager
      kind="vat_rates"
      rows={rows}
      loadError={error}
      actionError={params.error}
      canEdit={canManage(workspace.current.role)}
    />
  );
}
