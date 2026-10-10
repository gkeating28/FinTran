"use client";

import { GrantAccessForm } from "@/components/Forms";
import DataGrid from "@/components/DataGrid";
import { revokeAccess } from "@/lib/actions";
import styles from "@/components/OpsPage.module.css";
import { roleLabel, type Role } from "@/lib/types";

export type AccessGridRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isYou: boolean;
};

export default function AccessGrid({
  rows,
  organisationId,
  callerRole,
  canManage,
}: {
  rows: AccessGridRow[];
  organisationId: string;
  callerRole: Role;
  canManage: boolean;
}) {
  return (
    <DataGrid
      rows={rows}
      searchPlaceholder="Search people"
      searchText={(row) => `${row.name} ${row.email} ${roleLabel(row.role)}`}
      emptyLabel="No one has access to this organisation yet."
      toolbar={
        canManage ? <GrantAccessForm organisationId={organisationId} callerRole={callerRole} /> : null
      }
      columns={[
        {
          key: "name",
          label: "Name",
          sortValue: (row) => row.name,
          render: (row) => (row.isYou ? `${row.name} (you)` : row.name),
        },
        {
          key: "email",
          label: "Email",
          sortValue: (row) => row.email,
          render: (row) => row.email,
        },
        {
          key: "role",
          label: "Role",
          sortValue: (row) => row.role,
          render: (row) => roleLabel(row.role),
        },
      ]}
      actions={
        canManage
          ? (row) => (
              <form action={revokeAccess}>
                <input type="hidden" name="organisationId" value={organisationId} />
                <input type="hidden" name="userId" value={row.id} />
                <button
                  className={styles.quiet}
                  type="submit"
                  onClick={(event) => {
                    if (!window.confirm(`Remove ${row.name}?`)) event.preventDefault();
                  }}
                >
                  Remove
                </button>
              </form>
            )
          : undefined
      }
    />
  );
}
