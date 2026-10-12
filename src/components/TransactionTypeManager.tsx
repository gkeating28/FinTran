"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import {
  createTransactionType,
  deleteTransactionType,
  updateTransactionType,
} from "@/lib/transaction-type-actions";
import {
  TRANSACTION_TYPE_KINDS,
  type TransactionTypeRow,
} from "@/lib/transaction-types";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function TransactionTypeManager({
  rows,
  loadError,
  actionError,
}: {
  rows: TransactionTypeRow[];
  loadError: string | null;
  actionError?: string;
}) {
  const [draft, setDraft] = useState<TransactionTypeRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Transaction types</h1>
        <p className={styles.lede}>
          Transaction types for this organisation. Each has a code, a description, and a type of
          Sales or Purchases. Last reference starts at 0 for every type, so the next number is 1.
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
        searchPlaceholder="Search transaction types"
        searchText={(row) => `${row.code} ${row.description} ${row.type} ${row.lastReference}`}
        emptyLabel="No transaction types yet for this organisation."
        toolbar={
          <button className={styles.primary} type="button" onClick={() => setDraft("new")}>
            Add
          </button>
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
            key: "description",
            label: "Description",
            sortValue: (row) => row.description,
            render: (row) => row.description,
          },
          {
            key: "type",
            label: "Type",
            sortValue: (row) => row.type,
            render: (row) => row.type,
          },
          {
            key: "lastReference",
            label: "Last reference",
            mono: true,
            sortValue: (row) => String(row.lastReference),
            render: (row) => row.lastReference,
          },
        ]}
        actions={(row) => (
          <>
            <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
              Edit
            </button>
            <form action={deleteTransactionType}>
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
        <TransactionTypeForm
          key={draft === "new" ? "new" : draft.id}
          row={draft === "new" ? null : draft}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function TransactionTypeForm({
  row,
  onClose,
}: {
  row: TransactionTypeRow | null;
  onClose: () => void;
}) {
  const save = row ? updateTransactionType : createTransactionType;
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [code, setCode] = useState(row?.code ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [type, setType] = useState(row?.type ?? "");

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title={row ? "Edit transaction type" : "Add transaction type"} onClose={onClose}>
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
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="SI"
            className={styles.mono}
            style={{ textTransform: "uppercase" }}
          />
        </label>
        <label className={styles.field}>
          Description
          <QuietInput
            name="description"
            required
            maxLength={200}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Sales invoice"
          />
        </label>
        <label className={styles.field}>
          Type
          <select name="type" required autoComplete="off" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="" disabled>
              Choose a type
            </option>
            {TRANSACTION_TYPE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.panelMeta}>
          Last reference: {row ? row.lastReference : 0}. Next number: {(row?.lastReference ?? 0) + 1}.
        </p>
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
