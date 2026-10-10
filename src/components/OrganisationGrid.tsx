"use client";

import { CreateOrganisationForm } from "@/components/Forms";
import DataGrid from "@/components/DataGrid";
import { roleLabel, type Role } from "@/lib/types";

export type OrganisationGridRow = {
  id: string;
  name: string;
  slug: string;
  role: Role;
};

export default function OrganisationGrid({
  rows,
  tenantId,
  canAdd,
}: {
  rows: OrganisationGridRow[];
  tenantId: string;
  canAdd: boolean;
}) {
  return (
    <DataGrid
      rows={rows}
      searchPlaceholder="Search organisations"
      searchText={(row) => `${row.name} ${row.slug} ${roleLabel(row.role)}`}
      emptyLabel="No organisations in this tenant."
      toolbar={canAdd ? <CreateOrganisationForm tenantId={tenantId} /> : null}
      columns={[
        {
          key: "name",
          label: "Organisation",
          sortValue: (row) => row.name,
          render: (row) => row.name,
        },
        {
          key: "slug",
          label: "Slug",
          mono: true,
          sortValue: (row) => row.slug,
          render: (row) => row.slug,
        },
        {
          key: "role",
          label: "Your role",
          sortValue: (row) => row.role,
          render: (row) => roleLabel(row.role),
        },
      ]}
    />
  );
}
