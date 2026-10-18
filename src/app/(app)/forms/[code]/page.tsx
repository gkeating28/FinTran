import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import FormDesigner from "@/components/FormDesigner";
import styles from "@/components/OpsPage.module.css";
import { loadFormDesigner } from "@/lib/form-data";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const loaded = await loadFormDesigner(code);
  return { title: loaded.type ? `${loaded.type.description} form` : "Form" };
}

export default async function FormDesignerPage({ params }: { params: Promise<{ code: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { code } = await params;
  const loaded = await loadFormDesigner(code);
  if (loaded.error) {
    return (
      <section className={styles.stack}>
        <h1 className={styles.heading}>Form</h1>
        <p className={styles.alert} role="alert">
          {loaded.error}
        </p>
      </section>
    );
  }
  if (!loaded.type || !loaded.source) notFound();

  return (
    <section className={styles.stack}>
      <div>
        <p className={styles.trail}>
          <Link href="/forms">Forms</Link>
          <span> / </span>
          <Link href={`/transactions/${loaded.type.code}`}>{loaded.type.description}</Link>
        </p>
        <h1 className={styles.heading}>{loaded.type.description} form</h1>
        <p className={styles.lede}>
          The printed page for {loaded.type.description} in {workspace.current.organisationName}. Choose the
          organisation, bill-to, document, and line details, then save.
        </p>
      </div>
      <FormDesigner
        type={loaded.type}
        initialLayout={loaded.layout}
        source={loaded.source}
        sample={loaded.sample}
        canEdit={canManage(workspace.current.role)}
      />
    </section>
  );
}
