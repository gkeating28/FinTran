"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "@/components/icons";
import { buildXlsx, type XlsxCell, type XlsxType } from "@/lib/xlsx";
import styles from "@/components/OpsPage.module.css";

export type ExportField<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null;
  type?: XlsxType;
  /** Shown in the picker but ticked by default only when true. Displayed columns are always on by default. */
  defaultOn?: boolean;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function storageKey(form: string) {
  return `fintran.grid-fields.${form}`;
}

function readChoice(form: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(form));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
}

function numeric(value: string) {
  const text = value.replace(/,/g, "").trim();
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : null;
}

export default function GridExport<T>({
  form,
  rows,
  fields,
}: {
  form: string;
  rows: T[];
  fields: ExportField<T>[];
}) {
  const signature = fields.map((field) => field.key).join("|");
  const [chosen, setChosen] = useState<string[]>(() => fields.filter((field) => field.defaultOn !== false).map((field) => field.key));
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const keys = signature.split("|");
    // Read after mount so the server and first client render agree.
    void Promise.resolve().then(() => {
      const saved = readChoice(form);
      if (saved) setChosen(saved.filter((key) => keys.includes(key)));
    });
    // The signature stands for the field list, which callers rebuild on every render.
  }, [form, signature]);

  useEffect(() => {
    if (!open) return;
    function away(event: MouseEvent) {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function toggle(key: string) {
    const next = chosen.includes(key) ? chosen.filter((item) => item !== key) : [...chosen, key];
    setChosen(next);
    try {
      window.localStorage.setItem(storageKey(form), JSON.stringify(next));
    } catch {
      // The choice is only a convenience.
    }
  }

  function download() {
    const picked = fields.filter((field) => chosen.includes(field.key));
    if (picked.length === 0) return;
    const table = rows.map((row) => picked.map((field) => field.value(row)));
    const columns = picked.map((field, index) => {
      if (field.type) return { label: field.label, type: field.type };
      const texts = table.map((row) => row[index]);
      const allNumbers = texts.length > 0 && texts.every((cell) => typeof cell === "number" || (typeof cell === "string" && numeric(cell) !== null));
      return { label: field.label, type: (allNumbers ? "number" : "text") as XlsxType };
    });
    const cells: XlsxCell[][] = table.map((row) =>
      row.map((cell, index) => {
        if (cell == null || cell === "") return null;
        if (columns[index].type === "text") return String(cell);
        if (typeof cell === "number") return cell;
        const plain = numeric(cell);
        return plain === null ? cell : Number(plain);
      }),
    );
    const name = form.replace(/[\\/]+/g, "-");
    const bytes = buildXlsx({ sheet: name, columns, rows: cells });
    const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  return (
    <div className={styles.exportMenu} ref={holder}>
      <button
        className={styles.quiet}
        type="button"
        onClick={download}
        disabled={rows.length === 0 || chosen.length === 0}
        title={`Download ${rows.length} row${rows.length === 1 ? "" : "s"} as an Excel file`}
      >
        <DownloadIcon size={14} /> Excel
      </button>
      <button
        className={styles.quiet}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        Fields
      </button>
      {open ? (
        <div className={styles.exportPanel} role="group" aria-label="Fields to export">
          {fields.map((field) => (
            <label key={field.key}>
              <input type="checkbox" checked={chosen.includes(field.key)} onChange={() => toggle(field.key)} />
              {field.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
