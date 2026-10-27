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
import { formatInteger } from "@/lib/numbers";
import {
  DOCUMENT_KINDS,
  TRANSACTION_TYPE_KINDS,
  documentKindLabel,
  documentNumberPreview,
  type TransactionTypeRow,
} from "@/lib/transaction-types";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function TransactionTypeManager({
  rows,
  loadError,
  actionError,
  canEdit = true,
  organisationName,
}: {
  rows: TransactionTypeRow[];
  loadError: string | null;
  actionError?: string;
  canEdit?: boolean;
  organisationName: string;
}) {
  const [draft, setDraft] = useState<TransactionTypeRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Transaction types</h1>
        <p className={styles.lede}>Transaction types for {organisationName}.</p>
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
        searchText={(row) => `${row.code} ${row.description} ${row.type} ${documentKindLabel(row.documentKind)} ${row.lastReference} ${row.flexLabels.join(" ")}`}
        emptyLabel="No transaction types yet for this organisation."
        minWidth="1180px"
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
            key: "kind",
            label: "Kind",
            sortValue: (row) => documentKindLabel(row.documentKind),
            render: (row) => documentKindLabel(row.documentKind),
          },
          {
            key: "number",
            label: "Number",
            mono: true,
            sortValue: (row) => documentNumberPreview(row.referencePrefix, row.referencePadding, row.lastReference + 1),
            render: (row) => documentNumberPreview(row.referencePrefix, row.referencePadding, row.lastReference + 1),
          },
          {
            key: "numbering",
            label: "Numbering",
            sortValue: (row) => row.numbering,
            render: (row) => (row.type === "Sales" || row.numbering === "on_post" ? "On posting" : "On entry"),
          },
          {
            key: "lastReference",
            label: "Last reference",
            mono: true,
            sortValue: (row) => String(row.lastReference),
            render: (row) => formatInteger(row.lastReference),
          },
          ...([1, 2, 3, 4, 5] as const).map((number) => ({
            key: `flex${number}`,
            label: `Flex ${number}`,
            sortValue: (row: TransactionTypeRow) => row.flexLabels[number - 1],
            render: (row: TransactionTypeRow) => row.flexLabels[number - 1],
          })),
        ]}
        actions={
          canEdit
            ? (row) => (
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
              )
            : undefined
        }
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
  const [documentKind, setDocumentKind] = useState(row?.documentKind ?? "invoice");
  const [referencePrefix, setReferencePrefix] = useState(row?.referencePrefix ?? "");
  const [referencePadding, setReferencePadding] = useState(String(row?.referencePadding ?? 0));
  const kindLocked = (row?.documentCount ?? 0) > 0;
  const [flexLabels, setFlexLabels] = useState(row?.flexLabels ?? ["", "", "", "", ""]);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title={row ? "Edit transaction type" : "Add transaction type"} onClose={onClose} className={styles.partyDialog}>
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
        <label className={styles.field}>
          Kind
          {kindLocked ? <input type="hidden" name="document_kind" value={documentKind} /> : null}
          <select
            name={kindLocked ? undefined : "document_kind"}
            required
            autoComplete="off"
            value={documentKind}
            disabled={kindLocked}
            onChange={(event) => setDocumentKind(event.target.value as TransactionTypeRow["documentKind"])}
          >
            {DOCUMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {documentKindLabel(kind)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Number prefix
          <QuietInput
            name="reference_prefix"
            maxLength={10}
            value={referencePrefix}
            onChange={(event) => setReferencePrefix(event.target.value)}
            placeholder="INV-"
            className={styles.mono}
          />
        </label>
        <label className={styles.field}>
          Number padding
          <QuietInput
            name="reference_padding"
            required
            inputMode="numeric"
            maxLength={2}
            value={referencePadding}
            onChange={(event) => setReferencePadding(event.target.value)}
            placeholder="0"
            className={styles.mono}
          />
        </label>
        {flexLabels.map((label, index) => (
          <label className={styles.field} key={index}>
            {`Flex ${index + 1} label`}
            <QuietInput
              name={`flex${index + 1}_label`}
              maxLength={80}
              value={label}
              onChange={(event) =>
                setFlexLabels((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
              }
              placeholder="Leave blank to hide"
            />
          </label>
        ))}
        <p className={styles.panelMeta}>
          Last reference: {formatInteger(row ? row.lastReference : 0)}. Next document number:{" "}
          {documentNumberPreview(
            referencePrefix.trim(),
            Number(referencePadding) || 0,
            (row?.lastReference ?? 0) + 1,
          )}
          . A later change to the prefix or padding leaves numbers already issued as they are.
          A blank flex label is not shown on the transaction.
          {kindLocked ? " The kind stays as it is because a document has been entered." : ""}
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
