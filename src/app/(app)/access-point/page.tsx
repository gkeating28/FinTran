import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

/** Settings are now a tab of the organisation edit. The old address opens that tab for the organisation being worked in. */
export default async function Page() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");
  if (!canManage(workspace.current.role)) redirect("/admin");
  redirect(`/organisations?edit=${workspace.current.organisationId}&tab=access-point&open=1`);
}
