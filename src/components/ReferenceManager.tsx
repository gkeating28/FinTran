"use client";

import { useActionState, useEffect, useState } from "react";
import { CodeField } from "@/components/CodeField";
import ConfirmSubmitButton from "@/components/ConfirmDialog";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { createReference, deleteReference, updateReference } from "@/lib/reference-actions";
import {
  ACCOUNT_TYPES,
  formatRate,
  parseRate,
  REFERENCE_META,
  VAT_TYPES,
  type ReferenceKind,
  type ReferenceRow,
  type VatCategoryChoice,
  type VatexChoice,
} from "@/lib/reference";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { exact } from "@/components/recordForm";
import type { ActionState } from "@/lib/types";

export default function ReferenceManager({
  kind,
  rows,
  loadError,
  actionError,
  canEdit = true,
  organisationName,
  vatCategories = [],
  exemptions = [],
}: {
  kind: ReferenceKind;
  rows: ReferenceRow[];
  loadError: string | null;
  actionError?: string;
  canEdit?: boolean;
  organisationName: string;
  vatCategories?: VatCategoryChoice[];
  exemptions?: VatexChoice[];
}) {
  const meta = REFERENCE_META[kind];
  const remove = deleteReference.bind(null, kind);
  const [draft, setDraft] = useState<ReferenceRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{meta.title}</h1>
        <p className={styles.lede}>{meta.intro} for {organisationName}.</p>
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
        form={meta.path.slice(1)}
        onOpen={(row) => setDraft(row)}
        rows={rows}
        searchPlaceholder={`Search ${meta.title.toLowerCase()}`}
        searchText={(row) =>
          `${row.code} ${row.description} ${row.accountType ?? ""} ${formatRate(row.rate)} ${row.vatType ?? ""}`
        }
        emptyLabel={`No ${meta.title.toLowerCase()} yet for this organisation.`}
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
          ...(kind === "vat_rates"
            ? [
                {
                  key: "rate",
                  label: "Rate",
                  sortValue: (row: ReferenceRow) => row.rate ?? "",
                  render: (row: ReferenceRow) => formatRate(row.rate),
                },
                {
                  key: "vatType",
                  label: "Type",
                  sortValue: (row: ReferenceRow) => row.vatType ?? "",
                  render: (row: ReferenceRow) => row.vatType ?? "",
                },
                {
                  key: "vatCategory",
                  label: "Category",
                  sortValue: (row: ReferenceRow) => row.vatCategory ?? "",
                  render: (row: ReferenceRow) => row.vatCategory ?? "",
                },
              ]
            : []),
        ]}
        actions={
          canEdit
            ? (row) => (
                <>
                  <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
                    Edit
                  </button>
                  <form action={remove}>
                    <input type="hidden" name="id" value={row.id} />
                    <ConfirmSubmitButton
                      className={styles.quiet}
                      title={`Remove ${row.code}?`}
                      message="It will be removed from this organisation."
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
        <ReferenceForm
          key={draft === "new" ? "new" : draft.id}
          kind={kind}
          row={draft === "new" ? null : draft}
          vatCategories={vatCategories}
          exemptions={exemptions}
          readOnly={!canEdit}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function ReferenceForm({
  kind,
  row,
  vatCategories,
  exemptions,
  readOnly = false,
  onClose,
}: {
  kind: ReferenceKind;
  row: ReferenceRow | null;
  vatCategories: VatCategoryChoice[];
  exemptions: VatexChoice[];
  readOnly?: boolean;
  onClose: () => void;
}) {
  const meta = REFERENCE_META[kind];
  const save = row ? updateReference.bind(null, kind) : createReference.bind(null, kind);
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [code, setCode] = useState(row?.code ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [accountType, setAccountType] = useState(row?.accountType ?? "");
  const [rate, setRate] = useState(row?.rate ?? "");
  const [vatType, setVatType] = useState(row?.vatType ?? "");
  const [vatCategory, setVatCategory] = useState(row?.vatCategory ?? "S");
  const [exemptionCode, setExemptionCode] = useState(row?.exemptionCode ?? "");
  const [exemptionReason, setExemptionReason] = useState(row?.exemptionReason ?? "");

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal title={readOnly ? `View ${meta.singular}` : row ? `Edit ${meta.singular}` : `Add ${meta.singular}`} onClose={onClose} className={recordStyles.dialogMedium}>
      <form className={`${styles.modalForm}${readOnly ? ` ${styles.formReadOnly}` : ""}`} action={action} autoComplete="off" noValidate>
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <div className={recordStyles.stack}>
          <div className={recordStyles.row}>
            <CodeField
              locked={Boolean(row)}
              value={code}
              onChange={setCode}
              maxLength={20}
              autoFocus={!row}
              className={recordStyles.fixed}
              style={exact("22ch")}
            />
            <label className={recordStyles.grow}>
          Description
          <QuietInput
            name="description"
            required
            maxLength={200}
            autoComplete="off"
            spellCheck
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            
          />
        </label>
          </div>
          {kind === "vat_rates" ? (
            <>
              <div className={recordStyles.row}>
                <label className={recordStyles.fixed} style={exact("10ch")}>
              Rate (%)
              <QuietInput
                name="rate"
                required
                autoComplete="off"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                onBlur={(event) => {
                  const parsed = parseRate(event.target.value);
                  if (parsed) setRate(formatRate(parsed).replace(/%$/, ""));
                }}
                
              />
            </label>
                <label className={recordStyles.fixed} style={exact("16ch")}>
              Type
              <select
                name="vat_type"
                required
                autoComplete="off"
                value={vatType}
                onChange={(event) => setVatType(event.target.value)}
              >
                <option value="" disabled></option>
                {VAT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
                <label className={recordStyles.grow}>
              Category
              <select
                name="vat_category"
                required
                autoComplete="off"
                value={vatCategory}
                onChange={(event) => setVatCategory(event.target.value)}
              >
                {vatCategories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.code} — {category.name}
                  </option>
                ))}
              </select>
            </label>
              </div>
              <div className={recordStyles.row}>
                <label className={recordStyles.fixed} style={exact("16ch")}>
              Exemption code
              <select
                name="exemption_code"
                autoComplete="off"
                value={exemptionCode}
                onChange={(event) => setExemptionCode(event.target.value)}
              >
                <option value="">None</option>
                {exemptions.map((exemption) => (
                  <option key={exemption.code} value={exemption.code}>
                    {exemption.code}
                  </option>
                ))}
              </select>
            </label>
                <label className={recordStyles.grow}>
              Exemption reason
              <QuietInput
                name="exemption_reason"
                maxLength={200}
                autoComplete="off"
                spellCheck
                value={exemptionReason}
                onChange={(event) => setExemptionReason(event.target.value)}
              />
            </label>
              </div>
            </>
          ) : null}
          {kind === "gl_codes" ? (
            <div className={recordStyles.row}>
              <label className={recordStyles.fixed} style={exact("22ch")}>
            Account type
            <select
              name="account_type"
              required
              autoComplete="off"
              value={accountType}
              onChange={(event) => setAccountType(event.target.value)}
            >
              <option value="" disabled></option>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
            </div>
          ) : null}
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
