"use client";

import { useActionState, useEffect, useState } from "react";
import { keepEntries } from "@/components/keepEntries";
import { CodeField } from "@/components/CodeField";
import ConfirmSubmitButton from "@/components/ConfirmDialog";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { createBankAccount, deleteBankAccount, updateBankAccount } from "@/lib/bank-account-actions";
import { formatIban, type BankAccountChoice, type BankAccountRow } from "@/lib/bank-accounts";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import type { ActionState } from "@/lib/types";

export default function BankAccountManager({
  rows,
  currencies,
  glCodes,
  loadError,
  actionError,
  canEdit = true,
  organisationName,
}: {
  rows: BankAccountRow[];
  currencies: BankAccountChoice[];
  glCodes: BankAccountChoice[];
  loadError: string | null;
  actionError?: string;
  canEdit?: boolean;
  organisationName: string;
}) {
  const [draft, setDraft] = useState<BankAccountRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Bank accounts</h1>
        <p className={styles.lede}>Bank accounts for {organisationName}.</p>
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
        form="bank-accounts"
        onOpen={(row) => setDraft(row)}
        rows={rows}
        searchPlaceholder="Search bank accounts"
        searchText={(row) =>
          `${row.code} ${row.name} ${row.iban} ${row.bic} ${row.currencyCode} ${row.isDefault ? "default" : ""} ${row.active ? "" : "inactive"}`
        }
        emptyLabel="No bank accounts yet for this organisation."
        toolbar={
          canEdit ? (
            <button className={styles.primary} type="button" onClick={() => setDraft("new")}>
              Add
            </button>
          ) : null
        }
        columns={[
          { key: "code", label: "Code", mono: true, sortValue: (row) => row.code, render: (row) => row.code },
          { key: "name", label: "Name", sortValue: (row) => row.name, render: (row) => row.name },
          { key: "iban", label: "IBAN", mono: true, sortValue: (row) => row.iban, render: (row) => formatIban(row.iban) },
          { key: "bic", label: "BIC", mono: true, sortValue: (row) => row.bic, render: (row) => row.bic },
          {
            key: "currency",
            label: "Currency",
            mono: true,
            sortValue: (row) => row.currencyCode,
            render: (row) => row.currencyCode,
          },
          {
            key: "default",
            label: "Default",
            sortValue: (row) => (row.isDefault ? "Default" : ""),
            render: (row) => (row.isDefault ? "Default" : ""),
          },
          {
            key: "active",
            label: "Status",
            sortValue: (row) => (row.active ? "Active" : "Inactive"),
            render: (row) => (row.active ? "Active" : "Inactive"),
          },
        ]}
        actions={
          canEdit
            ? (row) => (
                <>
                  <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
                    Edit
                  </button>
                  <form action={deleteBankAccount}>
                    <input type="hidden" name="id" value={row.id} />
                    <ConfirmSubmitButton
                      className={styles.quiet}
                      title={`Remove ${row.code}?`}
                      message="It will be removed from this organisation. An account used by a payment cannot be removed. Make it inactive instead."
                    >
                      Remove
                    </ConfirmSubmitButton>
                  </form>
                </>
              )
            : (row) => (
                <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
                  View
                </button>
              )
        }
      />
      {draft ? (
        <BankAccountForm
          key={draft === "new" ? "new" : draft.id}
          row={draft === "new" ? null : draft}
          currencies={currencies}
          glCodes={glCodes}
          readOnly={!canEdit}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function BankAccountForm({
  row,
  currencies,
  glCodes,
  readOnly = false,
  onClose,
}: {
  row: BankAccountRow | null;
  currencies: BankAccountChoice[];
  glCodes: BankAccountChoice[];
  readOnly?: boolean;
  onClose: () => void;
}) {
  const save = row ? updateBankAccount : createBankAccount;
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [code, setCode] = useState(row?.code ?? "");
  const [name, setName] = useState(row?.name ?? "");
  const [iban, setIban] = useState(row ? formatIban(row.iban) : "");
  const [bic, setBic] = useState(row?.bic ?? "");
  const [currencyId, setCurrencyId] = useState(row?.currencyId ?? currencies[0]?.id ?? "");
  const [glCodeId, setGlCodeId] = useState(row?.glCodeId ?? "");
  const [active, setActive] = useState(row?.active ?? true);
  const [isDefault, setIsDefault] = useState(row?.isDefault ?? false);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal
      title={readOnly ? "View bank account" : row ? "Edit bank account" : "Add bank account"}
      onClose={onClose}
      className={recordStyles.dialogMedium}
    >
      <form
        className={`${styles.modalForm}${readOnly ? ` ${styles.formReadOnly}` : ""}`}
        onSubmit={keepEntries(action)}
        autoComplete="off"
        noValidate
      >
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <div className={recordStyles.cols}>
          <CodeField
            locked={Boolean(row)}
            value={code}
            onChange={setCode}
            maxLength={20}
            autoFocus={!row}
            className={recordStyles.cell}
          />
          <label className={recordStyles.cell}>
            Name
            <QuietInput
              name="name"
              required
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={recordStyles.cell}>
            IBAN
            <QuietInput
              name="iban"
              required
              maxLength={42}
              autoComplete="off"
              spellCheck={false}
              value={iban}
              onChange={(event) => setIban(event.target.value)}
              onBlur={(event) => setIban(event.target.value.trim() ? formatIban(event.target.value.toUpperCase()) : "")}
            />
          </label>
          <label className={recordStyles.cell}>
            BIC
            <QuietInput
              name="bic"
              maxLength={11}
              autoComplete="off"
              spellCheck={false}
              value={bic}
              onChange={(event) => setBic(event.target.value.toUpperCase())}
            />
          </label>
          <label className={recordStyles.cell}>
            Currency
            <select name="currency_id" required value={currencyId} onChange={(event) => setCurrencyId(event.target.value)}>
              {currencies.map((currency) => (
                <option key={currency.id} value={currency.id}>
                  {currency.label}
                </option>
              ))}
            </select>
          </label>
          <label className={recordStyles.cell}>
            GL code
            <select name="gl_code_id" value={glCodeId} onChange={(event) => setGlCodeId(event.target.value)}>
              <option value=""></option>
              {glCodes.map((glCode) => (
                <option key={glCode.id} value={glCode.id}>
                  {glCode.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.checkLine}>
            <input
              type="checkbox"
              name="active"
              checked={active}
              onChange={(event) => {
                setActive(event.target.checked);
                if (!event.target.checked) setIsDefault(false);
              }}
            />
            Active
          </label>
          <label className={styles.checkLine}>
            <input
              type="checkbox"
              name="is_default"
              checked={isDefault}
              disabled={!active}
              onChange={(event) => setIsDefault(event.target.checked)}
            />
            Default for its currency
          </label>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {readOnly ? null : (
            <button className={styles.primary} type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </form>
    </FormModal>
  );
}
