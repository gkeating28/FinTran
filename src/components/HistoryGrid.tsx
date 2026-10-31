"use client";

import DataGrid from "@/components/DataGrid";
import type { AuditEntry } from "@/lib/audit-data";

export default function HistoryGrid({ rows }: { rows: AuditEntry[] }) {
  return (
    <DataGrid
      form="history"
      rows={rows}
      searchPlaceholder="Search changes"
      searchText={(row) => `${row.tableName} ${row.action} ${row.who} ${row.summary}`}
      emptyLabel="No changes have been recorded for this organisation yet."
      minWidth="980px"
      columns={[
        {
          key: "when",
          label: "When",
          sortValue: (row) => row.when,
          render: (row) => formatWhen(row.when),
        },
        {
          key: "who",
          label: "Who",
          sortValue: (row) => row.who,
          render: (row) => row.who,
        },
        {
          key: "table",
          label: "Record",
          sortValue: (row) => row.tableName,
          render: (row) => row.tableName,
        },
        {
          key: "action",
          label: "Action",
          sortValue: (row) => row.action,
          render: (row) => row.action,
        },
        {
          key: "summary",
          label: "Detail",
          sortValue: (row) => row.summary,
          render: (row) => row.summary,
        },
      ]}
    />
  );
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
