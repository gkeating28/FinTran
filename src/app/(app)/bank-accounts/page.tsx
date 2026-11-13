import { redirect } from "next/navigation";
import BankAccountManager from "@/components/BankAccountManager";
import { listBankAccounts } from "@/lib/bank-account-data";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export const metadata = { title: "Bank accounts" };

export default async function BankAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const listed = listBankAccounts();
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [{ rows, currencies, glCodes, error }, params] = await Promise.all([listed, searchParams]);

  return (
    <BankAccountManager
      rows={rows}
      currencies={currencies}
      glCodes={glCodes}
      loadError={error}
      actionError={params.error}
      canEdit={canManage(workspace.current.role)}
      organisationName={workspace.current.organisationName}
    />
  );
}
