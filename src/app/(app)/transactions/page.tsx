import { redirect } from "next/navigation";
import styles from "@/components/OpsPage.module.css";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { current } = workspace;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Transactions</h1>
        <p className={styles.lede}>
          Transaction definitions are managed separately for each organisation. {current.organisationName}{" "}
          will use its own types, fields, and posting rules.
        </p>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          Definitions
          <span className={styles.panelMeta}>{current.tenantName}</span>
        </div>
        <p className={styles.empty}>
          {current.organisationName} does not have any transaction definitions yet. This is where
          those definitions, and the entries posted against them, will be managed.
        </p>
      </div>
    </section>
  );
}
