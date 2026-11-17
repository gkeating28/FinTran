"use client";

import { useActionState, useState } from "react";
import { FieldList } from "@/components/FormDesigner";
import { keepEntries } from "@/components/keepEntries";
import PrintedPayment from "@/components/PrintedPayment";
import { QuietInput } from "@/components/QuietField";
import styles from "@/components/OpsPage.module.css";
import printStyles from "@/components/PrintForm.module.css";
import { saveTransactionForm } from "@/lib/form-actions";
import { ORGANISATION_FIELDS, PAGE_SIZES, PAGE_SIZE_OPTIONS, organisationFieldLabel } from "@/lib/form-layout";
import {
  defaultPaymentLayout,
  PAYMENT_HEADER_FIELDS,
  PAYMENT_LINE_COLUMNS,
  PAYMENT_PARTY_FIELDS,
  PAYMENT_REQUIRED,
  paymentHeaderFieldLabel,
  paymentLineColumnLabel,
  paymentPartyFieldLabel,
  paymentPartyLabel,
  settlesInvoices,
  withRequiredPaymentFields,
  type PaymentFormLayout,
} from "@/lib/payment-form-layout";
import type { PaymentFormType } from "@/lib/payment-print-data";
import { buildPaymentPrint, type PaymentPrintSource } from "@/lib/payment-print";
import type { ActionState } from "@/lib/types";

/** The form designer for a payment, receipt or refund: the same page as the designer for a document, with the fields a payment prints. */
export default function PaymentFormDesigner({
  type,
  initialLayout,
  source,
  sample,
  canEdit = true,
}: {
  type: PaymentFormType;
  initialLayout: PaymentFormLayout;
  source: PaymentPrintSource;
  sample: boolean;
  canEdit?: boolean;
}) {
  const [state, action, pending] = useActionState(saveTransactionForm, {} as ActionState);
  const [layout, setLayout] = useState(initialLayout);
  const view = buildPaymentPrint(source, layout);
  const settles = settlesInvoices(type.kind, type.direction) ? "invoices" : "credit notes";
  const locked = (fields: readonly string[]) => new Set<string>(fields);

  return (
    <div className={printStyles.designer}>
      <form onSubmit={keepEntries(action)} autoComplete="off" noValidate style={{ display: "contents" }}>
        <fieldset disabled={!canEdit} className={printStyles.controls}>
          <input type="hidden" name="code" value={type.code} />
          <input type="hidden" name="layout" value={JSON.stringify(withRequiredPaymentFields(layout))} />
          {state.error ? (
            <p className={styles.alert} role="alert">
              {state.error}
            </p>
          ) : null}
          {state.message ? <p className={styles.notice}>Saved. Prints of this transaction type use this layout.</p> : null}
          <label className={styles.field}>
            Document title
            <QuietInput name="title" maxLength={80} value={layout.title} onChange={(event) => setLayout({ ...layout, title: event.target.value })} />
          </label>
          <label className={styles.field}>
            Page size
            <select
              value={layout.pageSize}
              onChange={(event) => setLayout({ ...layout, pageSize: PAGE_SIZES.find((size) => size === event.target.value) ?? "A4" })}
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
              <input type="checkbox" checked={layout.showLogo} onChange={(event) => setLayout({ ...layout, showLogo: event.target.checked })} />
              Organisation logo
            </label>
          </div>
          <FieldList
            legend="Organisation"
            fields={ORGANISATION_FIELDS}
            selected={layout.organisationFields}
            label={organisationFieldLabel}
            lockedFields={locked(PAYMENT_REQUIRED.organisationFields)}
            onChange={(organisationFields) => setLayout((current) => ({ ...current, organisationFields }))}
          />
          <FieldList
            legend={paymentPartyLabel(type.kind)}
            fields={PAYMENT_PARTY_FIELDS}
            selected={layout.partyFields}
            label={paymentPartyFieldLabel}
            lockedFields={locked(PAYMENT_REQUIRED.partyFields)}
            onChange={(partyFields) => setLayout((current) => ({ ...current, partyFields }))}
          />
          <FieldList
            legend="Payment"
            fields={PAYMENT_HEADER_FIELDS}
            selected={layout.headerFields}
            label={(field) => paymentHeaderFieldLabel(field, type.kind)}
            lockedFields={locked(PAYMENT_REQUIRED.headerFields)}
            onChange={(headerFields) => setLayout((current) => ({ ...current, headerFields }))}
          />
          <FieldList
            legend={settles === "invoices" ? "Invoices settled" : "Credit notes settled"}
            fields={PAYMENT_LINE_COLUMNS}
            selected={layout.lineColumns}
            label={(column) => paymentLineColumnLabel(column, settles)}
            lockedFields={locked(PAYMENT_REQUIRED.lineColumns)}
            onChange={(lineColumns) => setLayout((current) => ({ ...current, lineColumns }))}
          />
          {canEdit ? (
            <div className={styles.modalActions}>
              <button className={styles.quiet} type="button" onClick={() => setLayout(defaultPaymentLayout(type.kind))}>
                Standard
              </button>
              <button className={styles.primary} type="submit" disabled={pending}>
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
            ? "A sample payment, so you can see the page before one exists. Organisation details are yours."
            : "Preview uses the latest payment of this type."}
        </p>
        <PrintedPayment view={view} />
      </div>
    </div>
  );
}
