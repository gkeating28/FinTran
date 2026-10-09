import { redirect } from "next/navigation";
import ReferenceManager from "@/components/ReferenceManager";
import { getWorkspace } from "@/lib/data";
import { listReference } from "@/lib/reference-data";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, error }, params] = await Promise.all([
    listReference("departments"),
    searchParams,
  ]);

  return (
    <ReferenceManager
      kind="departments"
      rows={rows}
      loadError={error}
      actionError={params.error}
    />
  );
}
