"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { createProduct, deleteProduct, updateProduct } from "@/lib/product-actions";
import type { ProductRow } from "@/lib/products";
import { type AccountType, type ReferenceRow, type VatType } from "@/lib/reference";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function ProductManager({
  rows,
  glCodes,
  vatRates,
  loadError,
  actionError,
}: {
  rows: ProductRow[];
  glCodes: ReferenceRow[];
  vatRates: ReferenceRow[];
  loadError: string | null;
  actionError?: string;
}) {
  const [draft, setDraft] = useState<ProductRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Products</h1>
        <p className={styles.lede}>
          Products for this organisation. Purchase GL codes are Expense accounts and purchase VAT
          codes are Expense rates. Sales GL codes are Income accounts and sales VAT codes are Sales
          rates.
        </p>
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
        searchPlaceholder="Search products"
        searchText={(row) =>
          `${row.code} ${row.description} ${row.purchasePrice} ${row.purchaseGlCode} ${row.purchaseVatCode} ${row.salesPrice} ${row.salesGlCode} ${row.salesVatCode}`
        }
        emptyLabel="No products yet for this organisation."
        minWidth="1080px"
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
          {
            key: "purchasePrice",
            label: "Purchase price",
            mono: true,
            align: "right",
            sortValue: (row) => row.purchasePrice,
            render: (row) => row.purchasePrice,
          },
          {
            key: "purchaseGl",
            label: "Purchase GL",
            mono: true,
            sortValue: (row) => row.purchaseGlCode,
            render: (row) => row.purchaseGlCode,
          },
          {
            key: "purchaseVat",
            label: "Purchase VAT",
            mono: true,
            sortValue: (row) => row.purchaseVatCode,
            render: (row) => row.purchaseVatCode,
          },
          {
            key: "salesPrice",
            label: "Sales price",
            mono: true,
            align: "right",
            sortValue: (row) => row.salesPrice,
            render: (row) => row.salesPrice,
          },
          {
            key: "salesGl",
            label: "Sales GL",
            mono: true,
            sortValue: (row) => row.salesGlCode,
            render: (row) => row.salesGlCode,
          },
          {
            key: "salesVat",
            label: "Sales VAT",
            mono: true,
            sortValue: (row) => row.salesVatCode,
            render: (row) => row.salesVatCode,
          },
        ]}
        actions={(row) => (
          <>
            <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
              Edit
            </button>
            <form action={deleteProduct}>
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
        <ProductForm
          key={draft === "new" ? "new" : draft.id}
          row={draft === "new" ? null : draft}
          glCodes={glCodes}
          vatRates={vatRates}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function onlyChoice(rows: ReferenceRow[]) {
  return rows.length === 1 ? rows[0].id : "";
}

function glChoices(rows: ReferenceRow[], type: AccountType, currentId?: string) {
  const matched = rows.filter((row) => row.accountType === type);
  if (!currentId || matched.some((row) => row.id === currentId)) return matched;
  const current = rows.find((row) => row.id === currentId);
  return current ? [current, ...matched] : matched;
}

function vatChoices(rows: ReferenceRow[], type: VatType, currentId?: string) {
  const matched = rows.filter((row) => row.vatType === type);
  if (!currentId || matched.some((row) => row.id === currentId)) return matched;
  const current = rows.find((row) => row.id === currentId);
  return current ? [current, ...matched] : matched;
}

function glLabel(row: ReferenceRow) {
  const type = row.accountType ? ` (${row.accountType})` : "";
  return `${row.code} — ${row.description}${type}`;
}

function vatLabel(row: ReferenceRow) {
  const rate = row.rate ? ` (${row.rate}%)` : "";
  return `${row.code} — ${row.description}${rate}`;
}

function ProductForm({
  row,
  glCodes,
  vatRates,
  onClose,
}: {
  row: ProductRow | null;
  glCodes: ReferenceRow[];
  vatRates: ReferenceRow[];
  onClose: () => void;
}) {
  const purchaseGlCodes = glChoices(glCodes, "Expense", row?.purchaseGlCodeId);
  const salesGlCodes = glChoices(glCodes, "Income", row?.salesGlCodeId);
  const purchaseVatRates = vatChoices(vatRates, "Expense", row?.purchaseVatCodeId);
  const salesVatRates = vatChoices(vatRates, "Sales", row?.salesVatCodeId);
  const save = row ? updateProduct : createProduct;
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [code, setCode] = useState(row?.code ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [purchasePrice, setPurchasePrice] = useState(row?.purchasePrice ?? "");
  const [salesPrice, setSalesPrice] = useState(row?.salesPrice ?? "");
  const [purchaseGlCodeId, setPurchaseGlCodeId] = useState(
    row?.purchaseGlCodeId ?? onlyChoice(purchaseGlCodes),
  );
  const [salesGlCodeId, setSalesGlCodeId] = useState(
    row?.salesGlCodeId ?? onlyChoice(salesGlCodes),
  );
  const [purchaseVatCodeId, setPurchaseVatCodeId] = useState(
    row?.purchaseVatCodeId ?? onlyChoice(purchaseVatRates),
  );
  const [salesVatCodeId, setSalesVatCodeId] = useState(
    row?.salesVatCodeId ?? onlyChoice(salesVatRates),
  );

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  const missing: string[] = [];
  if (purchaseGlCodes.length === 0) missing.push("Add an Expense GL code for purchases.");
  if (salesGlCodes.length === 0) missing.push("Add an Income GL code for sales.");
  if (purchaseVatRates.length === 0) missing.push("Add an Expense VAT rate for purchases.");
  if (salesVatRates.length === 0) missing.push("Add a Sales VAT rate for sales.");
  const blocked = missing.length > 0;

  return (
    <FormModal title={row ? "Edit product" : "Add product"} onClose={onClose} className={styles.partyDialog}>
      <form className={`${styles.modalForm} ${styles.partyForm}`} action={action} autoComplete="off" noValidate>
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
            maxLength={30}
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="WIDGET"
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
            placeholder="Blue notebook"
          />
        </label>
        <label className={styles.field}>
          Purchase price
          <QuietInput
            name="purchase_price"
            required
            inputMode="decimal"
            value={purchasePrice}
            onChange={(event) => setPurchasePrice(event.target.value)}
            placeholder="0.00"
            className={styles.mono}
          />
        </label>
        <label className={styles.field}>
          Sales price
          <QuietInput
            name="sales_price"
            required
            inputMode="decimal"
            value={salesPrice}
            onChange={(event) => setSalesPrice(event.target.value)}
            placeholder="0.00"
            className={styles.mono}
          />
        </label>
        <label className={styles.field}>
          Purchase GL code
          <select
            name="purchase_gl_code_id"
            required
            autoComplete="off"
            value={purchaseGlCodeId}
            onChange={(event) => setPurchaseGlCodeId(event.target.value)}
            disabled={purchaseGlCodes.length === 0}
          >
            <option value="" disabled>
              Choose an Expense GL code
            </option>
            {purchaseGlCodes.map((gl) => (
              <option key={gl.id} value={gl.id}>
                {glLabel(gl)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Sales GL code
          <select
            name="sales_gl_code_id"
            required
            autoComplete="off"
            value={salesGlCodeId}
            onChange={(event) => setSalesGlCodeId(event.target.value)}
            disabled={salesGlCodes.length === 0}
          >
            <option value="" disabled>
              Choose an Income GL code
            </option>
            {salesGlCodes.map((gl) => (
              <option key={gl.id} value={gl.id}>
                {glLabel(gl)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Purchase VAT code
          <select
            name="purchase_vat_code_id"
            required
            autoComplete="off"
            value={purchaseVatCodeId}
            onChange={(event) => setPurchaseVatCodeId(event.target.value)}
            disabled={purchaseVatRates.length === 0}
          >
            <option value="" disabled>
              Choose an Expense VAT rate
            </option>
            {purchaseVatRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {vatLabel(rate)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Sales VAT code
          <select
            name="sales_vat_code_id"
            required
            autoComplete="off"
            value={salesVatCodeId}
            onChange={(event) => setSalesVatCodeId(event.target.value)}
            disabled={salesVatRates.length === 0}
          >
            <option value="" disabled>
              Choose a Sales VAT rate
            </option>
            {salesVatRates.map((rate) => (
              <option key={rate.id} value={rate.id}>
                {vatLabel(rate)}
              </option>
            ))}
          </select>
        </label>
        {blocked ? <p className={`${styles.panelMeta} ${styles.wide}`}>{missing.join(" ")}</p> : null}
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} type="submit" disabled={pending || blocked}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
