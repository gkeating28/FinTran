"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import SchemeLookup from "@/components/SchemeLookup";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import { formatPostalAddress } from "@/lib/address";
import { createParty, deleteParty, updateParty } from "@/lib/party-actions";
import { PARTY_META, type PartyCurrency, type PartyKind, type PartyRow } from "@/lib/parties";
import { countryChoices, type CodeName } from "@/lib/code-lists";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function PartyManager({
  kind,
  rows,
  currencies,
  countries,
  schemes,
  homeCurrencyId,
  loadError,
  actionError,
}: {
  kind: PartyKind;
  rows: PartyRow[];
  currencies: PartyCurrency[];
  countries: CodeName[];
  schemes: CodeName[];
  homeCurrencyId: string | null;
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
        <p className={styles.lede}>{meta.lede}</p>
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
              <button
                className={styles.quiet}
                type="submit"
                onClick={(event) => {
                  if (!window.confirm(`Remove ${row.code}?`)) event.preventDefault();
                }}
              >
                Remove
              </button>
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

function PartyForm({
  kind,
  row,
  currencies,
  countries,
  schemes,
  homeCurrencyId,
  onClose,
}: {
  kind: PartyKind;
  row: PartyRow | null;
  currencies: PartyCurrency[];
  countries: CodeName[];
  schemes: CodeName[];
  homeCurrencyId: string | null;
  onClose: () => void;
}) {
  const meta = PARTY_META[kind];
  const save = row ? updateParty.bind(null, kind) : createParty.bind(null, kind);
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [code, setCode] = useState(row?.code ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [currencyId, setCurrencyId] = useState(
    row?.currencyId ?? homeCurrencyId ?? (currencies.length === 1 ? currencies[0].id : ""),
  );
  const [phone, setPhone] = useState(row?.phone ?? "");
  const [email, setEmail] = useState(row?.email ?? "");
  const [website, setWebsite] = useState(row?.website ?? "");
  const [addressLine1, setAddressLine1] = useState(row?.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(row?.addressLine2 ?? "");
  const [addressLine3, setAddressLine3] = useState(row?.addressLine3 ?? "");
  const [city, setCity] = useState(row?.city ?? "");
  const [postCode, setPostCode] = useState(row?.postCode ?? "");
  const [county, setCounty] = useState(row?.county ?? "");
  const [countryCode, setCountryCode] = useState(row?.countryCode ?? "IE");
  const [contactDetails, setContactDetails] = useState(row?.contactDetails ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");
  const [vatNumber, setVatNumber] = useState(row?.vatNumber ?? "");
  const [companyNumber, setCompanyNumber] = useState(row?.companyNumber ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(row?.paymentTermsDays ?? "");
  const [defaultBuyerReference, setDefaultBuyerReference] = useState(row?.defaultBuyerReference ?? "");
  const [peppolScheme, setPeppolScheme] = useState(row?.peppolScheme ?? "");
  const [peppolId, setPeppolId] = useState(row?.peppolId ?? "");
  const orderedCountries = countryChoices(countries);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal
      title={row ? `Edit ${meta.singular}` : `Add ${meta.singular}`}
      onClose={onClose}
      fillPage
    >
      <form className={`${styles.modalForm} ${styles.partyForm}`} action={action} autoComplete="off" noValidate>
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <label className={styles.field}>
          Code
          <QuietInput
            name="code"
            required
            maxLength={20}
            autoComplete="off"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="1000"
            className={styles.mono}
            style={{ textTransform: "uppercase" }}
          />
        </label>
        <label className={styles.field}>
          Name
          <QuietInput
            name="name"
            required
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Northwind Traders"
          />
        </label>
        <label className={styles.field}>
          Currency
          <select
            name="currency_id"
            required
            autoComplete="off"
            value={currencyId}
            onChange={(event) => setCurrencyId(event.target.value)}
            disabled={currencies.length === 0}
          >
            <option value="" disabled>
              Choose a currency
            </option>
            {currencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currency.code}
              </option>
            ))}
          </select>
          {currencies.length === 0 ? (
            <span className={styles.panelMeta}>Add a currency for this organisation before saving.</span>
          ) : null}
        </label>
        <label className={styles.field}>
          VAT number
          <QuietInput
            name="vat_number"
            maxLength={16}
            autoComplete="off"
            spellCheck={false}
            value={vatNumber}
            onChange={(event) => setVatNumber(event.target.value)}
            placeholder="IE1234567T"
            className={styles.mono}
          />
          <span className={styles.panelMeta}>Country prefix and number, for example IE1234567T.</span>
        </label>
        <label className={styles.field}>
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
        <label className={styles.field}>
          Payment terms (days)
          <QuietInput
            name="payment_terms_days"
            inputMode="numeric"
            maxLength={3}
            autoComplete="off"
            value={paymentTermsDays}
            onChange={(event) => setPaymentTermsDays(event.target.value)}
            placeholder="30"
          />
        </label>
        {kind === "customers" ? (
          <label className={styles.field}>
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
        <label className={styles.field}>
          Phone
          <QuietInput
            name="phone"
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+353 1 555 0100"
          />
        </label>
        <label className={styles.field}>
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
            placeholder="accounts@northwind.example"
          />
        </label>
        <label className={styles.field}>
          Website
          <QuietInput
            name="website"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://northwind.example"
          />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          <span>
            Address line 1
            {row?.addressNeedsReview ? <span className={styles.reviewBadge}>Needs review</span> : null}
          </span>
          <QuietInput name="address_line1" maxLength={100} autoComplete="off" spellCheck={false} value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Address line 2
          <QuietInput name="address_line2" maxLength={100} autoComplete="off" spellCheck={false} value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Address line 3
          <QuietInput name="address_line3" maxLength={100} autoComplete="off" spellCheck={false} value={addressLine3} onChange={(event) => setAddressLine3(event.target.value)} />
        </label>
        <label className={styles.field}>
          City
          <QuietInput name="city" maxLength={60} autoComplete="off" spellCheck={false} value={city} onChange={(event) => setCity(event.target.value)} />
        </label>
        <label className={styles.field}>
          Post code
          <QuietInput name="post_code" maxLength={20} autoComplete="off" spellCheck={false} value={postCode} onChange={(event) => setPostCode(event.target.value)} className={styles.mono} />
        </label>
        <label className={styles.field}>
          County
          <QuietInput name="county" maxLength={60} autoComplete="off" spellCheck={false} value={county} onChange={(event) => setCounty(event.target.value)} />
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
        <label className={styles.field}>
          Peppol scheme
          <SchemeLookup schemes={schemes} value={peppolScheme} onChange={setPeppolScheme} />
        </label>
        <label className={styles.field}>
          Peppol ID
          <QuietInput name="peppol_id" maxLength={100} autoComplete="off" spellCheck={false} value={peppolId} onChange={(event) => setPeppolId(event.target.value)} className={styles.mono} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Contact details
          <QuietTextarea
            name="contact_details"
            maxLength={500}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            value={contactDetails}
            onChange={(event) => setContactDetails(event.target.value)}
            placeholder="Accounts, Jane Murphy"
          />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Notes
          <QuietTextarea
            name="notes"
            maxLength={4000}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Delivery notes or anything else to keep with this record."
          />
        </label>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} type="submit" disabled={pending || currencies.length === 0}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
