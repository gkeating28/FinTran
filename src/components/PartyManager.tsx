"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { createParty, deleteParty, updateParty } from "@/lib/party-actions";
import { PARTY_META, type PartyCurrency, type PartyKind, type PartyRow } from "@/lib/parties";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function PartyManager({
  kind,
  rows,
  currencies,
  homeCurrencyId,
  loadError,
  actionError,
}: {
  kind: PartyKind;
  rows: PartyRow[];
  currencies: PartyCurrency[];
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
          `${row.code} ${row.name} ${row.currencyCode} ${row.phone} ${row.email} ${row.website} ${row.address} ${row.contactDetails} ${row.notes}`
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
            render: (row) => row.name,
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
  homeCurrencyId,
  onClose,
}: {
  kind: PartyKind;
  row: PartyRow | null;
  currencies: PartyCurrency[];
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
  const [address, setAddress] = useState(row?.address ?? "");
  const [contactDetails, setContactDetails] = useState(row?.contactDetails ?? "");
  const [notes, setNotes] = useState(row?.notes ?? "");

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal
      title={row ? `Edit ${meta.singular}` : `Add ${meta.singular}`}
      onClose={onClose}
      className={styles.partyDialog}
    >
      <form className={`${styles.modalForm} ${styles.partyForm}`} action={action} autoComplete="off">
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <label className={styles.field}>
          Code
          <input
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
          <input
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
          Phone
          <input
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
          <input
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
          <input
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
          Address
          <textarea
            name="address"
            maxLength={500}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="1 Dock Street, Dublin"
          />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Contact details
          <textarea
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
          <textarea
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
