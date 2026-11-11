"use client";

import DataGrid from "@/components/DataGrid";
import { useRegion } from "@/components/useRegion";
import { formatDateTime } from "@/lib/dates";
import type { AuditEntry } from "@/lib/audit-data";

export default function HistoryGrid({ rows }: { rows: AuditEntry[] }) {
  const region = useRegion();
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
          render: (row) => formatDateTime(row.when, region),
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
