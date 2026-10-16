"use client";

import { useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import styles from "@/components/PrintForm.module.css";
import { PAGE_SIZE_OPTIONS, type PageSize } from "@/lib/form-layout";

export default function PdfButton({ fileName, pageSize }: { fileName: string; pageSize: PageSize }) {
  const [pending, setPending] = useState(false);

  async function download() {
    const paper = document.querySelector("article");
    if (!paper || pending) return;
    setPending(true);
    try {
      await Promise.all(
        [...paper.querySelectorAll("img")].map(
          (image) =>
            new Promise<void>((resolve) => {
              if (image.complete) resolve();
              else {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), { once: true });
              }
            }),
        ),
      );
      const canvas = await html2canvas(paper, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const format = PAGE_SIZE_OPTIONS[pageSize].css.toLowerCase();
      const doc = new jsPDF({ unit: "mm", format, orientation: "portrait" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const image = canvas.toDataURL("image/jpeg", 0.92);
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      let remaining = imageHeight;
      let offset = 0;
      doc.addImage(image, "JPEG", 0, offset, pageWidth, imageHeight);
      remaining -= pageHeight;
      while (remaining > 2) {
        offset = remaining - imageHeight;
        doc.addPage();
        doc.addImage(image, "JPEG", 0, offset, pageWidth, imageHeight);
        remaining -= pageHeight;
      }
      doc.save(fileName);
    } finally {
      setPending(false);
    }
  }

  return (
    <button className={styles.pdf} type="button" onClick={download} disabled={pending}>
      {pending ? "Preparing…" : "PDF"}
    </button>
  );
}
