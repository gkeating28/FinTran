"use client";

import { useActionState, useEffect, useState } from "react";
import FormModal from "@/components/FormModal";
import { createReference, deleteReference, updateReference } from "@/lib/reference-actions";
import { REFERENCE_META, type ReferenceKind, type ReferenceRow } from "@/lib/reference";
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
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <span>{meta.title}</span>
          <span className={styles.panelActions}>
            <span className={styles.panelMeta}>
              {rows.length} {rows.length === 1 ? meta.singular : meta.title.toLowerCase()}
            </span>
            <button className={styles.primary} type="button" onClick={() => setDraft("new")}>
              Add
            </button>
          </span>
        </div>
        {rows.length === 0 ? (
          <p className={styles.empty}>No {meta.title.toLowerCase()} yet for this organisation.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={styles.mono}>{row.code}</td>
                  <td>{row.description}</td>
                  <td>
                    <span className={styles.panelActions}>
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
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
