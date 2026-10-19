"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { createCurrency, deleteCurrency, updateCurrency } from "@/lib/currency-actions";
import { formatCurrencyRate, parseCurrencyRate, type CurrencyRow } from "@/lib/currencies";
import type { CodeName } from "@/lib/reference-data";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function CurrencyManager({
  rows,
  isoCurrencies,
  loadError,
  actionError,
  canEdit = true,
}: {
  rows: CurrencyRow[];
  isoCurrencies: CodeName[];
  loadError: string | null;
  actionError?: string;
  canEdit?: boolean;
}) {
  const [draft, setDraft] = useState<CurrencyRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Currencies</h1>
        <p className={styles.lede}>
          Currencies for this organisation. Each has a code, a name, and a rate against the home
          currency. The home currency is set when you edit the organisation.
        </p>
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
        searchPlaceholder="Search currencies"
        searchText={(row) => `${row.code} ${row.isoCode} ${row.name} ${row.rate} ${row.home ? "home" : ""}`}
        emptyLabel="No currencies yet for this organisation."
        toolbar={
          canEdit ? (
            <button className={styles.primary} type="button" onClick={() => setDraft("new")}>
              Add
            </button>
          ) : null
        }
        columns={[
          {
            key: "code",
            label: "Code",
            mono: true,
            sortValue: (row) => row.code,
            render: (row) => row.code,
          },
          {
            key: "iso",
            label: "ISO",
            mono: true,
            sortValue: (row) => row.isoCode,
            render: (row) => row.isoCode,
          },
          {
            key: "name",
            label: "Name",
            sortValue: (row) => row.name,
            render: (row) => row.name,
          },
          {
            key: "rate",
            label: "Rate",
            mono: true,
            sortValue: (row) => row.rate.replace(/,/g, ""),
            render: (row) => row.rate,
          },
          {
            key: "home",
            label: "Home",
            sortValue: (row) => (row.home ? "Home" : ""),
            render: (row) => (row.home ? "Home" : ""),
          },
        ]}
        actions={
          canEdit
            ? (row) => (
                <>
                  <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
                    Edit
                  </button>
                  <form action={deleteCurrency}>
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
              )
            : undefined
        }
      />
      {draft ? (
        <CurrencyForm
          key={draft === "new" ? "new" : draft.id}
          row={draft === "new" ? null : draft}
          isoCurrencies={isoCurrencies}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function CurrencyForm({
  row,
  isoCurrencies,
  onClose,
}: {
  row: CurrencyRow | null;
  isoCurrencies: CodeName[];
  onClose: () => void;
}) {
  const save = row ? updateCurrency : createCurrency;
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [code, setCode] = useState(row?.code ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [rate, setRate] = useState(row?.rate ?? "");
  const [isoCode, setIsoCode] = useState(row?.isoCode ?? "");

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title={row ? "Edit currency" : "Add currency"} onClose={onClose}>
      <form className={styles.modalForm} action={action} autoComplete="off" noValidate>
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
            placeholder="EUR"
            className={styles.mono}
            style={{ textTransform: "uppercase" }}
          />
        </label>
        <label className={styles.field}>
          Name
          <QuietInput
            name="name"
            required
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Euro"
          />
        </label>
        <label className={styles.field}>
          ISO code
          <select name="iso_code" required autoComplete="off" value={isoCode} onChange={(event) => setIsoCode(event.target.value)}>
            <option value="" disabled>
              Choose an ISO currency
            </option>
            {isoCurrencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Rate
          <QuietInput
            name="rate"
            required
            autoComplete="off"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            onBlur={(event) => {
              if (parseCurrencyRate(event.target.value)) setRate(formatCurrencyRate(event.target.value));
            }}
            placeholder="1"
          />
        </label>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
