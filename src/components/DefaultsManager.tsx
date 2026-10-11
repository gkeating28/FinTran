"use client";

import { useActionState, useEffect, useState } from "react";
import FormModal from "@/components/FormModal";
import { updateOrganisationDefaults } from "@/lib/currency-actions";
import { currencyLabel, type CurrencyChoice } from "@/lib/currencies";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function DefaultsManager({
  currencies,
  homeCurrencyId,
  loadError,
}: {
  currencies: CurrencyChoice[];
  homeCurrencyId: string | null;
  loadError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const home = currencies.find((currency) => currency.id === homeCurrencyId) ?? null;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Defaults</h1>
        <p className={styles.lede}>
          Defaults for this organisation. Home currency is set here, and further defaults will be
          added to the same form.
        </p>
      </div>
      {loadError ? (
        <p className={styles.alert} role="alert">
          {loadError}
        </p>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <span>Organisation defaults</span>
          <button className={styles.primary} type="button" onClick={() => setOpen(true)}>
            Edit
          </button>
        </div>
        <div className={styles.defaultRow}>
          <span className={styles.cardLabel}>Home currency</span>
          <span className={home ? styles.defaultValue : styles.panelMeta}>
            {home ? currencyLabel(home) : "Not set"}
          </span>
        </div>
      </div>
      {open ? (
        <DefaultsForm
          currencies={currencies}
          homeCurrencyId={homeCurrencyId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function DefaultsForm({
  currencies,
  homeCurrencyId,
  onClose,
}: {
  currencies: CurrencyChoice[];
  homeCurrencyId: string | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(updateOrganisationDefaults, {} as ActionState);
  const [homeCurrency, setHomeCurrency] = useState(homeCurrencyId ?? "");

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title="Edit defaults" onClose={onClose}>
      <form className={styles.modalForm} action={action}>
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
            disabled={currencies.length === 0}
          >
            <option value="" disabled>
              Choose a home currency
            </option>
            {currencies.map((currency) => (
              <option key={currency.id} value={currency.id}>
                {currencyLabel(currency)}
              </option>
            ))}
          </select>
        </label>
        {currencies.length === 0 ? (
          <p className={styles.panelMeta}>Add a currency before choosing a home currency.</p>
        ) : null}
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
