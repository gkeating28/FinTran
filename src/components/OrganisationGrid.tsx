"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import { CreateOrganisationForm } from "@/components/Forms";
import FormModal from "@/components/FormModal";
import { updateOrganisationDefaults } from "@/lib/currency-actions";
import { currencyLabel, type CurrencyChoice } from "@/lib/currencies";
import { roleLabel, type ActionState, type Role } from "@/lib/types";
import styles from "@/components/OpsPage.module.css";

export type OrganisationGridRow = {
  id: string;
  name: string;
  slug: string;
  role: Role;
  homeCurrencyId: string | null;
  currencies: CurrencyChoice[];
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
  const [editing, setEditing] = useState<OrganisationGridRow | null>(null);

  return (
    <div>
      <DataGrid
        rows={rows}
        searchPlaceholder="Search organisations"
        searchText={(row) => `${row.name} ${row.slug} ${roleLabel(row.role)} ${homeLabel(row)}`}
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
          {
            key: "homeCurrency",
            label: "Home currency",
            sortValue: (row) => homeLabel(row),
            render: (row) => homeLabel(row),
          },
        ]}
        actions={(row) => (
          <button className={styles.quiet} type="button" onClick={() => setEditing(row)}>
            Edit
          </button>
        )}
      />
      {editing ? (
        <OrganisationForm key={editing.id} organisation={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function homeLabel(row: OrganisationGridRow) {
  const home = row.currencies.find((currency) => currency.id === row.homeCurrencyId);
  return home ? currencyLabel(home) : "Not set";
}

function OrganisationForm({
  organisation,
  onClose,
}: {
  organisation: OrganisationGridRow;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(updateOrganisationDefaults, {} as ActionState);
  const [homeCurrency, setHomeCurrency] = useState(organisation.homeCurrencyId ?? "");

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title={`Edit ${organisation.name}`} onClose={onClose}>
      <form className={styles.modalForm} action={action}>
        <input type="hidden" name="organisation_id" value={organisation.id} />
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <label className={styles.field}>
          Home currency
          <select
            name="home_currency_id"
            required
            value={homeCurrency}
            onChange={(event) => setHomeCurrency(event.target.value)}
            disabled={organisation.currencies.length === 0}
          >
            <option value="" disabled>
              Choose a home currency
            </option>
            {organisation.currencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currencyLabel(currency)}
              </option>
            ))}
          </select>
        </label>
        {organisation.currencies.length === 0 ? (
          <p className={styles.panelMeta}>Add a currency for this organisation before choosing a home currency.</p>
        ) : null}
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.primary}
            type="submit"
            disabled={pending || organisation.currencies.length === 0}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
