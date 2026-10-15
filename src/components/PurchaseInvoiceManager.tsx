"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import { deletePurchaseInvoice, savePurchaseInvoice } from "@/lib/purchase-invoice-actions";
import type { PurchaseInvoiceChoices } from "@/lib/purchase-invoice-data";
import { formatInteger, groupThousands, numberValue } from "@/lib/numbers";
import { formatExchangeRate, parseCurrencyRate } from "@/lib/currencies";
import {
  formatMoney,
  lineAmounts,
  parseMoney,
  toHome,
  type InvoiceCode,
  type InvoiceProduct,
  type InvoiceVat,
  type PurchaseInvoiceLine,
  type PurchaseInvoiceRow,
} from "@/lib/purchase-invoices";
import styles from "@/components/OpsPage.module.css";
import type { ActionState } from "@/lib/types";

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function FlexField({
  index,
  label,
  value,
  onChange,
}: {
  index: number;
  label: string;
  value: string;
  onChange: (update: (current: string[]) => string[]) => void;
}) {
  if (!label.trim()) return <div />;
  return (
    <label className={styles.field}>
      {label}
      <QuietInput
        name={`flex${index + 1}`}
        maxLength={200}
        value={value}
        onChange={(event) =>
          onChange((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
        }
      />
    </label>
  );
}

function codeLabel(row: { code: string; description: string }) {
  return `${row.code} — ${row.description}`;
}

function blankLine(): PurchaseInvoiceLine {
  return {
    lineNumber: 0,
    productId: "",
    productCode: "",
    description: "",
    glCodeId: "",
    departmentId: "",
    costCentreId: "",
    vatRateId: "",
    quantity: "1",
    price: "0.00",
    discountAmount: "0.00",
    nettAmount: "0.00",
    vatAmount: "0.00",
  };
}

export default function PurchaseInvoiceManager({
  rows,
  choices,
  loadError,
  actionError,
  title = "Purchase Invoices",
  summary,
  typeCode,
}: {
  rows: PurchaseInvoiceRow[];
  choices: PurchaseInvoiceChoices;
  loadError: string | null;
  actionError?: string;
  title?: string;
  summary?: string;
  typeCode?: string;
}) {
  const [draft, setDraft] = useState<PurchaseInvoiceRow | "new" | null>(null);
  const [lines, setLines] = useState<PurchaseInvoiceLine[] | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);

  function edit(row: PurchaseInvoiceRow) {
    setLineError(null);
    setLines(row.lines);
    setDraft(row);
  }

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{title}</h1>
        <p className={styles.lede}>
          {summary ??
            `${title} for this organisation. The reference comes from the transaction type, and the next number is one more than its last reference. Amounts in the home currency are the foreign amounts divided by the exchange rate.`}
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
        searchPlaceholder={`Search ${title.toLowerCase()}`}
        searchText={(row) =>
          `${row.transactionTypeCode} ${row.reference} ${formatInteger(row.reference)} ${row.supplierCode} ${row.supplierName} ${row.orderNumber} ${row.notes}`
        }
        emptyLabel={`No ${title.toLowerCase()} yet for this organisation.`}
        minWidth="980px"
        toolbar={
          <button
            className={styles.primary}
            type="button"
            onClick={() => {
              setLines([]);
              setLineError(null);
              setDraft("new");
            }}
          >
            Add
          </button>
        }
        columns={[
          {
            key: "type",
            label: "Type",
            mono: true,
            sortValue: (row) => row.transactionTypeCode,
            render: (row) => row.transactionTypeCode,
          },
          {
            key: "reference",
            label: "Reference",
            mono: true,
            sortValue: (row) => String(row.reference),
            render: (row) => formatInteger(row.reference),
          },
          {
            key: "date",
            label: "Date",
            mono: true,
            sortValue: (row) => row.transactionDate,
            render: (row) => row.transactionDate,
          },
          {
            key: "supplier",
            label: "Supplier",
            sortValue: (row) => row.supplierName,
            render: (row) => `${row.supplierCode} ${row.supplierName}`,
          },
          {
            key: "currency",
            label: "Currency",
            mono: true,
            sortValue: (row) => row.currencyCode,
            render: (row) => row.currencyCode,
          },
          {
            key: "foreignTotal",
            label: "Foreign total",
            mono: true,
            align: "right",
            sortValue: (row) => row.foreignTotalAmount.replace(/,/g, ""),
            render: (row) => row.foreignTotalAmount,
          },
          {
            key: "homeTotal",
            label: "Home total",
            mono: true,
            align: "right",
            sortValue: (row) => row.homeTotalAmount.replace(/,/g, ""),
            render: (row) => row.homeTotalAmount,
          },
          {
            key: "paid",
            label: "Paid",
            mono: true,
            align: "right",
            sortValue: (row) => row.paidAmount.replace(/,/g, ""),
            render: (row) => row.paidAmount,
          },
        ]}
        actions={(row) => (
          <>
            <button className={styles.quiet} type="button" onClick={() => edit(row)}>
              Edit
            </button>
            <form action={deletePurchaseInvoice}>
              <input type="hidden" name="id" value={row.id} />
              {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
              <button
                className={styles.quiet}
                type="submit"
                onClick={(event) => {
                  if (!window.confirm(`Remove ${row.transactionTypeCode} ${row.reference}?`)) event.preventDefault();
                }}
              >
                Remove
              </button>
            </form>
          </>
        )}
      />
      {draft ? (
        <InvoiceForm
          key={draft === "new" ? "new" : draft.id}
          header={draft === "new" ? null : draft}
          lines={lines}
          lineError={lineError}
          choices={choices}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function InvoiceForm({
  header,
  lines,
  lineError,
  choices,
  onClose,
}: {
  header: PurchaseInvoiceRow | null;
  lines: PurchaseInvoiceLine[] | null;
  lineError: string | null;
  choices: PurchaseInvoiceChoices;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(savePurchaseInvoice, {} as ActionState);
  const [typeId, setTypeId] = useState(header?.transactionTypeId ?? choices.types[0]?.id ?? "");
  const [transactionDate, setTransactionDate] = useState(header?.transactionDate ?? today());
  const [dueDate, setDueDate] = useState(header?.dueDate ?? "");
  const [supplierId, setSupplierId] = useState(header?.supplierId ?? "");
  const [supplierName, setSupplierName] = useState(header?.supplierName ?? "");
  const [contactDetails, setContactDetails] = useState(header?.contactDetails ?? "");
  const [notes, setNotes] = useState(header?.notes ?? "");
  const [currencyId, setCurrencyId] = useState(header?.currencyId ?? "");
  const [exchangeRate, setExchangeRate] = useState(header?.exchangeRate ?? "");
  const [orderNumber, setOrderNumber] = useState(header?.orderNumber ?? "");
  const [paidAmount, setPaidAmount] = useState(header?.paidAmount || "0.00");
  const [flex, setFlex] = useState([
    header?.flex1 ?? "",
    header?.flex2 ?? "",
    header?.flex3 ?? "",
    header?.flex4 ?? "",
    header?.flex5 ?? "",
  ]);
  const [invoiceLines, setInvoiceLines] = useState<PurchaseInvoiceLine[]>(lines ?? []);
  const [lineDraft, setLineDraft] = useState<PurchaseInvoiceLine | null>(null);
  const [lineMessage, setLineMessage] = useState<string | null>(null);

  useEffect(() => {
    if (lines) setInvoiceLines(lines);
  }, [lines]);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  const selectedType = choices.types.find((type) => type.id === typeId);
  const typeLocked = Boolean(header) || choices.types.length === 1;
  const supplierCurrency = choices.currencies.find((currency) => currency.id === currencyId)?.code ?? "";
  const homeCurrency = choices.homeCurrencyCode;
  const flexLabels = selectedType?.flexLabels ?? ["", "", "", "", ""];
  const showFlex = flexLabels.some((label) => label.trim());
  const expenseVat = choices.vatRates.filter((rate) => rate.vatType === "Expense");
  const totals = useMemo(() => {
    const foreignNett = invoiceLines.reduce((sum, line) => sum + numberValue(line.nettAmount), 0);
    const foreignVat = invoiceLines.reduce((sum, line) => sum + numberValue(line.vatAmount), 0);
    const foreignTotal = foreignNett + foreignVat;
    return {
      foreignNett,
      foreignVat,
      foreignTotal,
      homeNett: toHome(foreignNett, exchangeRate),
      homeVat: toHome(foreignVat, exchangeRate),
      homeTotal: toHome(foreignTotal, exchangeRate),
    };
  }, [exchangeRate, invoiceLines]);

  function chooseSupplier(id: string) {
    setSupplierId(id);
    const supplier = choices.suppliers.find((item) => item.id === id);
    if (!supplier) {
      setSupplierName("");
      setContactDetails("");
      setCurrencyId("");
      setExchangeRate("");
      return;
    }
    setSupplierName(supplier.name);
    setContactDetails(supplier.contactDetails);
    const currency = choices.currencies.find((item) => item.id === supplier.currencyId);
    if (!currency) {
      setCurrencyId("");
      setExchangeRate("");
      return;
    }
    setCurrencyId(currency.id);
    setExchangeRate(formatExchangeRate(currency.rate));
  }

  function saveLine() {
    if (!lineDraft) return;
    const description = lineDraft.description.trim();
    const vat = expenseVat.find((rate) => rate.id === lineDraft.vatRateId);
    const amounts = lineAmounts(lineDraft.quantity, lineDraft.price, lineDraft.discountAmount || "0", vat?.rate ?? null);
    if (!description) {
      setLineMessage("Enter a description.");
      return;
    }
    if (!amounts) {
      setLineMessage("Enter a quantity greater than 0 and a price of 0 or more.");
      return;
    }
    if ("error" in amounts) {
      setLineMessage("Discount cannot be more than quantity times price.");
      return;
    }
    const next = {
      ...lineDraft,
      description,
      productCode: choices.products.find((product) => product.id === lineDraft.productId)?.code ?? "",
      quantity: formatMoney(lineDraft.quantity),
      price: formatMoney(lineDraft.price),
      discountAmount: formatMoney(lineDraft.discountAmount || "0"),
      nettAmount: formatMoney(amounts.nett),
      vatAmount: formatMoney(amounts.vat),
    };
    setInvoiceLines((current) => {
      if (!lineDraft.lineNumber) {
        return [...current, { ...next, lineNumber: current.length + 1 }];
      }
      return current.map((line) =>
        line.lineNumber === lineDraft.lineNumber ? { ...next, lineNumber: line.lineNumber } : line,
      );
    });
    setLineDraft(null);
    setLineMessage(null);
  }

  const blocked =
    choices.types.length === 0 || choices.suppliers.length === 0 || choices.currencies.length === 0 || lines === null;

  return (
    <>
    <FormModal title={header ? "Edit purchase invoice" : "Add purchase invoice"} onClose={onClose} className={styles.invoiceDialog}>
      <form className={styles.modalForm} action={action} autoComplete="off" noValidate>
        {header ? <input type="hidden" name="id" value={header.id} /> : null}
        <input type="hidden" name="lines" value={JSON.stringify(invoiceLines)} />
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        {lineError ? (
          <p className={styles.alert} role="alert">
            {lineError}
          </p>
        ) : null}
        <div className={styles.invoiceSplit}>
        <div className={styles.headerPane}>
        <div className={styles.paneLabel}>Header</div>
        <div className={showFlex ? styles.invoiceForm : `${styles.invoiceForm} ${styles.invoiceFormPair}`}>
        <label className={styles.field}>
          Transaction type
          {typeLocked ? <input type="hidden" name="transaction_type_id" value={typeId} /> : null}
          <select
            name={typeLocked ? undefined : "transaction_type_id"}
            required
            autoComplete="off"
            value={typeId}
            disabled={typeLocked}
            onChange={(event) => setTypeId(event.target.value)}
          >
            <option value="">Choose a type</option>
            {choices.types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.code} — {type.description}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Reference
          <input
            readOnly
            value={header ? formatInteger(header.reference) : selectedType ? formatInteger(selectedType.nextReference) : ""}
            placeholder="Assigned on save"
            className={styles.mono}
          />
        </label>
        {showFlex ? <FlexField index={0} label={flexLabels[0]} value={flex[0]} onChange={setFlex} /> : null}
        <label className={styles.field}>
          Transaction date
          <QuietInput name="transaction_date" type="date" required value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} />
        </label>
        <label className={styles.field}>
          Due date
          <QuietInput name="due_date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        {showFlex ? <FlexField index={1} label={flexLabels[1]} value={flex[1]} onChange={setFlex} /> : null}
        <label className={styles.field}>
          Supplier code
          <select name="supplier_id" required autoComplete="off" value={supplierId} onChange={(event) => chooseSupplier(event.target.value)}>
            <option value="">Choose a supplier</option>
            {choices.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} — {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Supplier name
          <QuietInput name="supplier_name" required maxLength={200} value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
        </label>
        {showFlex ? <FlexField index={2} label={flexLabels[2]} value={flex[2]} onChange={setFlex} /> : null}
        <label className={styles.field}>
          Currency
          <input type="hidden" name="currency_id" value={currencyId} />
          <input
            readOnly
            value={choices.currencies.find((currency) => currency.id === currencyId)?.code ?? ""}
            placeholder="From the supplier"
            className={styles.mono}
          />
        </label>
        <label className={styles.field}>
          Exchange rate
          <QuietInput
            name="exchange_rate"
            required
            inputMode="decimal"
            value={exchangeRate}
            onChange={(event) => setExchangeRate(event.target.value)}
            onBlur={(event) => {
              if (parseCurrencyRate(event.target.value)) setExchangeRate(formatExchangeRate(event.target.value));
            }}
            className={styles.mono}
          />
        </label>
        {showFlex ? <FlexField index={3} label={flexLabels[3]} value={flex[3]} onChange={setFlex} /> : null}
        <label className={styles.field}>
          Order number
          <QuietInput name="order_number" maxLength={40} value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} />
        </label>
        <label className={styles.field}>
          Paid amount
          <QuietInput
            name="paid_amount"
            required
            inputMode="decimal"
            value={paidAmount}
            onChange={(event) => setPaidAmount(event.target.value)}
            onBlur={(event) => {
              if (parseMoney(event.target.value)) setPaidAmount(formatMoney(event.target.value));
            }}
            className={styles.mono}
          />
        </label>
        {showFlex ? <FlexField index={4} label={flexLabels[4]} value={flex[4]} onChange={setFlex} /> : null}
        <label className={`${styles.field} ${styles.wide}`}>
          Contact details
          <QuietTextarea name="contact_details" maxLength={500} rows={2} value={contactDetails} onChange={(event) => setContactDetails(event.target.value)} />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Notes
          <QuietTextarea name="notes" maxLength={4000} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <fieldset className={`${styles.wide} ${styles.amountBox}`}>
          <legend>Totals</legend>
          <table>
            <thead>
              <tr>
                <th />
                <th>Nett</th>
                <th>VAT</th>
                <th>Gross</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{supplierCurrency || "—"}</th>
                <td className={styles.mono}>{formatMoney(totals.foreignNett)}</td>
                <td className={styles.mono}>{formatMoney(totals.foreignVat)}</td>
                <td className={styles.mono}>{formatMoney(totals.foreignTotal)}</td>
              </tr>
              {supplierCurrency.toUpperCase() === homeCurrency.toUpperCase() ? null : (
                <tr>
                  <th>{homeCurrency || "—"}</th>
                  <td className={styles.mono}>{formatMoney(totals.homeNett)}</td>
                  <td className={styles.mono}>{formatMoney(totals.homeVat)}</td>
                  <td className={styles.mono}>{formatMoney(totals.homeTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </fieldset>
        </div>
        </div>
        <div className={styles.linesPane}>
          <div className={styles.gridToolbar}>
            <span className={styles.paneLabel}>Lines{lines === null ? "" : ` (${invoiceLines.length})`}</span>
            <button
              className={styles.primary}
              type="button"
              onClick={() => {
                setLineMessage(null);
                setLineDraft(blankLine());
              }}
            >
              Add line
            </button>
          </div>
          {lines === null ? (
            <p className={styles.empty}>Loading lines…</p>
          ) : (
            <div className={styles.lineScroll}>
              <div className={styles.lineTitleOffset} />
              <table className={styles.lineTable}>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Product</th>
                    <th>Description</th>
                    <th>GL</th>
                    <th>VAT</th>
                    <th className={styles.num}>Qty</th>
                    <th className={styles.num}>Nett</th>
                    <th className={styles.num}>VAT amount</th>
                    <th className={styles.actions}>&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceLines.length === 0 ? (
                    <tr>
                      <td colSpan={9}>No lines yet.</td>
                    </tr>
                  ) : (
                    invoiceLines.map((line) => (
                      <tr key={line.lineNumber}>
                        <td className={styles.mono}>{line.lineNumber}</td>
                        <td className={styles.mono}>{line.productCode}</td>
                        <td>{line.description}</td>
                        <td className={styles.mono}>{choices.glCodes.find((code) => code.id === line.glCodeId)?.code ?? ""}</td>
                        <td className={styles.mono}>{choices.vatRates.find((rate) => rate.id === line.vatRateId)?.code ?? ""}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.quantity}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.nettAmount}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.vatAmount}</td>
                        <td className={styles.actions}>
                          <button className={styles.quiet} type="button" onClick={() => { setLineMessage(null); setLineDraft(line); }}>
                            Edit
                          </button>
                          <button
                            className={styles.quiet}
                            type="button"
                            onClick={() =>
                              setInvoiceLines((current) =>
                                current
                                  .filter((item) => item.lineNumber !== line.lineNumber)
                                  .map((item, index) => ({ ...item, lineNumber: index + 1 })),
                              )
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={6}>Total</th>
                    <td className={`${styles.mono} ${styles.num}`}>{formatMoney(totals.foreignNett)}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{formatMoney(totals.foreignVat)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        </div>
        {choices.types.length === 0 ? (
          <p className={`${styles.panelMeta} ${styles.wide}`}>Add a Purchases transaction type before saving an invoice.</p>
        ) : null}
        {choices.suppliers.length === 0 ? (
          <p className={`${styles.panelMeta} ${styles.wide}`}>Add a supplier before saving an invoice.</p>
        ) : null}
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} type="submit" disabled={pending || blocked || !supplierId}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </FormModal>
    {lineDraft ? (
      <LineEditor
        draft={lineDraft}
        products={choices.products}
        glCodes={choices.glCodes}
        departments={choices.departments}
        costCentres={choices.costCentres}
        vatRates={expenseVat}
        message={lineMessage}
        onChange={setLineDraft}
        onSave={saveLine}
        onCancel={() => {
          setLineDraft(null);
          setLineMessage(null);
        }}
      />
    ) : null}
    </>
  );
}

function LineEditor({
  draft,
  products,
  glCodes,
  departments,
  costCentres,
  vatRates,
  message,
  onChange,
  onSave,
  onCancel,
}: {
  draft: PurchaseInvoiceLine;
  products: InvoiceProduct[];
  glCodes: InvoiceCode[];
  departments: InvoiceCode[];
  costCentres: InvoiceCode[];
  vatRates: InvoiceVat[];
  message: string | null;
  onChange: (line: PurchaseInvoiceLine) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function chooseProduct(id: string) {
    const product = products.find((item) => item.id === id);
    onChange({
      ...draft,
      productId: id,
      description: product?.description ?? draft.description,
      price: product?.purchasePrice ?? draft.price,
      glCodeId: product?.purchaseGlCodeId ?? draft.glCodeId,
      vatRateId: product?.purchaseVatCodeId ?? draft.vatRateId,
    });
  }

  const vat = vatRates.find((rate) => rate.id === draft.vatRateId);
  const amounts = lineAmounts(draft.quantity, draft.price, draft.discountAmount || "0", vat?.rate ?? null);
  const preview = amounts && !("error" in amounts) ? amounts : null;

  return (
    <FormModal title={draft.lineNumber ? `Edit line ${draft.lineNumber}` : "Add line"} onClose={onCancel} className={styles.lineDialog}>
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
        <select autoComplete="off" value={draft.productId} onChange={(event) => chooseProduct(event.target.value)}>
          <option value="">No product</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.code} — {product.description}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Description
        <QuietInput value={draft.description} maxLength={200} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
      </label>
      <label className={styles.field}>
        GL code
        <select autoComplete="off" value={draft.glCodeId} onChange={(event) => onChange({ ...draft, glCodeId: event.target.value })}>
          <option value="">No GL code</option>
          {glCodes.map((code) => (
            <option key={code.id} value={code.id}>
              {codeLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Department code
        <select autoComplete="off" value={draft.departmentId} onChange={(event) => onChange({ ...draft, departmentId: event.target.value })}>
          <option value="">No department</option>
          {departments.map((code) => (
            <option key={code.id} value={code.id}>
              {codeLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Cost centre code
        <select autoComplete="off" value={draft.costCentreId} onChange={(event) => onChange({ ...draft, costCentreId: event.target.value })}>
          <option value="">No cost centre</option>
          {costCentres.map((code) => (
            <option key={code.id} value={code.id}>
              {codeLabel(code)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        VAT code
        <select autoComplete="off" value={draft.vatRateId} onChange={(event) => onChange({ ...draft, vatRateId: event.target.value })}>
          <option value="">No VAT</option>
          {vatRates.map((rate) => (
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
          onChange={(event) => onChange({ ...draft, discountAmount: event.target.value })}
          onBlur={(event) => {
            if (parseMoney(event.target.value || "0")) onChange({ ...draft, discountAmount: formatMoney(event.target.value || "0") });
          }}
        />
      </label>
      <p className={`${styles.panelMeta} ${styles.wide}`}>
        Nett {preview ? formatMoney(preview.nett) : "—"} · VAT {preview ? formatMoney(preview.vat) : "—"}
      </p>
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
