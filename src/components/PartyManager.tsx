"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CodeField } from "@/components/CodeField";
import ConfirmSubmitButton from "@/components/ConfirmDialog";
import type { ExportField } from "@/components/GridExport";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import SchemeLookup from "@/components/SchemeLookup";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import { formatPostalAddress } from "@/lib/address";
import { createParty, deleteParty, updateParty } from "@/lib/party-actions";
import { PARTY_META, type PartyCurrency, type PartyKind, type PartyRow } from "@/lib/parties";
import { countryChoices, type CodeName } from "@/lib/code-lists";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { exact, slot } from "@/components/recordForm";
import type { ActionState } from "@/lib/types";

const PARTY_EXPORT_FIELDS: ExportField<PartyRow>[] = [
  { key: "addressLine1", label: "Address line 1", value: (row) => row.addressLine1 },
  { key: "addressLine2", label: "Address line 2", value: (row) => row.addressLine2 },
  { key: "addressLine3", label: "Address line 3", value: (row) => row.addressLine3 },
  { key: "city", label: "City", value: (row) => row.city },
  { key: "county", label: "County", value: (row) => row.county },
  { key: "postCode", label: "Post code", value: (row) => row.postCode },
  { key: "countryCode", label: "Country", value: (row) => row.countryCode },
  { key: "phone", label: "Phone", value: (row) => row.phone },
  { key: "email", label: "Email", value: (row) => row.email },
  { key: "website", label: "Website", value: (row) => row.website },
  { key: "contactDetails", label: "Contact details", value: (row) => row.contactDetails },
  { key: "vatNumber", label: "VAT number", value: (row) => row.vatNumber },
  { key: "companyNumber", label: "Company number", value: (row) => row.companyNumber },
  { key: "peppolScheme", label: "Peppol scheme", value: (row) => row.peppolScheme },
  { key: "peppolId", label: "Peppol ID", value: (row) => row.peppolId },
  { key: "paymentTermsDays", label: "Payment terms (days)", value: (row) => row.paymentTermsDays, type: "number" },
  { key: "defaultBuyerReference", label: "Default buyer reference", value: (row) => row.defaultBuyerReference },
  { key: "notes", label: "Notes", value: (row) => row.notes },
];

export default function PartyManager({
  kind,
  rows,
  currencies,
  countries,
  schemes,
  homeCurrencyId,
  organisationName,
  loadError,
  actionError,
}: {
  kind: PartyKind;
  rows: PartyRow[];
  currencies: PartyCurrency[];
  countries: CodeName[];
  schemes: CodeName[];
  homeCurrencyId: string | null;
  organisationName: string;
  loadError: string | null;
  actionError?: string;
}) {
  const meta = PARTY_META[kind];
  const remove = deleteParty.bind(null, kind);
  const [draft, setDraft] = useState<PartyRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{meta.title}</h1>
        <p className={styles.lede}>{meta.title} for {organisationName}.</p>
      </div>
      {loadError ? (
        <p className={styles.alert} role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.alert} role="alert">
          {actionError}
        </p>
      ) : null}
      <DataGrid
        form={kind}
        exportFields={PARTY_EXPORT_FIELDS}
        onOpen={setDraft}
        rows={rows}
        searchPlaceholder={`Search ${meta.title.toLowerCase()}`}
        searchText={(row) =>
          `${row.code} ${row.name} ${row.currencyCode} ${row.phone} ${row.email} ${row.website} ${formatPostalAddress(row)} ${row.contactDetails} ${row.notes} ${row.vatNumber} ${row.peppolId}`
        }
        emptyLabel={`No ${meta.title.toLowerCase()} yet for this organisation.`}
        toolbar={
          <button className={styles.primary} type="button" onClick={() => setDraft("new")}>
            Add
          </button>
        }
        actionsWidth="16%"
        columns={[
          {
            key: "code",
            label: "Code",
            mono: true,
            width: "12%",
            sortValue: (row) => row.code,
            render: (row) => row.code,
          },
          {
            key: "name",
            label: "Name",
            width: "20%",
            sortValue: (row) => row.name,
            render: (row) => (
              <span>
                {row.name}
                {row.addressNeedsReview ? <span className={styles.reviewBadge}>Needs review</span> : null}
              </span>
            ),
          },
          {
            key: "currency",
            label: "Currency",
            mono: true,
            width: "12%",
            sortValue: (row) => row.currencyCode,
            render: (row) => row.currencyCode,
          },
          {
            key: "phone",
            label: "Phone",
            width: "18%",
            sortValue: (row) => row.phone,
            render: (row) => row.phone,
          },
          {
            key: "email",
            label: "Email",
            width: "22%",
            sortValue: (row) => row.email,
            render: (row) => row.email,
          },
        ]}
        actions={(row) => (
          <>
            <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
              Edit
            </button>
            <form action={remove}>
              <input type="hidden" name="id" value={row.id} />
              <ConfirmSubmitButton
                className={styles.quiet}
                title={`Remove ${row.code}?`}
                message="It will be removed from this organisation."
              >
                Remove
              </ConfirmSubmitButton>
            </form>
          </>
        )}
      />
      {draft ? (
        <PartyForm
          key={draft === "new" ? "new" : draft.id}
          kind={kind}
          row={draft === "new" ? null : draft}
          currencies={currencies}
          countries={countries}
          schemes={schemes}
          homeCurrencyId={homeCurrencyId}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

export function PartyForm({
  kind,
  row,
  currencies,
  countries,
  schemes,
  homeCurrencyId,
  onClose,
  seed = null,
  notice = null,
  blockSave = false,
  onSaved,
}: {
  kind: PartyKind;
  row: PartyRow | null;
  currencies: PartyCurrency[];
  countries: CodeName[];
  schemes: CodeName[];
  homeCurrencyId: string | null;
  onClose: () => void;
  seed?: Partial<PartyRow> | null;
  notice?: string | null;
  blockSave?: boolean;
  onSaved?: (code: string) => void;
}) {
  const meta = PARTY_META[kind];
  const save = row ? updateParty.bind(null, kind) : createParty.bind(null, kind);
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [code, setCode] = useState(row?.code ?? seed?.code ?? "");
  const [name, setName] = useState(row?.name ?? seed?.name ?? "");
  const [currencyId, setCurrencyId] = useState(
    row?.currencyId ?? seed?.currencyId ?? homeCurrencyId ?? (currencies.length === 1 ? currencies[0].id : ""),
  );
  const [phone, setPhone] = useState(row?.phone ?? seed?.phone ?? "");
  const [email, setEmail] = useState(row?.email ?? seed?.email ?? "");
  const [website, setWebsite] = useState(row?.website ?? "");
  const [addressLine1, setAddressLine1] = useState(row?.addressLine1 ?? seed?.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(row?.addressLine2 ?? seed?.addressLine2 ?? "");
  const [addressLine3, setAddressLine3] = useState(row?.addressLine3 ?? seed?.addressLine3 ?? "");
  const [city, setCity] = useState(row?.city ?? seed?.city ?? "");
  const [postCode, setPostCode] = useState(row?.postCode ?? seed?.postCode ?? "");
  const [county, setCounty] = useState(row?.county ?? seed?.county ?? "");
  const [countryCode, setCountryCode] = useState(row?.countryCode ?? seed?.countryCode ?? "IE");
  const [contactDetails, setContactDetails] = useState(row?.contactDetails ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [vatNumber, setVatNumber] = useState(row?.vatNumber ?? seed?.vatNumber ?? "");
  const [companyNumber, setCompanyNumber] = useState(row?.companyNumber ?? seed?.companyNumber ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(row?.paymentTermsDays ?? seed?.paymentTermsDays ?? "");
  const [defaultBuyerReference, setDefaultBuyerReference] = useState(row?.defaultBuyerReference ?? "");
  const [peppolScheme, setPeppolScheme] = useState(row?.peppolScheme ?? seed?.peppolScheme ?? "");
  const [peppolId, setPeppolId] = useState(row?.peppolId ?? seed?.peppolId ?? "");
  const orderedCountries = countryChoices(countries);

  const saved = useRef(false);
  useEffect(() => {
    if (!state.message || saved.current) return;
    saved.current = true;
    onSaved?.(code);
    onClose();
  }, [state.message, onClose, onSaved, code]);

  return (
    <FormModal
      title={row ? `Edit ${meta.singular}` : `Add ${meta.singular}`}
      onClose={onClose}
      fillPage
    >
      <form className={`${styles.modalForm} ${styles.partyForm}`} action={action} autoComplete="off" noValidate>
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        {notice ? <p className={styles.alert}>{notice} <a href="/currencies">Add a currency</a></p> : null}
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <div className={recordStyles.layout}>
          {/* Left column */}
          <div className={`${recordStyles.row} ${slot("left", 1)}`}>
            <CodeField
              locked={Boolean(row)}
              value={code}
              onChange={setCode}
              maxLength={20}
              autoFocus={!row}
              className={recordStyles.fixed}
              style={exact("var(--code-w)")}
            />
            <label className={recordStyles.grow}>
              Name
              <QuietInput
                name="name"
                required
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <div className={slot("left", 2)}>
            <div className={recordStyles.row}>
              <label className={recordStyles.fixed} style={exact("calc(var(--code-w) - var(--terms-w) - var(--field-gap))")}>
                Currency
                <select
                  name="currency_id"
                  required
                  autoComplete="off"
                  value={currencyId}
                  onChange={(event) => setCurrencyId(event.target.value)}
                  disabled={currencies.length === 0}
                >
                  <option value="" disabled></option>
                  {currencies.map((currency) => (
                    <option key={currency.id} value={currency.id}>
                      {currency.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className={recordStyles.fixed} style={exact("var(--terms-w)")}>
                Payment terms (days)
                <QuietInput
                  name="payment_terms_days"
                  inputMode="numeric"
                  maxLength={3}
                  autoComplete="off"
                  value={paymentTermsDays}
                  onChange={(event) => setPaymentTermsDays(event.target.value)}
                />
              </label>
              {kind === "customers" ? (
                <label className={recordStyles.grow}>
                  Buyer reference
                  <QuietInput
                    name="default_buyer_reference"
                    maxLength={100}
                    autoComplete="off"
                    spellCheck={false}
                    value={defaultBuyerReference}
                    onChange={(event) => setDefaultBuyerReference(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            {currencies.length === 0 ? (
              <span className={styles.panelMeta}>Add a currency for this organisation before saving.</span>
            ) : null}
          </div>
          <div className={`${recordStyles.row} ${slot("left", 3)}`}>
            <label className={recordStyles.grow}>
              <span>
                Address line 1
                {row?.addressNeedsReview ? <span className={styles.reviewBadge}>Needs review</span> : null}
              </span>
              <QuietInput name="address_line1" maxLength={100} autoComplete="off" spellCheck={false} value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} />
            </label>
          </div>
          <div className={`${recordStyles.row} ${slot("left", 4)}`}>
            <label className={recordStyles.grow}>
              Address line 2
              <QuietInput name="address_line2" maxLength={100} autoComplete="off" spellCheck={false} value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} />
            </label>
          </div>
          <div className={`${recordStyles.row} ${slot("left", 5)}`}>
            <label className={recordStyles.grow}>
              Address line 3
              <QuietInput name="address_line3" maxLength={100} autoComplete="off" spellCheck={false} value={addressLine3} onChange={(event) => setAddressLine3(event.target.value)} />
            </label>
          </div>
          <div className={`${recordStyles.pair} ${slot("left", 6)}`}>
            <label className={recordStyles.cell}>
              City
              <QuietInput name="city" maxLength={60} autoComplete="off" spellCheck={false} value={city} onChange={(event) => setCity(event.target.value)} />
            </label>
            <label className={recordStyles.cell}>
              County
              <QuietInput name="county" maxLength={60} autoComplete="off" spellCheck={false} value={county} onChange={(event) => setCounty(event.target.value)} />
            </label>
          </div>
          <div className={`${recordStyles.pair} ${slot("left", 7)}`}>
            <label className={recordStyles.cell}>
              Post code
              <QuietInput name="post_code" maxLength={20} autoComplete="off" spellCheck={false} value={postCode} onChange={(event) => setPostCode(event.target.value)} className={styles.mono} />
            </label>
            <label className={recordStyles.cell}>
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

          {/* Right column */}
          <div className={`${recordStyles.row} ${slot("right", 1)}`}>
            <label className={recordStyles.grow}>
              Email
              <QuietInput
                name="email"
                type="text"
                inputMode="email"
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>
          <div className={`${recordStyles.pair} ${slot("right", 2)}`}>
            <label className={recordStyles.cell}>
              Phone
              <QuietInput
                name="phone"
                maxLength={40}
                autoComplete="off"
                spellCheck={false}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
            <label className={recordStyles.cell}>
              Website
              <QuietInput
                name="website"
                maxLength={200}
                autoComplete="off"
                spellCheck={false}
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
          </div>
          <label className={`${recordStyles.cell} ${recordStyles.right} ${recordStyles.tall}`}>
            Contact details
            <QuietTextarea
              name="contact_details"
              maxLength={500}
              rows={3}
              autoComplete="off"
              spellCheck
              value={contactDetails}
              onChange={(event) => setContactDetails(event.target.value)}
            />
          </label>

          <div className={`${recordStyles.pair} ${slot("right", 6)}`}>
            <label className={recordStyles.cell}>
              VAT number
              <QuietInput
                name="vat_number"
                maxLength={16}
                autoComplete="off"
                spellCheck={false}
                value={vatNumber}
                onChange={(event) => setVatNumber(event.target.value)}
                className={styles.mono}
              />
            </label>
            <label className={recordStyles.cell}>
              Company number
              <QuietInput
                name="company_number"
                maxLength={40}
                autoComplete="off"
                spellCheck={false}
                value={companyNumber}
                onChange={(event) => setCompanyNumber(event.target.value)}
                className={styles.mono}
              />
            </label>
          </div>
          <div className={`${recordStyles.pair} ${slot("right", 7)}`}>
            <label className={recordStyles.cell}>
              Peppol scheme
              <SchemeLookup schemes={schemes} value={peppolScheme} onChange={setPeppolScheme} />
            </label>
            <label className={recordStyles.cell}>
              Peppol ID
              <QuietInput name="peppol_id" maxLength={100} autoComplete="off" spellCheck={false} value={peppolId} onChange={(event) => setPeppolId(event.target.value)} className={styles.mono} />
            </label>
          </div>

          {/* Notes run under both columns, full width */}
          <label className={`${recordStyles.cell} ${slot("left", 8, recordStyles.wideCell)}`}>
            Notes
            <QuietTextarea
              name="notes"
              maxLength={4000}
              rows={4}
              autoComplete="off"
              spellCheck
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} type="submit" disabled={pending || currencies.length === 0 || blockSave}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
