"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import { CreateOrganisationForm } from "@/components/Forms";
import FormModal from "@/components/FormModal";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import { updateOrganisationDefaults } from "@/lib/currency-actions";
import type { OrganisationProfile } from "@/lib/currency-data";
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
  profile: OrganisationProfile;
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
  const [contactName, setContactName] = useState(organisation.profile.contactName);
  const [contactEmail, setContactEmail] = useState(organisation.profile.contactEmail);
  const [phone, setPhone] = useState(organisation.profile.phone);
  const [website, setWebsite] = useState(organisation.profile.website);
  const [vatNumber, setVatNumber] = useState(organisation.profile.vatNumber);
  const [companyNumber, setCompanyNumber] = useState(organisation.profile.companyNumber);
  const [address, setAddress] = useState(organisation.profile.address);
  const [bankingDetails, setBankingDetails] = useState(organisation.profile.bankingDetails);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title={`Edit ${organisation.name}`} onClose={onClose} className={styles.partyDialog}>
      <form className={`${styles.modalForm} ${styles.partyForm}`} action={action} autoComplete="off" noValidate>
        <input type="hidden" name="organisation_id" value={organisation.id} />
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <label className={`${styles.field} ${styles.wide}`}>
          Home currency
          <select
            name="home_currency_id"
            required
            autoComplete="off"
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
          <p className={`${styles.panelMeta} ${styles.wide}`}>Add a currency for this organisation before choosing a home currency.</p>
        ) : null}
        <label className={styles.field}>
          Contact name
          <QuietInput name="contact_name" maxLength={200} value={contactName} onChange={(event) => setContactName(event.target.value)} />
        </label>
        <label className={styles.field}>
          Contact email
          <QuietInput
            name="contact_email"
            type="text"
            inputMode="email"
            maxLength={200}
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Phone number
          <QuietInput name="phone" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label className={styles.field}>
          Web URL
          <QuietInput name="website" maxLength={200} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://example.com" />
        </label>
        <label className={styles.field}>
          VAT registration number
          <QuietInput name="vat_number" maxLength={40} value={vatNumber} onChange={(event) => setVatNumber(event.target.value)} className={styles.mono} />
        </label>
        <label className={styles.field}>
          Company reg. number
          <QuietInput name="company_number" maxLength={40} value={companyNumber} onChange={(event) => setCompanyNumber(event.target.value)} className={styles.mono} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Address
          <QuietTextarea name="address" maxLength={500} rows={4} value={address} onChange={(event) => setAddress(event.target.value)} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Banking details
          <QuietTextarea name="banking_details" maxLength={1000} rows={4} value={bankingDetails} onChange={(event) => setBankingDetails(event.target.value)} />
        </label>
        <div className={`${styles.modalActions} ${styles.wide}`}>
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
