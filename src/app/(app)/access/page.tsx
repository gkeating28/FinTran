import { redirect } from "next/navigation";
import { GrantAccessForm } from "@/components/Forms";
import { revokeAccess } from "@/lib/actions";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace, listOrganisationMembers } from "@/lib/data";
import { canManage, roleLabel } from "@/lib/types";

export const metadata = { title: "Access" };

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current, profile } = workspace;
  const [{ members, error }, params] = await Promise.all([
    listOrganisationMembers(current.organisationId),
    searchParams,
  ]);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Access</h1>
        <p className={styles.lede}>
          People listed here can open {current.organisationName}. Someone must already have a
          FinTran account before you can grant them access.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {params.error ? (
        <p className={styles.alert} role="alert">
          {params.error}
        </p>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          {current.organisationName}
          <span className={styles.panelMeta}>{roleLabel(current.role)}</span>
        </div>
        {members.length === 0 ? (
          <p className={styles.empty}>No one has access to this organisation yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                {canManage(current.role) ? <th>Action</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    {member.displayName}
                    {member.email === profile.email ? " (you)" : ""}
                  </td>
                  <td>{member.email}</td>
                  <td>{roleLabel(member.role)}</td>
                  {canManage(current.role) ? (
                    <td>
                      <form action={revokeAccess}>
                        <input type="hidden" name="organisationId" value={current.organisationId} />
                        <input type="hidden" name="userId" value={member.userId} />
                        <button className={styles.quiet} type="submit">
                          Remove
                        </button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canManage(current.role) ? (
          <GrantAccessForm organisationId={current.organisationId} callerRole={current.role} />
        ) : null}
      </div>
    </section>
  );
}
