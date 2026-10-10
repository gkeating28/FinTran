"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { createReference, deleteReference, updateReference } from "@/lib/reference-actions";
import { ACCOUNT_TYPES, REFERENCE_META, type ReferenceKind, type ReferenceRow } from "@/lib/reference";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function ReferenceManager({
  kind,
  rows,
  loadError,
  actionError,
}: {
  kind: ReferenceKind;
  rows: ReferenceRow[];
  loadError: string | null;
  actionError?: string;
}) {
  const meta = REFERENCE_META[kind];
  const remove = deleteReference.bind(null, kind);
  const [draft, setDraft] = useState<ReferenceRow | "new" | null>(null);

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
        searchText={(row) => `${row.code} ${row.description} ${row.accountType ?? ""}`}
        emptyLabel={`No ${meta.title.toLowerCase()} yet for this organisation.`}
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
          ...(kind === "gl_codes"
            ? [
                {
                  key: "accountType",
                  label: "Account type",
                  sortValue: (row: ReferenceRow) => row.accountType ?? "",
                  render: (row: ReferenceRow) => row.accountType ?? "",
                },
              ]
            : []),
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
        <ReferenceForm
          key={draft === "new" ? "new" : draft.id}
          kind={kind}
          row={draft === "new" ? null : draft}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function ReferenceForm({
  kind,
  row,
  onClose,
}: {
  kind: ReferenceKind;
  row: ReferenceRow | null;
  onClose: () => void;
}) {
  const meta = REFERENCE_META[kind];
  const save = row ? updateReference.bind(null, kind) : createReference.bind(null, kind);
  const [state, action, pending] = useActionState(save, {} as ActionState);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title={row ? `Edit ${meta.singular}` : `Add ${meta.singular}`} onClose={onClose}>
      <form className={styles.modalForm} action={action}>
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
            defaultValue={row?.code ?? ""}
            placeholder="1000"
            className={styles.mono}
            style={{ textTransform: "uppercase" }}
          />
        </label>
        <label className={styles.field}>
          Description
          <input
            name="description"
            required
            maxLength={200}
            defaultValue={row?.description ?? ""}
            placeholder="Sales income"
          />
        </label>
        {kind === "gl_codes" ? (
          <label className={styles.field}>
            Account type
            <select name="account_type" required defaultValue={row?.accountType ?? ""}>
              <option value="" disabled>
                Choose an account type
              </option>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
