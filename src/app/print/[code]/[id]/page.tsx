import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import PrintedForm from "@/components/PrintedForm";
import PrintedPayment from "@/components/PrintedPayment";
import styles from "@/components/PrintForm.module.css";
import { loadPrintedDocument } from "@/lib/form-data";
import { getWorkspace } from "@/lib/data";
import { currentCodeFor } from "@/lib/legacy-type-codes";
import { loadPrintedPayment } from "@/lib/payment-print-data";
import { PAGE_SIZE_OPTIONS } from "@/lib/form-layout";
import PdfButton from "./PdfButton";
import PrintButton from "./PrintButton";

function pdfFileName(stem: string) {
  const name = stem.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  return `${name || "document"}.pdf`;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const payment = await loadPrintedPayment(code, id);
  if (payment.isPaymentType) return { title: payment.view ? payment.view.title : "Print" };
  const loaded = await loadPrintedDocument(code, id);
  return { title: loaded.view ? loaded.view.title : "Print" };
}

export default async function PrintDocumentPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { code, id } = await params;

  // A payment, receipt or refund has its own fixed layout. Everything else is a document, printed from its form.
  const payment = await loadPrintedPayment(code, id);
  if (payment.error) {
    return (
      <main className={styles.stage}>
        <p role="alert">{payment.error}</p>
      </main>
    );
  }
  if (payment.isPaymentType) {
    if (!payment.view) notFound();
    return (
      <main className={styles.stage}>
        <div className={styles.toolbar} style={{ ["--page-width" as string]: PAGE_SIZE_OPTIONS[payment.view.pageSize].width }}>
          <Link className={styles.back} href={`/transactions/${payment.typeCode}`}>
            <ArrowLeftIcon />
            Back
          </Link>
          <span className={styles.spacer} />
          <PdfButton pageSize={payment.view.pageSize} fileName={pdfFileName(payment.view.downloadName)} />
          <PrintButton />
        </div>
        <PrintedPayment view={payment.view} />
      </main>
    );
  }

  const loaded = await loadPrintedDocument(code, id);
  if (loaded.error) {
    return (
      <main className={styles.stage}>
        <p role="alert">{loaded.error}</p>
      </main>
    );
  }
  if (!loaded.view || !loaded.type) {
    const next = currentCodeFor(code);
    if (next) redirect(`/print/${next}/${id}`);
    notFound();
  }

  return (
    <main className={styles.stage}>
      <div className={styles.toolbar} style={{ ["--page-width" as string]: PAGE_SIZE_OPTIONS[loaded.view.pageSize].width }}>
        <Link className={styles.back} href={`/transactions/${loaded.type.code}`}>
          <ArrowLeftIcon />
          Back
        </Link>
        <span className={styles.spacer} />
        <PdfButton
          pageSize={loaded.view.pageSize}
          fileName={pdfFileName(loaded.view.downloadName)}
        />
        <PrintButton />
      </div>
      <PrintedForm view={loaded.view} />
    </main>
  );
}
