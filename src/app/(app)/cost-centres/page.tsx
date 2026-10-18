import { redirect } from "next/navigation";
import ReferenceManager from "@/components/ReferenceManager";
import { getWorkspace } from "@/lib/data";
import { listReference } from "@/lib/reference-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Cost centres" };

export default async function CostCentresPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listReference("cost_centres");
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <ReferenceManager
      kind="cost_centres"
      rows={rows}
      loadError={error}
      actionError={params.error}
      canEdit={canManage(workspace.current.role)}
    />
  );
}
