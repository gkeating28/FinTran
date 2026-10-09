"use client";

import { useActionState, useEffect, useRef } from "react";
import { createReference, deleteReference, updateReference } from "@/lib/reference-actions";
import { REFERENCE_META, type ReferenceKind, type ReferenceRow } from "@/lib/reference";
import styles from "@/components/OpsPage.module.css";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(createReference.bind(null, kind), {});
  const update = updateReference.bind(null, kind);
  const remove = deleteReference.bind(null, kind);

  useEffect(() => {
    if (state.message) formRef.current?.reset();
  }, [state.message]);

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
      {state.error || actionError ? (
        <p className={styles.alert} role="alert">
          {state.error ?? actionError}
        </p>
      ) : null}
      {state.message ? (
        <p className={styles.notice} role="status">
          {state.message}
        </p>
      ) : null}
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          {meta.title}
          <span className={styles.panelMeta}>
            {rows.length} {rows.length === 1 ? meta.singular : meta.title.toLowerCase()}
          </span>
        </div>
        <form ref={formRef} className={styles.form} action={action}>
          <label className={styles.field}>
            Code
            <input
              name="code"
              required
              maxLength={20}
              autoComplete="off"
              placeholder="1000"
              style={{ fontFamily: "var(--ops-mono)", textTransform: "uppercase" }}
            />
          </label>
          <label className={styles.field}>
            Description
            <input name="description" required maxLength={200} placeholder="Sales income" />
          </label>
          <button className={styles.primary} type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </button>
        </form>
        {rows.length === 0 ? (
          <p className={styles.empty}>No {meta.title.toLowerCase()} yet for this organisation.</p>
        ) : (
          <div>
            <div className={styles.rowHead}>
              <span>Code</span>
              <span>Description</span>
              <span />
            </div>
            {rows.map((row) => (
              <form key={row.id} className={styles.row} action={update}>
                <input type="hidden" name="id" value={row.id} />
                <input
                  name="code"
                  required
                  maxLength={20}
                  defaultValue={row.code}
                  aria-label={`${meta.singular} code`}
                  style={{ fontFamily: "var(--ops-mono)", textTransform: "uppercase" }}
                />
                <input
                  name="description"
                  required
                  maxLength={200}
                  defaultValue={row.description}
                  aria-label={`${meta.singular} description`}
                />
                <button className={styles.primary} type="submit">
                  Save
                </button>
                <button
                  className={styles.quiet}
                  type="submit"
                  formAction={remove}
                  onClick={(event) => {
                    if (!window.confirm(`Remove ${row.code}?`)) event.preventDefault();
                  }}
                >
                  Remove
                </button>
              </form>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
