"use client";

import { useActionState, useState } from "react";
import PrintedForm from "@/components/PrintedForm";
import { QuietInput } from "@/components/QuietField";
import styles from "@/components/OpsPage.module.css";
import printStyles from "@/components/PrintForm.module.css";
import { saveTransactionForm } from "@/lib/form-actions";
import { buildPrintView, type FormSource } from "@/lib/form-document";
import {
  defaultLayout,
  HEADER_FIELDS,
  PAGE_SIZES,
  PAGE_SIZE_OPTIONS,
  headerFieldLabel,
  LINE_COLUMNS,
  lineColumnLabel,
  ORGANISATION_FIELDS,
  organisationFieldLabel,
  PARTY_FIELDS,
  partyFieldLabel,
  type FormLayout,
  type HeaderField,
  type LineColumn,
  type OrganisationField,
  type PartyField,
} from "@/lib/form-layout";
import type { FormType } from "@/lib/form-data";
import type { ActionState } from "@/lib/types";

function salesLayout(layout: FormLayout, sales: boolean, creditNote: boolean): FormLayout {
  if (!sales) return layout;
  const add = <T extends string>(current: readonly T[], required: readonly T[]) => [
    ...current,
    ...required.filter((item) => !current.includes(item)),
  ];
  return {
    ...layout,
    showVatSummary: true,
    organisationFields: add(layout.organisationFields, ["name", "address", "vatNumber"]),
    partyFields: add(layout.partyFields, ["name", "address"]),
    headerFields: add(layout.headerFields, creditNote ? ["reference", "transactionDate", "precedingReference"] : ["reference", "transactionDate"]),
    lineColumns: add(layout.lineColumns, ["description", "quantity", "price", "tax", "amount"]),
  };
}

export default function FormDesigner({
  type,
  initialLayout,
  source,
  sample,
  canEdit = true,
}: {
  type: FormType;
  initialLayout: FormLayout;
  source: FormSource;
  sample: boolean;
  canEdit?: boolean;
}) {
  const [state, action, pending] = useActionState(saveTransactionForm, {} as ActionState);
  const [layout, setLayout] = useState(initialLayout);
  const view = buildPrintView(layout, {
    ...source,
    flexLabels: type.flexLabels,
    numberLabel: source.numberLabel,
  });
  const headerFields = HEADER_FIELDS.filter((field) => !field.startsWith("flex") || type.flexLabels[Number(field.slice(4)) - 1]?.trim());
  const sales = type.kind === "Sales";
  const creditNote = sales && type.documentKind === "credit_note";
  const lockedOrganisation = sales ? new Set(["name", "address", "vatNumber"]) : undefined;
  const lockedParty = sales ? new Set(["name", "address"]) : undefined;
  const lockedHeader = sales
    ? new Set(creditNote ? ["reference", "transactionDate", "precedingReference"] : ["reference", "transactionDate"])
    : undefined;
  const lockedLines = sales ? new Set(["description", "quantity", "price", "tax", "amount"]) : undefined;

  return (
    <div className={printStyles.designer}>
      <form action={action} autoComplete="off" noValidate style={{ display: "contents" }}>
        <fieldset disabled={!canEdit} className={printStyles.controls}>
        <input type="hidden" name="code" value={type.code} />
        <input type="hidden" name="layout" value={JSON.stringify(salesLayout(layout, sales, creditNote))} />
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        {state.message ? <p className={styles.notice}>Saved. Prints of this transaction type use this layout.</p> : null}
        <label className={styles.field}>
          Document title
          <QuietInput
            name="title"
            maxLength={80}
            value={layout.title}
            onChange={(event) => setLayout({ ...layout, title: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          Page size
          <select
            value={layout.pageSize}
            onChange={(event) =>
              setLayout({ ...layout, pageSize: PAGE_SIZES.find((size) => size === event.target.value) ?? "A4" })
            }
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {PAGE_SIZE_OPTIONS[size].label}
              </option>
            ))}
          </select>
        </label>
        <div className={printStyles.checks}>
          <label className={printStyles.check}>
            <input
              type="checkbox"
              checked={layout.showLogo}
              onChange={(event) => setLayout({ ...layout, showLogo: event.target.checked })}
            />
            Organisation logo
          </label>
          <label className={printStyles.check}>
            <input
              type="checkbox"
              checked={sales ? true : layout.showVatSummary}
              disabled={sales}
              onChange={(event) => setLayout({ ...layout, showVatSummary: event.target.checked })}
            />
            VAT summary
          </label>
          <label className={printStyles.check}>
            <input
              type="checkbox"
              checked={layout.showBanking}
              onChange={(event) => setLayout({ ...layout, showBanking: event.target.checked })}
            />
            Banking footer
          </label>
        </div>
        <FieldList
          legend="Organisation"
          fields={ORGANISATION_FIELDS}
          selected={layout.organisationFields}
          label={organisationFieldLabel}
          lockedFields={lockedOrganisation}
          onChange={(organisationFields) => setLayout((current) => ({ ...current, organisationFields }))}
        />
        <FieldList
          legend="Bill to"
          fields={PARTY_FIELDS}
          selected={layout.partyFields}
          label={partyFieldLabel}
          lockedFields={lockedParty}
          onChange={(partyFields) => setLayout((current) => ({ ...current, partyFields }))}
        />
        <FieldList
          legend="Document"
          fields={headerFields}
          selected={layout.headerFields}
          label={(field) => headerFieldLabel(field, type.flexLabels, source.numberLabel)}
          lockedFields={lockedHeader}
          onChange={(headerFields) => setLayout((current) => ({ ...current, headerFields }))}
        />
        <FieldList
          legend="Lines"
          fields={LINE_COLUMNS}
          selected={layout.lineColumns}
          label={lineColumnLabel}
          lockedFields={lockedLines}
          onChange={(lineColumns) => setLayout((current) => ({ ...current, lineColumns }))}
        />
        {canEdit ? (
          <div className={styles.modalActions}>
            <button
              className={styles.quiet}
              type="button"
              onClick={() => setLayout(defaultLayout(type.kind, type.description))}
            >
              Standard
            </button>
            <button className={styles.primary} type="submit" disabled={pending || layout.lineColumns.length === 0}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <p className={styles.lede}>An owner or admin can change this form.</p>
        )}
        </fieldset>
      </form>
      <div className={printStyles.preview}>
        <p className={printStyles.previewNote}>
          {sample
            ? "Sample lines, so you can see the page before a document exists. Organisation details are yours."
            : "Preview uses the latest document of this type."}
        </p>
        <PrintedForm view={view} />
      </div>
    </div>
  );
}

function FieldList<T extends OrganisationField | PartyField | HeaderField | LineColumn>({
  legend,
  fields,
  selected,
  label,
  lockedFields,
  onChange,
}: {
  legend: string;
  fields: readonly T[];
  selected: T[];
  label: (field: T) => string;
  lockedFields?: ReadonlySet<string>;
  onChange: (fields: T[]) => void;
}) {
  const shown = selected.filter((field) => fields.includes(field));
  const hidden = fields.filter((field) => !shown.includes(field));

  function toggle(field: T) {
    onChange(shown.includes(field) ? shown.filter((item) => item !== field) : [...shown, field]);
  }

  function move(field: T, direction: -1 | 1) {
    const index = shown.indexOf(field);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= shown.length) return;
    const copy = [...shown];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    onChange(copy);
  }

  function row(field: T, index: number | null) {
    const id = `${legend}-${field}`;
    const on = index !== null;
    return (
      <div key={field} className={printStyles.choice}>
        <input
          id={id}
          type="checkbox"
          checked={on}
          disabled={on && lockedFields?.has(field)}
          onChange={() => {
            if (on && lockedFields?.has(field)) return;
            toggle(field);
          }}
        />
        <label htmlFor={id}>{label(field)}</label>
        <span className={printStyles.moves}>
          <button
            type="button"
            aria-label={`Move ${label(field)} up`}
            disabled={!on || index === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (index !== null) move(field, -1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${label(field)} down`}
            disabled={!on || index === shown.length - 1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (index !== null) move(field, 1);
            }}
          >
            ↓
          </button>
        </span>
      </div>
    );
  }

  return (
    <fieldset className={printStyles.section}>
      <legend>{legend}</legend>
      {shown.map((field, index) => row(field, index))}
      {hidden.length > 0 ? <p className={printStyles.hiddenLabel}>Not on the form</p> : null}
      {hidden.map((field) => row(field, null))}
    </fieldset>
  );
}
