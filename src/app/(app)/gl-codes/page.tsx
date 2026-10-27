import { redirect } from "next/navigation";
import ReferenceManager from "@/components/ReferenceManager";
import { getWorkspace } from "@/lib/data";
import { listReference } from "@/lib/reference-data";
import { canManage } from "@/lib/types";

export const metadata = { title: "GL codes" };

export default async function GlCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listReference("gl_codes");
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <ReferenceManager
      kind="gl_codes"
      rows={rows}
      loadError={error}
      actionError={params.error}
      canEdit={canManage(workspace.current.role)}
      organisationName={workspace.current.organisationName}
    />
  );
}
