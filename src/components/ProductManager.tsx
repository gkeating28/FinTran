"use client";

import { useActionState, useEffect, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { createProduct, deleteProduct, loadProductChoices, updateProduct } from "@/lib/product-actions";
import { formatProductPrice, parseProductPrice, type ProductRow } from "@/lib/products";
import { formatRate, type AccountType, type ReferenceRow, type VatType } from "@/lib/reference";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

export default function ProductManager({
  rows,
  glCodes,
  vatRates,
  loadError,
  actionError,
  canEdit = true,
}: {
  rows: ProductRow[];
  glCodes: ReferenceRow[];
  vatRates: ReferenceRow[];
  loadError: string | null;
  actionError?: string;
  canEdit?: boolean;
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
            key: "purchasePrice",
            label: "Purchase price",
            mono: true,
            align: "right",
            sortValue: (row) => row.purchasePrice.replace(/,/g, ""),
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
            sortValue: (row) => row.salesPrice.replace(/,/g, ""),
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
        actions={
          canEdit
            ? (row) => (
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
              )
            : undefined
        }
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

function accountSummary(rows: ReferenceRow[]) {
  return rows
    .map((row) => `${row.code} ${row.description} is ${row.accountType ?? "not set"}`)
    .join(". ");
}

function vatLabel(row: ReferenceRow) {
  const rate = row.rate ? ` (${formatRate(row.rate)})` : "";
  return `${row.code} — ${row.description}${rate}`;
}

function CodeLookup({
  name,
  value,
  onChange,
  placeholder,
  options,
  emptyText,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { id: string; label: string }[];
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === value);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;

  return (
    <div className={styles.lookup}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        className={styles.lookupButton}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label ?? placeholder}</span>
      </button>
      {open ? (
        <div className={styles.lookupMenu} role="listbox" aria-label={placeholder}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label={`Search ${placeholder}`}
            autoComplete="one-time-code"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {shown.length === 0 ? (
            <p className={styles.lookupEmpty}>{options.length === 0 ? emptyText : "No matches."}</p>
          ) : (
            shown.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                className={styles.lookupOption}
                onClick={() => {
                  onChange(option.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
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
  const [availableGlCodes, setAvailableGlCodes] = useState(glCodes);
  const [availableVatRates, setAvailableVatRates] = useState(vatRates);
  const [choicesReady, setChoicesReady] = useState(false);
  const purchaseGlCodes = glChoices(availableGlCodes, "Expense", row?.purchaseGlCodeId);
  const salesGlCodes = glChoices(availableGlCodes, "Income", row?.salesGlCodeId);
  const purchaseVatRates = vatChoices(availableVatRates, "Expense", row?.purchaseVatCodeId);
  const salesVatRates = vatChoices(availableVatRates, "Sales", row?.salesVatCodeId);
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
    let cancelled = false;
    loadProductChoices()
      .then((result) => {
      if (cancelled) return;
      if (!result.error) {
        setAvailableGlCodes(result.glCodes);
        setAvailableVatRates(result.vatRates);
        if (!row) {
          const expenseGl = result.glCodes.filter((gl) => gl.accountType === "Expense");
          const incomeGl = result.glCodes.filter((gl) => gl.accountType === "Income");
          const expenseVat = result.vatRates.filter((rate) => rate.vatType === "Expense");
          const salesVat = result.vatRates.filter((rate) => rate.vatType === "Sales");
          setPurchaseGlCodeId((current) => current || onlyChoice(expenseGl));
          setSalesGlCodeId((current) => current || onlyChoice(incomeGl));
          setPurchaseVatCodeId((current) => current || onlyChoice(expenseVat));
          setSalesVatCodeId((current) => current || onlyChoice(salesVat));
        }
      }
      setChoicesReady(true);
    })
      .catch(() => {
        if (!cancelled) setChoicesReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [row]);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  const missing: string[] = [];
  if (choicesReady && purchaseGlCodes.length === 0) missing.push("Add an Expense GL code for purchases.");
  if (choicesReady && salesGlCodes.length === 0) {
    const summary = accountSummary(availableGlCodes);
    missing.push(
      summary
        ? `Add an Income GL code for sales. ${summary}.`
        : "Add an Income GL code for sales.",
    );
  }
  if (choicesReady && purchaseVatRates.length === 0) missing.push("Add an Expense VAT rate for purchases.");
  if (choicesReady && salesVatRates.length === 0) missing.push("Add a Sales VAT rate for sales.");
  const blocked = !choicesReady || missing.length > 0;

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
            onBlur={(event) => {
              if (parseProductPrice(event.target.value)) setPurchasePrice(formatProductPrice(event.target.value));
            }}
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
            onBlur={(event) => {
              if (parseProductPrice(event.target.value)) setSalesPrice(formatProductPrice(event.target.value));
            }}
            placeholder="0.00"
            className={styles.mono}
          />
        </label>
        <label className={styles.field}>
          Purchase GL code
          <CodeLookup
            name="purchase_gl_code_id"
            value={purchaseGlCodeId}
            onChange={setPurchaseGlCodeId}
            placeholder="Choose an Expense GL code"
            options={purchaseGlCodes.map((gl) => ({ id: gl.id, label: glLabel(gl) }))}
            emptyText="No Expense GL codes."
          />
        </label>
        <label className={styles.field}>
          Sales GL code
          <CodeLookup
            name="sales_gl_code_id"
            value={salesGlCodeId}
            onChange={setSalesGlCodeId}
            placeholder="Choose an Income GL code"
            options={salesGlCodes.map((gl) => ({ id: gl.id, label: glLabel(gl) }))}
            emptyText={
              availableGlCodes.length === 0
                ? "Add a GL code with account type Income."
                : `No Income GL codes. ${accountSummary(availableGlCodes)}.`
            }
          />
        </label>
        <label className={styles.field}>
          Purchase VAT code
          <CodeLookup
            name="purchase_vat_code_id"
            value={purchaseVatCodeId}
            onChange={setPurchaseVatCodeId}
            placeholder="Choose an Expense VAT rate"
            options={purchaseVatRates.map((rate) => ({ id: rate.id, label: vatLabel(rate) }))}
            emptyText="No Expense VAT rates."
          />
        </label>
        <label className={styles.field}>
          Sales VAT code
          <CodeLookup
            name="sales_vat_code_id"
            value={salesVatCodeId}
            onChange={setSalesVatCodeId}
            placeholder="Choose a Sales VAT rate"
            options={salesVatRates.map((rate) => ({ id: rate.id, label: vatLabel(rate) }))}
            emptyText="No Sales VAT rates."
          />
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
