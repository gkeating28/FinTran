import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import FormDesigner from "@/components/FormDesigner";
import PaymentFormDesigner from "@/components/PaymentFormDesigner";
import styles from "@/components/OpsPage.module.css";
import { loadFormDesigner } from "@/lib/form-data";
import { getWorkspace } from "@/lib/data";
import { currentCodeFor } from "@/lib/legacy-type-codes";
import { getPaymentFormType, loadPaymentPrintSource, savedPaymentLayout } from "@/lib/payment-print-data";
import { canManage } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const payment = await getPaymentFormType(code);
  if (payment.type) return { title: `${payment.type.description} form` };
  const loaded = await loadFormDesigner(code);
  return { title: loaded.type ? `${loaded.type.description} form` : "Form" };
}

export default async function FormDesignerPage({ params }: { params: Promise<{ code: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { code } = await params;

  // A payment, receipt or refund is designed with its own fields.
  const payment = await loadPaymentPrintSource(code, null);
  if (payment.error) {
    return (
      <section className={styles.stack}>
        <h1 className={styles.heading}>Form</h1>
        <p className={styles.alert} role="alert">
          {payment.error}
        </p>
      </section>
    );
  }
  if (payment.type && payment.source) {
    const stored = await savedPaymentLayout(workspace.current.organisationId, payment.type);
    return (
      <section className={styles.stack}>
        <div>
          <p className={styles.trail}>
            <Link href="/forms">Forms</Link>
            <span> / </span>
            <Link href={`/transactions/${payment.type.code}`}>{payment.type.description}</Link>
          </p>
          <h1 className={styles.heading}>{payment.type.description} form</h1>
          <p className={styles.lede}>
            The printed page for {payment.type.description} in {workspace.current.organisationName}.
          </p>
        </div>
        {stored.error ? (
          <p className={styles.alert} role="alert">
            {stored.error}
          </p>
        ) : null}
        <PaymentFormDesigner
          type={payment.type}
          initialLayout={stored.layout}
          source={payment.source}
          sample={payment.sample}
          canEdit={canManage(workspace.current.role)}
        />
      </section>
    );
  }

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
  if (!loaded.type || !loaded.source) {
    const next = currentCodeFor(code);
    if (next) redirect(`/forms/${next}`);
    notFound();
  }

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
          The printed page for {loaded.type.description} in {workspace.current.organisationName}.
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
