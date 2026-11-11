import { buildCsv, type CsvCell } from "./safe-cell";
import { buildXlsx, type XlsxCell, type XlsxColumn } from "./xlsx";

const CSV_MIME = "text/csv;charset=utf-8";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function save(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Downloads a table as a CSV file. The byte order mark lets Excel read it as UTF-8. */
export function downloadCsv(filename: string, columns: string[], rows: CsvCell[][]) {
  save(new Blob([`﻿${buildCsv(columns, rows)}`], { type: CSV_MIME }), filename);
}

/** Downloads a table as an Excel file. */
export function downloadXlsx(filename: string, options: { sheet: string; columns: XlsxColumn[]; rows: XlsxCell[][] }) {
  save(new Blob([buildXlsx(options) as BlobPart], { type: XLSX_MIME }), filename);
}
