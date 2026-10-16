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

export default function FormDesigner({
  type,
  initialLayout,
  source,
  sample,
}: {
  type: FormType;
  initialLayout: FormLayout;
  source: FormSource;
  sample: boolean;
}) {
  const [state, action, pending] = useActionState(saveTransactionForm, {} as ActionState);
  const [layout, setLayout] = useState(initialLayout);
  const view = buildPrintView(layout, {
    ...source,
    flexLabels: type.flexLabels,
    numberLabel: source.numberLabel,
  });
  const headerFields = HEADER_FIELDS.filter((field) => !field.startsWith("flex") || type.flexLabels[Number(field.slice(4)) - 1]?.trim());

  return (
    <div className={printStyles.designer}>
      <form className={printStyles.controls} action={action} autoComplete="off" noValidate>
        <input type="hidden" name="code" value={type.code} />
        <input type="hidden" name="layout" value={JSON.stringify(layout)} />
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
              checked={layout.showVatSummary}
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
          onChange={(organisationFields) => setLayout({ ...layout, organisationFields })}
        />
        <FieldList
          legend="Bill to"
          fields={PARTY_FIELDS}
          selected={layout.partyFields}
          label={partyFieldLabel}
          onChange={(partyFields) => setLayout({ ...layout, partyFields })}
        />
        <FieldList
          legend="Document"
          fields={headerFields}
          selected={layout.headerFields}
          label={(field) => headerFieldLabel(field, type.flexLabels, source.numberLabel)}
          onChange={(headerFields) => setLayout({ ...layout, headerFields })}
        />
        <FieldList
          legend="Lines"
          fields={LINE_COLUMNS}
          selected={layout.lineColumns}
          label={lineColumnLabel}
          onChange={(lineColumns) => setLayout({ ...layout, lineColumns })}
        />
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
  onChange,
}: {
  legend: string;
  fields: readonly T[];
  selected: T[];
  label: (field: T) => string;
  onChange: (fields: T[]) => void;
}) {
  const ordered = [...selected.filter((field) => fields.includes(field)), ...fields.filter((field) => !selected.includes(field))];

  function toggle(field: T) {
    onChange(selected.includes(field) ? selected.filter((item) => item !== field) : [...selected, field]);
  }

  function move(field: T, direction: -1 | 1) {
    const index = selected.indexOf(field);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= selected.length) return;
    const copy = [...selected];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    onChange(copy);
  }

  return (
    <fieldset className={printStyles.section}>
      <legend>{legend}</legend>
      {ordered.map((field) => {
        const index = selected.indexOf(field);
        const on = index >= 0;
        const id = `${legend}-${field}`;
        return (
          <div key={field} className={printStyles.choice}>
            <input id={id} type="checkbox" checked={on} onChange={() => toggle(field)} />
            <label htmlFor={id}>{label(field)}</label>
            <span className={printStyles.moves}>
              <button type="button" aria-label={`Move ${label(field)} up`} disabled={!on || index === 0} onClick={() => move(field, -1)}>
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${label(field)} down`}
                disabled={!on || index === selected.length - 1}
                onClick={() => move(field, 1)}
              >
                ↓
              </button>
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}
