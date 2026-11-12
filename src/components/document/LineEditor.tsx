"use client";

import FormModal from "@/components/FormModal";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import UnitSelect from "@/components/UnitSelect";
import type { DocumentChoices } from "@/lib/document-data";
import { groupThousands } from "@/lib/numbers";
import { parseAmount } from "@/lib/products";
import { formatMoney, lineAmounts, parseMoney, type DocumentLine, type InvoiceCode, type InvoiceProduct, type InvoiceVat } from "@/lib/documents";
import styles from "@/components/OpsPage.module.css";

export function codeLabel(row: { code: string; description: string }) {
  return `${row.code} — ${row.description}`;
}

export function choicesWithCurrent(products: InvoiceProduct[], id: string, code: string, description: string) {
  if (!id || products.some((product) => product.id === id)) return products;
  return [
    {
      id,
      code: code || id,
      description,
      purchasePrice: "",
      salesPrice: "",
      purchaseGlCodeId: "",
      salesGlCodeId: "",
      purchaseVatCodeId: "",
      salesVatCodeId: "",
      unitCode: "",
    },
    ...products,
  ];
}

export function withCurrent<T extends { id: string }>(rows: T[], id: string, extra: T) {
  if (!id || rows.some((row) => row.id === id)) return rows;
  return [extra, ...rows];
}

export function LineEditor({
  draft,
  products,
  units,
  glCodes,
  departments,
  costCentres,
  vatRates,
  sales = false,
  readOnly = false,
  message,
  onChange,
  onSave,
  onCancel,
}: {
  draft: DocumentLine;
  products: InvoiceProduct[];
  units: DocumentChoices["units"];
  glCodes: InvoiceCode[];
  departments: InvoiceCode[];
  costCentres: InvoiceCode[];
  vatRates: InvoiceVat[];
  sales?: boolean;
  readOnly?: boolean;
  message: string | null;
  onChange: (line: DocumentLine) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function chooseProduct(id: string) {
    const product = products.find((item) => item.id === id);
    onChange({
      ...draft,
      productId: id,
      description: product?.description ?? draft.description,
      price: (sales ? product?.salesPrice : product?.purchasePrice) ?? draft.price,
      unitCode: product?.unitCode || draft.unitCode || "C62",
      glCodeId: (sales ? product?.salesGlCodeId : product?.purchaseGlCodeId) ?? draft.glCodeId,
      vatRateId: (sales ? product?.salesVatCodeId : product?.purchaseVatCodeId) ?? draft.vatRateId,
    });
  }

  const vat = vatRates.find((rate) => rate.id === draft.vatRateId);
  const amounts = lineAmounts(draft.quantity, draft.price, draft.discountAmount || "0", vat?.rate ?? null);
  const preview = amounts && !("error" in amounts) ? amounts : null;
  const productChoices = choicesWithCurrent(products, draft.productId, draft.productCode, draft.description);
  const unitChoices =
    !draft.unitCode || units.some((unit) => unit.code === draft.unitCode)
      ? units
      : [{ code: draft.unitCode, name: draft.unitCode, common: true }, ...units];
  const title = readOnly ? `Line ${draft.lineNumber}` : draft.lineNumber ? `Edit line ${draft.lineNumber}` : "Add line";

  return (
    <FormModal title={title} onClose={onCancel} className={styles.lineDialog}>
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
        <select autoComplete="off" value={draft.productId} disabled={readOnly} onChange={(event) => chooseProduct(event.target.value)}>
          <option value="">No product</option>
          {productChoices.map((product) => (
            <option key={product.id} value={product.id}>
              {product.code} — {product.description}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Description
        <QuietInput value={draft.description} maxLength={200} spellCheck disabled={readOnly} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
      </label>
      <label className={styles.field}>
        Unit
        <UnitSelect units={unitChoices} value={draft.unitCode || "C62"} disabled={readOnly} onChange={(unitCode) => onChange({ ...draft, unitCode })} />
      </label>
      <label className={styles.field}>
        {sales ? "Customer order line" : "Order line"}
        <QuietInput
          value={draft.orderLineReference ?? ""}
          maxLength={60}
          disabled={readOnly}
          onChange={(event) => onChange({ ...draft, orderLineReference: event.target.value })}
          placeholder={sales ? "Line on the customer's order" : "Line on the order"}
        />
      </label>
      {draft.canReturnToOrder ? (
        <label className={styles.checkLine}>
          <input
            type="checkbox"
            checked={draft.returnsToOrder === true}
            disabled={readOnly}
            onChange={(event) => onChange({ ...draft, returnsToOrder: event.target.checked })}
          />
          Return to order. Posting this credit note gives the quantity back to the order, to be invoiced again. Untick for a price-only credit.
        </label>
      ) : null}
      {sales ? null : (
      <label className={styles.field}>
        Seller item
        <QuietInput
          value={draft.sellerItemId}
          maxLength={60}
          disabled={readOnly}
          onChange={(event) => onChange({ ...draft, sellerItemId: event.target.value })}
          placeholder="Supplier's item code"
        />
      </label>
      )}
      <label className={`${styles.field} ${styles.wide}`}>
        Line note
        <QuietTextarea
          value={draft.lineNote}
          maxLength={400}
          rows={2}
          spellCheck
          disabled={readOnly}
          onChange={(event) => onChange({ ...draft, lineNote: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        GL code
        <select autoComplete="off" value={draft.glCodeId} disabled={readOnly} onChange={(event) => onChange({ ...draft, glCodeId: event.target.value })}>
          <option value="">No GL code</option>
          {withCurrent(glCodes, draft.glCodeId, { id: draft.glCodeId, code: "Unavailable", description: "" }).map((code) => (
            <option key={code.id} value={code.id}>
              {codeLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Department code
        <select autoComplete="off" value={draft.departmentId} disabled={readOnly} onChange={(event) => onChange({ ...draft, departmentId: event.target.value })}>
          <option value="">No department</option>
          {withCurrent(departments, draft.departmentId, { id: draft.departmentId, code: "Unavailable", description: "" }).map((code) => (
            <option key={code.id} value={code.id}>
              {codeLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Cost centre code
        <select autoComplete="off" value={draft.costCentreId} disabled={readOnly} onChange={(event) => onChange({ ...draft, costCentreId: event.target.value })}>
          <option value="">No cost centre</option>
          {withCurrent(costCentres, draft.costCentreId, { id: draft.costCentreId, code: "Unavailable", description: "" }).map((code) => (
            <option key={code.id} value={code.id}>
              {codeLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        VAT code
        <select autoComplete="off" value={draft.vatRateId} disabled={readOnly} onChange={(event) => onChange({ ...draft, vatRateId: event.target.value })}>
          <option value="">No VAT</option>
          {withCurrent(vatRates, draft.vatRateId, {
            id: draft.vatRateId,
            code: "Unavailable",
            description: "",
            rate: "0",
            vatType: "Expense",
            vatCategory: "",
            exemptionReason: "",
          }).map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rate.code} — {rate.description} ({groupThousands(rate.rate)}%)
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Quantity
        <QuietInput
          className={styles.mono}
          inputMode="decimal"
          value={draft.quantity}
          disabled={readOnly}
          onChange={(event) => onChange({ ...draft, quantity: event.target.value })}
          onBlur={(event) => {
            if (parseMoney(event.target.value)) onChange({ ...draft, quantity: formatMoney(event.target.value) });
          }}
        />
      </label>
      <label className={styles.field}>
        Price
        <QuietInput
          className={styles.mono}
          inputMode="decimal"
          value={draft.price}
          disabled={readOnly}
          onChange={(event) => onChange({ ...draft, price: event.target.value })}
          onBlur={(event) => {
            if (parseMoney(event.target.value)) onChange({ ...draft, price: formatMoney(event.target.value) });
          }}
        />
      </label>
      <label className={styles.field}>
        Discount amount
        <QuietInput
          className={styles.mono}
          inputMode="decimal"
          value={draft.discountAmount}
          disabled={readOnly}
          onChange={(event) => onChange({ ...draft, discountAmount: event.target.value })}
          onBlur={(event) => {
            if (parseAmount(event.target.value || "0")) onChange({ ...draft, discountAmount: formatMoney(event.target.value || "0") });
          }}
        />
      </label>
      <p className={`${styles.panelMeta} ${styles.wide}`}>
        Nett {readOnly ? draft.nettAmount : preview ? formatMoney(preview.nett) : "—"} · VAT{" "}
        {readOnly ? draft.vatAmount : preview ? formatMoney(preview.vat) : "—"}
      </p>
      <div className={styles.modalActions}>
        <button className={styles.quiet} type="button" onClick={onCancel}>
          {readOnly ? "Close" : "Cancel"}
        </button>
        {readOnly ? null : (
          <button className={styles.primary} type="submit">
            Save line
          </button>
        )}
      </div>
    </form>
    </FormModal>
  );
}
