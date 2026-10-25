"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import DataGrid from "@/components/DataGrid";
import { UploadEInvoice } from "@/components/UploadEInvoice";
import styles from "@/components/OpsPage.module.css";

const STATUSES = ["received", "generated", "valid", "invalid", "duplicate", "imported", "rejected"] as const;

export type EDocumentListRow = {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  documentNumber: string;
  issueDate: string;
  party: string;
  total: string;
  documentHref: string | null;
};

function statusLabel(status: string) {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "";
}

export function EDocumentList({
  rows,
  initialDirection,
}: {
  rows: EDocumentListRow[];
  initialDirection: "inbound" | "outbound";
}) {
  const router = useRouter();
  const direction = initialDirection;
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const visible = rows.filter((row) => {
    if (row.direction !== direction) return false;
    if (status && row.status !== status) return false;
    if (fromDate && row.issueDate < fromDate) return false;
    if (toDate && (row.issueDate === "" || row.issueDate > toDate)) return false;
    return true;
  });

  return (
    <>
      {uploadError ? (
        <p className={styles.alert} role="alert">
          {uploadError}
        </p>
      ) : null}
      <DataGrid
        rows={visible}
        searchPlaceholder="Search e-documents"
        searchText={(row) => `${row.documentNumber} ${row.party} ${row.status} ${row.issueDate} ${row.total}`}
        emptyLabel={direction === "inbound" ? "No received e-documents yet." : "No sent e-documents yet."}
        minWidth="760px"
        toolbar={
          <>
            <button
              className={direction === "inbound" ? styles.primary : styles.quiet}
              type="button"
              onClick={() => router.replace("/e-documents?direction=inbound")}
            >
              Received
            </button>
            <button
              className={direction === "outbound" ? styles.primary : styles.quiet}
              type="button"
              onClick={() => router.replace("/e-documents?direction=outbound")}
            >
              Sent
            </button>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
              <option value="">Any status</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {statusLabel(item)}
                </option>
              ))}
            </select>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
            {direction === "inbound" ? <UploadEInvoice onError={setUploadError} /> : null}
          </>
        }
        columns={[
          {
            key: "date",
            label: "Date",
            mono: true,
            sortValue: (row) => row.issueDate,
            render: (row) => row.issueDate || "—",
          },
          {
            key: "number",
            label: "Number",
            mono: true,
            sortValue: (row) => row.documentNumber,
            render: (row) => <Link href={`/e-documents/${row.id}`}>{row.documentNumber}</Link>,
          },
          {
            key: "party",
            label: "Party",
            sortValue: (row) => row.party,
            render: (row) => row.party || "—",
          },
          {
            key: "total",
            label: "Total",
            mono: true,
            align: "right",
            sortValue: (row) => row.total.replace(/,/g, ""),
            render: (row) => row.total || "—",
          },
          {
            key: "status",
            label: "Status",
            sortValue: (row) => row.status,
            render: (row) => statusLabel(row.status),
          },
          {
            key: "document",
            label: "Document",
            sortValue: (row) => row.documentHref ?? "",
            render: (row) => (row.documentHref ? <Link href={row.documentHref}>Open</Link> : "—"),
          },
        ]}
      />
    </>
  );
}
