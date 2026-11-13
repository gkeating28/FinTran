"use client";

import FormModal from "@/components/FormModal";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import UnitSelect from "@/components/UnitSelect";
import styles from "@/components/OpsPage.module.css";
import type { UnitChoice } from "@/lib/code-lists";
import { semanticText } from "@/lib/einvoice/semantic-read";
import { groupThousands } from "@/lib/numbers";
import type { Named, OpenLine, Vat } from "./types";
import { codeLabel, fieldMoney, moneyText, presentedLine } from "./format";

export function LineCoding({
  line,
  message,
  rates,
  glCodes,
  departments,
  costCentres,
  units,
  onChange,
  onSave,
  onCancel,
}: {
  line: OpenLine;
  message: string | null;
  rates: Vat[];
  glCodes: Named[];
  departments: Named[];
  costCentres: Named[];
  units: UnitChoice[];
  onChange: (line: OpenLine) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const view = presentedLine(line.source);
  const unitChoices =
    !view.unit || units.some((unit) => unit.code === view.unit) ? units : [{ code: view.unit, name: view.unit, common: true }, ...units];
  const extras = [
    view.name && view.name !== view.description ? `Item name ${view.name}` : "",
    view.base ? `Base quantity ${view.base}` : "",
    view.vatCategory || view.vatRate ? `Invoice VAT ${[view.vatCategory, view.vatRate ? `${view.vatRate}%` : ""].filter(Boolean).join(" ")}` : "",
    ...view.allowances.map((entry, index) => {
      const amount = semanticText(entry["BT-136"]);
      const reason = semanticText(entry["BT-140"]);
      return [`Allowance ${index + 1} ${amount}`, reason ? `reason ${reason}` : ""].filter(Boolean).join(", ");
    }),
  ].filter(Boolean);

  return (
    <FormModal title={`Edit line ${line.number}`} onClose={onCancel} className={styles.lineDialog}>
      <form
        className={`${styles.modalForm} ${styles.partyForm}`}
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {message ? (
          <p className={styles.alert} role="alert">
            {message}
          </p>
        ) : null}
        <label className={styles.field}>
          Product code
          <select value="" disabled>
            <option value="">No product</option>
          </select>
        </label>
        <label className={styles.field}>
          Description
          <QuietInput value={view.description} maxLength={200} disabled />
        </label>
        <label className={styles.field}>
          Unit
          <UnitSelect units={unitChoices} value={view.unit} disabled />
        </label>
        <label className={styles.field}>
          Seller item
          <QuietInput value={view.sellerItem} maxLength={60} disabled />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Line note
          <QuietTextarea value={view.note} maxLength={400} rows={2} disabled />
        </label>
        <label className={styles.field}>
          GL code
          <select autoComplete="off" value={line.glCodeId} onChange={(event) => onChange({ ...line, glCodeId: event.target.value })}>
            <option value="">No GL code</option>
            {glCodes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {codeLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Department code
          <select autoComplete="off" value={line.departmentId} onChange={(event) => onChange({ ...line, departmentId: event.target.value })}>
            <option value="">No department</option>
            {departments.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {codeLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Cost centre code
          <select autoComplete="off" value={line.costCentreId} onChange={(event) => onChange({ ...line, costCentreId: event.target.value })}>
            <option value="">No cost centre</option>
            {costCentres.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {codeLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          VAT code
          <select autoComplete="off" value={line.vatRateId} onChange={(event) => onChange({ ...line, vatRateId: event.target.value })}>
            <option value="">Choose a VAT code</option>
            {rates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} — {entry.description} ({groupThousands(entry.rate)}%)
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Quantity
          <QuietInput className={styles.mono} value={fieldMoney(view.quantity)} disabled />
        </label>
        <label className={styles.field}>
          Price
          <QuietInput className={styles.mono} value={fieldMoney(view.price)} disabled />
        </label>
        <label className={styles.field}>
          Discount amount
          <QuietInput className={styles.mono} value={view.discount} disabled />
        </label>
        <p className={`${styles.panelMeta} ${styles.wide}`}>
          Nett {moneyText(view.nett)} · VAT {view.vatAmount || "—"}
        </p>
        {extras.length ? <p className={`${styles.panelMeta} ${styles.wide}`}>{extras.join(" · ")}</p> : null}
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.primary} type="submit">
            Save line
          </button>
        </div>
      </form>
    </FormModal>
  );
}
