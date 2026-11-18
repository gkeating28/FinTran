import { redirect } from "next/navigation";
import ApprovalRuleManager from "@/components/ApprovalRuleManager";
import { listApprovalRules } from "@/lib/approval-rule-data";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Approval rules" };

export default async function ApprovalRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listApprovalRules();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, types, failedEmails, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <ApprovalRuleManager
      rows={rows}
      types={types}
      failedEmails={failedEmails}
      loadError={error}
      actionError={params.error}
      canEdit={canManage(workspace.current.role)}
      organisationName={workspace.current.organisationName}
    />
  );
}
