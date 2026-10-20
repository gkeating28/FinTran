import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PrintedForm from "@/components/PrintedForm";
import styles from "@/components/PrintForm.module.css";
import { loadPrintedDocument } from "@/lib/form-data";
import { getWorkspace } from "@/lib/data";
import PdfButton from "./PdfButton";
import PrintButton from "./PrintButton";

function pdfFileName(stem: string) {
  const name = stem.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  return `${name || "document"}.pdf`;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  const loaded = await loadPrintedDocument(code, id);
  return { title: loaded.view ? loaded.view.title : "Print" };
}

export default async function PrintDocumentPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { code, id } = await params;
  const loaded = await loadPrintedDocument(code, id);
  if (loaded.error) {
    return (
      <main className={styles.stage}>
        <p role="alert">{loaded.error}</p>
      </main>
    );
  }
  if (!loaded.view || !loaded.type) notFound();

  return (
    <main className={styles.stage}>
      <div className={styles.toolbar}>
        <Link className={styles.back} href={`/transactions/${loaded.type.code}`}>
          Back
        </Link>
        <PrintButton />
        <PdfButton
          pageSize={loaded.view.pageSize}
          fileName={pdfFileName(loaded.view.downloadName)}
        />
      </div>
      <PrintedForm view={loaded.view} />
    </main>
  );
}
