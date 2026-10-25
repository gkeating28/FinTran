"use client";

import { useActionState, useEffect, useId, useState, type ChangeEvent } from "react";
import DataGrid from "@/components/DataGrid";
import { CreateOrganisationForm } from "@/components/Forms";
import FormModal from "@/components/FormModal";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import SchemeLookup from "@/components/SchemeLookup";
import { deleteOrganisation } from "@/lib/actions";
import { updateOrganisationDefaults } from "@/lib/currency-actions";
import type { InboundTypeChoice, OrganisationProfile } from "@/lib/currency-data";
import { currencyLabel, type CurrencyChoice } from "@/lib/currencies";
import { countryChoices, type CodeName } from "@/lib/code-lists";
import {
  ORGANISATION_LOGO_ACCEPT,
  ORGANISATION_LOGO_ERROR,
  ORGANISATION_LOGO_LIMIT,
} from "@/lib/organisation-logo";
import { canManage, roleLabel, type ActionState, type Role } from "@/lib/types";
import styles from "@/components/OpsPage.module.css";

export type OrganisationGridRow = {
  id: string;
  name: string;
  slug: string;
  role: Role;
  homeCurrencyId: string | null;
  currencies: CurrencyChoice[];
  profile: OrganisationProfile;
  logoUrl: string | null;
  hasDocuments: boolean;
  inboundInvoiceTypeId: string | null;
  inboundCreditNoteTypeId: string | null;
  purchaseTypes: InboundTypeChoice[];
};

export default function OrganisationGrid({
  rows,
  tenantId,
  canAdd,
  countries,
  schemes,
  currencies,
}: {
  rows: OrganisationGridRow[];
  tenantId: string;
  canAdd: boolean;
  countries: CodeName[];
  schemes: CodeName[];
  currencies: { code: string; name: string }[];
}) {
  const [editing, setEditing] = useState<OrganisationGridRow | null>(null);

  return (
    <div>
      <DataGrid
        rows={rows}
        searchPlaceholder="Search organisations"
        searchText={(row) => `${row.name} ${row.slug} ${roleLabel(row.role)} ${homeLabel(row)}`}
        emptyLabel="No organisations in this tenant."
        toolbar={canAdd ? <CreateOrganisationForm tenantId={tenantId} currencies={currencies} /> : null}
        columns={[
          {
            key: "name",
            label: "Organisation",
            sortValue: (row) => row.name,
            render: (row) => (
              <span>
                {row.name}
                {row.profile.addressNeedsReview ? <span className={styles.reviewBadge}>Needs review</span> : null}
              </span>
            ),
          },
          {
            key: "logo",
            label: "Logo",
            sortValue: (row) => (row.logoUrl ? "1" : "0"),
            render: (row) =>
              row.logoUrl ? <img src={row.logoUrl} alt="" className={styles.logoMark} /> : "—",
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
        actions={(row) =>
          canManage(row.role) ? (
            <button className={styles.quiet} type="button" onClick={() => setEditing(row)}>
              Edit
            </button>
          ) : null
        }
      />
      {editing ? (
        <OrganisationForm key={editing.id} organisation={editing} countries={countries} schemes={schemes} onClose={() => setEditing(null)} />
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
  countries,
  schemes,
  onClose,
}: {
  organisation: OrganisationGridRow;
  countries: CodeName[];
  schemes: CodeName[];
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
  const [addressLine1, setAddressLine1] = useState(organisation.profile.addressLine1);
  const [addressLine2, setAddressLine2] = useState(organisation.profile.addressLine2);
  const [addressLine3, setAddressLine3] = useState(organisation.profile.addressLine3);
  const [city, setCity] = useState(organisation.profile.city);
  const [postCode, setPostCode] = useState(organisation.profile.postCode);
  const [county, setCounty] = useState(organisation.profile.county);
  const [countryCode, setCountryCode] = useState(organisation.profile.countryCode || "IE");
  const [peppolScheme, setPeppolScheme] = useState(organisation.profile.peppolScheme);
  const [peppolId, setPeppolId] = useState(organisation.profile.peppolId);
  const [iban, setIban] = useState(organisation.profile.iban);
  const [bic, setBic] = useState(organisation.profile.bic);
  const [bankAccountName, setBankAccountName] = useState(organisation.profile.bankAccountName);
  const [bankingDetails, setBankingDetails] = useState(organisation.profile.bankingDetails);
  const orderedCountries = countryChoices(countries);
  const [lockDate, setLockDate] = useState(organisation.profile.lockDate);
  const [inboundInvoiceTypeId, setInboundInvoiceTypeId] = useState(organisation.inboundInvoiceTypeId ?? "");
  const [inboundCreditNoteTypeId, setInboundCreditNoteTypeId] = useState(organisation.inboundCreditNoteTypeId ?? "");
  const invoiceTypes = organisation.purchaseTypes.filter((type) => type.documentKind === "invoice");
  const creditTypes = organisation.purchaseTypes.filter((type) => type.documentKind === "credit_note");
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputId = useId();
  const formId = useId();
  const preview = filePreview ?? (removeLogo ? null : organisation.logoUrl);

  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  function onLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setFilePreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (!file) return;
    if (file.size > ORGANISATION_LOGO_LIMIT) {
      event.target.value = "";
      setLogoError(ORGANISATION_LOGO_ERROR);
      return;
    }
    setLogoError(null);
    setRemoveLogo(false);
    setFilePreview(URL.createObjectURL(file));
  }

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  const homeCurrencyNote = organisation.hasDocuments
    ? "The home currency cannot be changed once documents exist."
    : "Exchange rates are relative to the home currency. Check the other currencies after you change it.";

  return (
    <FormModal title={`Edit ${organisation.name}`} onClose={onClose} fillPage>
      <div className={`${styles.modalForm} ${styles.partyForm}`}>
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <div className={`${styles.partyFields} ${styles.wide}`}>
          <form id={formId} className={styles.displayContents} action={action} autoComplete="off" noValidate>
            <label className={styles.field}>
              Contact name
              <QuietInput
                name="contact_name"
                maxLength={200}
                autoFocus
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
              />
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
            <div className={styles.field}>
              <label htmlFor={logoInputId}>Logo</label>
              <div className={styles.logoControl}>
                {preview ? (
                  <img src={preview} alt="" className={styles.logoPreview} />
                ) : (
                  <span className={styles.logoEmpty}>No logo</span>
                )}
                <div className={styles.logoChoices}>
                  <input
                    id={logoInputId}
                    className={styles.logoInput}
                    type="file"
                    name="logo"
                    accept={ORGANISATION_LOGO_ACCEPT}
                    onChange={onLogoFile}
                  />
                  <span className={styles.panelMeta}>PNG, JPEG, WebP, or GIF. Up to 2 MB.</span>
                  {logoError ? (
                    <p className={styles.alert} role="alert">
                      {logoError}
                    </p>
                  ) : null}
                  {organisation.logoUrl ? (
                    <label className={styles.logoRemove}>
                      <input
                        type="checkbox"
                        name="remove_logo"
                        value="1"
                        checked={removeLogo}
                        onChange={(event) => {
                          setRemoveLogo(event.target.checked);
                          if (event.target.checked) {
                            const input = document.getElementById(logoInputId);
                            if (input instanceof HTMLInputElement) input.value = "";
                            setFilePreview((current) => {
                              if (current) URL.revokeObjectURL(current);
                              return null;
                            });
                            setLogoError(null);
                          }
                        }}
                      />
                      Remove logo
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
            <label className={styles.field}>
              Home currency
              <select
                name={organisation.hasDocuments ? undefined : "home_currency_id"}
                required
                autoComplete="off"
                value={homeCurrency}
                onChange={(event) => setHomeCurrency(event.target.value)}
                disabled={organisation.currencies.length === 0 || organisation.hasDocuments}
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
              {organisation.hasDocuments ? <input type="hidden" name="home_currency_id" value={organisation.homeCurrencyId ?? ""} /> : null}
              <span className={styles.panelMeta}>{homeCurrencyNote}</span>
              {organisation.currencies.length === 0 ? (
                <span className={styles.panelMeta}>Add a currency for this organisation before choosing a home currency.</span>
              ) : null}
            </label>
            <label className={styles.field}>
              Phone
              <QuietInput
                name="phone"
                maxLength={40}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+353 1 555 0100"
              />
            </label>
            <label className={styles.field}>
              Website
              <QuietInput
                name="website"
                maxLength={200}
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://example.com"
              />
            </label>
            <div className={styles.fieldPair}>
              <label className={styles.field}>
                VAT number
                <QuietInput
                  name="vat_number"
                  maxLength={16}
                  value={vatNumber}
                  onChange={(event) => setVatNumber(event.target.value)}
                  placeholder="IE1234567T"
                  className={styles.mono}
                />
              </label>
              <label className={styles.field}>
                Company number
                <QuietInput
                  name="company_number"
                  maxLength={40}
                  value={companyNumber}
                  onChange={(event) => setCompanyNumber(event.target.value)}
                  className={styles.mono}
                />
              </label>
              <span className={`${styles.panelMeta} ${styles.wide}`}>Country prefix and number, for example IE1234567T.</span>
            </div>
            <div className={styles.fieldPair}>
              <label className={styles.field}>
                Post code
                <QuietInput
                  name="post_code"
                  maxLength={20}
                  value={postCode}
                  onChange={(event) => setPostCode(event.target.value)}
                  className={styles.mono}
                />
              </label>
              <label className={styles.field}>
                Country
                <select name="country_code" autoComplete="off" value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                  {orderedCountries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={styles.field}>
              <span>
                Address line 1
                {organisation.profile.addressNeedsReview ? <span className={styles.reviewBadge}>Needs review</span> : null}
              </span>
              <QuietInput name="address_line1" maxLength={100} value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} />
            </label>
            <label className={styles.field}>
              Address line 2
              <QuietInput name="address_line2" maxLength={100} value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} />
            </label>
            <label className={styles.field}>
              Address line 3
              <QuietInput name="address_line3" maxLength={100} value={addressLine3} onChange={(event) => setAddressLine3(event.target.value)} />
            </label>
            <label className={styles.field}>
              City
              <QuietInput name="city" maxLength={60} value={city} onChange={(event) => setCity(event.target.value)} />
            </label>
            <label className={styles.field}>
              County
              <QuietInput name="county" maxLength={60} value={county} onChange={(event) => setCounty(event.target.value)} />
            </label>
            <div className={styles.fieldPair}>
              <label className={styles.field}>
                Peppol scheme
                <SchemeLookup schemes={schemes} value={peppolScheme} onChange={setPeppolScheme} />
              </label>
              <label className={styles.field}>
                Peppol ID
                <QuietInput
                  name="peppol_id"
                  maxLength={100}
                  value={peppolId}
                  onChange={(event) => setPeppolId(event.target.value)}
                  className={styles.mono}
                />
              </label>
            </div>
            <label className={styles.field}>
              IBAN
              <QuietInput
                name="iban"
                maxLength={42}
                value={iban}
                onChange={(event) => setIban(event.target.value)}
                placeholder="IE29AIBK93115212345678"
                className={styles.mono}
              />
            </label>
            <label className={styles.field}>
              BIC
              <QuietInput
                name="bic"
                maxLength={11}
                value={bic}
                onChange={(event) => setBic(event.target.value)}
                placeholder="AIBKIE2D"
                className={styles.mono}
              />
            </label>
            <label className={styles.field}>
              Account name
              <QuietInput
                name="bank_account_name"
                maxLength={100}
                value={bankAccountName}
                onChange={(event) => setBankAccountName(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              Lock date
              <QuietInput name="lock_date" type="date" value={lockDate} onChange={(event) => setLockDate(event.target.value)} />
              <span className={styles.panelMeta}>Documents on or before this date cannot be entered, posted, voided, or removed.</span>
            </label>
            <label className={styles.field}>
              Inbound invoice type
              <select
                name="inbound_invoice_type_id"
                value={inboundInvoiceTypeId}
                onChange={(event) => setInboundInvoiceTypeId(event.target.value)}
              >
                <option value="">Not set</option>
                {invoiceTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.code} {type.description}
                  </option>
                ))}
              </select>
              <span className={styles.panelMeta}>Purchases invoice type used when a received e-invoice is imported.</span>
            </label>
            <label className={styles.field}>
              Inbound credit note type
              <select
                name="inbound_credit_note_type_id"
                value={inboundCreditNoteTypeId}
                onChange={(event) => setInboundCreditNoteTypeId(event.target.value)}
              >
                <option value="">Not set</option>
                {creditTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.code} {type.description}
                  </option>
                ))}
              </select>
              <span className={styles.panelMeta}>Purchases credit note type used when a received e-credit note is imported.</span>
            </label>
            <label className={`${styles.field} ${styles.wide}`}>
              Banking details
              <QuietTextarea
                name="banking_details"
                maxLength={1000}
                rows={3}
                value={bankingDetails}
                onChange={(event) => setBankingDetails(event.target.value)}
              />
              <span className={styles.panelMeta}>Printed as written. IBAN, BIC, and account name are stored separately.</span>
            </label>
            <input type="hidden" name="organisation_id" value={organisation.id} />
          </form>
          {organisation.role === "owner" ? <DeleteOrganisationForm organisation={organisation} /> : null}
        </div>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.primary}
            type="submit"
            form={formId}
            disabled={pending || organisation.currencies.length === 0}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </FormModal>
  );
}

function DeleteOrganisationForm({ organisation }: { organisation: OrganisationGridRow }) {
  const [state, action, pending] = useActionState(deleteOrganisation, {} as ActionState);
  const [confirmation, setConfirmation] = useState("");

  return (
    <form className={`${styles.voidBar} ${styles.wide}`} action={action} autoComplete="off" noValidate>
      <input type="hidden" name="organisationId" value={organisation.id} />
      <input type="hidden" name="organisationName" value={organisation.name} />
      {state.error ? (
        <p className={styles.alert} role="alert">
          {state.error}
        </p>
      ) : null}
      <label className={styles.field}>
        Delete organisation
        <QuietInput
          name="confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={`Type ${organisation.name}`}
        />
      </label>
      <button className={styles.quiet} type="submit" disabled={pending || confirmation !== organisation.name}>
        {pending ? "Deleting…" : "Delete"}
      </button>
    </form>
  );
}
