"use client";

import { EInvoicePanel } from "@/components/EInvoicePanel";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import { formatInteger } from "@/lib/numbers";
import { formatExchangeRate, parseCurrencyRate } from "@/lib/currencies";
import { formatMoney, parseMoney } from "@/lib/documents";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { addDays, creditLabel } from "./shared";
import { FlexField } from "./FlexField";
import type { DocumentFormState } from "./useDocumentForm";
import { TotalsSummary } from "./TotalsSummary";

/** The Document, Notes and Payment tabs, with the totals under them. */
export function HeaderPane({ form }: { form: DocumentFormState }) {
  const { header, choices, typeId, transactionDate, setTransactionDate, dueDate, setDueDate, supplierId, termsDays, supplierName, setSupplierName, contactDetails, setContactDetails, notes, setNotes, currencyId, setExchangeRate, orderNumber, setOrderNumber, salesOrderReference, setSalesOrderReference, supplierReference, setSupplierReference, supplyDate, setSupplyDate, roundingAmount, setRoundingAmount, precedingHeaderId, precedingReference, setPrecedingReference, precedingDate, setPrecedingDate, buyerReference, setBuyerReference, contractReference, setContractReference, paymentTerms, setPaymentTerms, invoicePeriodStart, setInvoicePeriodStart, invoicePeriodEnd, setInvoicePeriodEnd, paymentMeansCode, setPaymentMeansCode, flex, setFlex, headerTab, setHeaderTab, ordersOpen, sales, posted, locked, selectedType, sameAsHome, rateValue, flexLabels, grnIndex, otherRefIndex, showFlex, parties, creditNote, orderDocument, canBringIn, paymentMeans, creditChoices, chooseSupplier, chooseCredit, openPanel } = form;
  return (
    <div className={styles.headerPane}>
            <div className={documentStyles.headerTabs} role="tablist" aria-label="Header">
              {([
                ["document", "Document"],
                ["notes", "Notes"],
                ["payment", "Payment"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  className={documentStyles.headerTab}
                  type="button"
                  role="tab"
                  id={`header-tab-${id}`}
                  aria-selected={headerTab === id}
                  aria-controls={`header-panel-${id}`}
                  tabIndex={headerTab === id ? 0 : -1}
                  onClick={() => setHeaderTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.headerBody}>
            <div
              className={`${styles.invoiceForm} ${styles.headerFields}`}
              id="header-panel-document"
              role="tabpanel"
              aria-labelledby="header-tab-document"
              hidden={headerTab !== "document"}
            >
            <input type="hidden" name="transaction_type_id" value={typeId} />
            <label className={styles.field}>
              Number
              <input
                readOnly
                value={
                  header?.documentNumber
                    || (header?.reference == null ? "Draft" : formatInteger(header?.reference))
                }
                placeholder={sales ? "Assigned on posting" : "Assigned on save"}
                className={styles.mono}
              />
            </label>
            {showFlex && otherRefIndex >= 0 ? (
              <FlexField index={otherRefIndex} label={flexLabels[otherRefIndex]} value={flex[otherRefIndex]} disabled={locked} onChange={setFlex} />
            ) : <span />}
            <label className={styles.field}>
              {sales ? "Customer code" : "Supplier code"}
              <select name={sales ? "customer_id" : "supplier_id"} required autoComplete="off" value={supplierId} disabled={locked} onChange={(event) => chooseSupplier(event.target.value)}>
                <option value="">{sales ? "Choose a customer" : "Choose a supplier"}</option>
                {parties.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.code} — {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              {sales ? "Customer name" : "Supplier name"}
              <QuietInput name="party_name" required maxLength={200} disabled={locked} value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
            </label>
            <div className={styles.fieldPair}>
              <label className={styles.field}>
                Currency
                <input type="hidden" name="currency_id" value={currencyId} />
                <input
                  readOnly
                  value={choices.currencies.find((currency) => currency.id === currencyId)?.code ?? ""}
                  placeholder={sales ? "From the customer" : "From the supplier"}
                  className={styles.mono}
                />
              </label>
              <label className={styles.field}>
                Exchange rate
                <QuietInput
                  name="exchange_rate"
                  required
                  inputMode="decimal"
                  readOnly={sameAsHome}
                  disabled={locked}
                  value={rateValue}
                  onChange={(event) => setExchangeRate(event.target.value)}
                  onBlur={(event) => {
                    if (sameAsHome) return;
                    if (parseCurrencyRate(event.target.value)) setExchangeRate(formatExchangeRate(event.target.value));
                  }}
                  className={styles.mono}
                />
              </label>
            </div>
            <div className={styles.fieldPair}>
              <label className={styles.field}>
                Transaction date
                <QuietInput
                  name="transaction_date"
                  type="date"
                  required
                  disabled={locked}
                  value={transactionDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (termsDays != null && dueDate === addDays(transactionDate, termsDays)) {
                      setDueDate(addDays(next, termsDays));
                    }
                    setTransactionDate(next);
                  }}
                />
              </label>
              <label className={styles.field}>
                Due date
                <QuietInput name="due_date" type="date" disabled={locked} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </label>
            </div>
            {sales ? <span /> : (
              <label className={styles.field}>
                Supplier invoice no.
                <QuietInput name="supplier_reference" maxLength={60} disabled={locked} value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} />
              </label>
            )}
            <div className={styles.fieldPair}>
              <label className={styles.field}>
                Supply date
                <QuietInput name="supply_date" type="date" disabled={locked} value={supplyDate} onChange={(event) => setSupplyDate(event.target.value)} />
              </label>
              {showFlex && grnIndex >= 0 ? <FlexField index={grnIndex} label={flexLabels[grnIndex]} value={flex[grnIndex]} disabled={locked} onChange={setFlex} /> : null}
            </div>
            <div className={documentStyles.fieldWithAction}>
              <label className={styles.field}>
                {sales ? "Customer order number" : "Order number"}
                <QuietInput name="order_number" maxLength={200} disabled={locked} value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} />
              </label>
              {canBringIn ? (
                <button
                  className={supplierId ? styles.primary : styles.quiet}
                  type="button"
                  aria-expanded={ordersOpen}
                  title={supplierId ? "Bring lines in from an active order" : `Choose a ${sales ? "customer" : "supplier"} first`}
                  onClick={() => openPanel("orders")}
                >
                  From order
                </button>
              ) : null}
            </div>
            {sales && !orderDocument ? (
              <label className={styles.field}>
                Sales order
                <QuietInput
                  name="sales_order_reference"
                  maxLength={200}
                  disabled={locked}
                  value={salesOrderReference}
                  onChange={(event) => setSalesOrderReference(event.target.value)}
                />
              </label>
            ) : null}
            <label className={styles.field}>
              Buyer reference
              <QuietInput name="buyer_reference" maxLength={100} disabled={locked} value={buyerReference} onChange={(event) => setBuyerReference(event.target.value)} />
            </label>
            <label className={styles.field}>
              Contract reference
              <QuietInput name="contract_reference" maxLength={60} disabled={locked} value={contractReference} onChange={(event) => setContractReference(event.target.value)} />
            </label>
            <div className={styles.fieldPair}>
              <label className={styles.field}>
                Period start
                <QuietInput name="invoice_period_start" type="date" disabled={locked} value={invoicePeriodStart} onChange={(event) => setInvoicePeriodStart(event.target.value)} />
              </label>
              <label className={styles.field}>
                Period end
                <QuietInput name="invoice_period_end" type="date" disabled={locked} value={invoicePeriodEnd} onChange={(event) => setInvoicePeriodEnd(event.target.value)} />
              </label>
              <span className={`${styles.panelMeta} ${styles.wide}`}>Enter both dates, or leave both blank.</span>
            </div>
            {showFlex ? flexLabels.map((label, index) => (
              index === grnIndex || index === otherRefIndex || !label.trim() ? null : (
                <FlexField key={index} index={index} label={label} value={flex[index]} disabled={locked} onChange={setFlex} />
              )
            )) : null}
            {creditNote ? (
              <>
                <label className={`${styles.field} ${styles.wide}`}>
                  Credits invoice
                  <select
                    name="preceding_header_id"
                    autoComplete="off"
                    value={precedingHeaderId}
                    disabled={locked}
                    onChange={(event) => chooseCredit(event.target.value)}
                  >
                    <option value="">Type a reference below</option>
                    {creditChoices.map((invoice) => (
                      <option key={invoice.id} value={invoice.id}>
                        {creditLabel(invoice)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Preceding invoice
                  <QuietInput
                    name="preceding_reference"
                    maxLength={60}
                    disabled={locked}
                    value={precedingReference}
                    onChange={(event) => setPrecedingReference(event.target.value)}
                    placeholder="Invoice reference"
                  />
                </label>
                <label className={styles.field}>
                  Preceding date
                  <QuietInput
                    name="preceding_date"
                    type="date"
                    disabled={locked}
                    value={precedingDate}
                    onChange={(event) => setPrecedingDate(event.target.value)}
                  />
                </label>
                <p className={`${styles.panelMeta} ${styles.wide}`}>
                  A credit note needs the invoice it applies to before it can be posted. Choose a posted invoice for this {sales ? "customer" : "supplier"}, or type the reference and date.
                </p>
              </>
            ) : null}
            {header && !orderDocument ? (
              <div className={styles.wide}>
                <EInvoicePanel
                  headerId={header.id}
                  sales={sales}
                  posted={posted}
                  documentKind={selectedType?.documentKind ?? ""}
                  foreignNett={header.foreignNettAmount}
                  foreignVat={header.foreignVatAmount}
                  foreignTotal={header.foreignTotalAmount}
                />
              </div>
            ) : null}
            </div>
            <div
              className={`${styles.invoiceForm} ${styles.headerFields}`}
              id="header-panel-notes"
              role="tabpanel"
              aria-labelledby="header-tab-notes"
              hidden={headerTab !== "notes"}
            >
              <label className={`${styles.field} ${styles.wide}`}>
                Notes
                <QuietTextarea name="notes" maxLength={4000} rows={8} spellCheck disabled={locked} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
            </div>
            <div
              className={`${styles.invoiceForm} ${styles.headerFields}`}
              id="header-panel-payment"
              role="tabpanel"
              aria-labelledby="header-tab-payment"
              hidden={headerTab !== "payment"}
            >
            <label className={styles.field}>
              Payment means
              <select
                name="payment_means_code"
                autoComplete="off"
                value={paymentMeansCode}
                disabled={locked}
                onChange={(event) => setPaymentMeansCode(event.target.value)}
              >
                <option value="">No payment means</option>
                {paymentMeans.some((means) => means.common) ? (
                  <optgroup label="Common">
                    {paymentMeans
                      .filter((means) => means.common)
                      .map((means) => (
                        <option key={means.code} value={means.code}>
                          {means.code} — {means.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                <optgroup label="All">
                  {paymentMeans
                    .filter((means) => !means.common)
                    .map((means) => (
                      <option key={means.code} value={means.code}>
                        {means.code} — {means.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
            <label className={`${styles.field} ${styles.wide}`}>
              Payment terms
              <QuietTextarea name="payment_terms" maxLength={400} rows={2} spellCheck disabled={locked} value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} />
            </label>
            <label className={styles.field}>
              Rounding
              <QuietInput
                name="rounding_amount"
                required
                inputMode="decimal"
                disabled={locked}
                value={roundingAmount}
                onChange={(event) => setRoundingAmount(event.target.value)}
                onBlur={(event) => {
                  if (parseMoney(event.target.value)) setRoundingAmount(formatMoney(event.target.value));
                }}
                className={styles.mono}
              />
            </label>
            <label className={styles.field}>
              Paid
              <QuietInput
                readOnly
                tabIndex={-1}
                value={header ? header.paidAmount : "0.00"}
                title="Worked out from payments, receipts and credit notes. It cannot be typed."
                className={styles.mono}
              />
            </label>
            <label className={styles.field}>
              Amount due
              <QuietInput
                readOnly
                tabIndex={-1}
                value={header ? header.amountDue : "0.00"}
                title="Worked out from payments, receipts and credit notes. It cannot be typed."
                className={styles.mono}
              />
            </label>
            <label className={`${styles.field} ${styles.wide}`}>
              Contact details
              <QuietTextarea name="contact_details" maxLength={500} rows={2} spellCheck disabled={locked} value={contactDetails} onChange={(event) => setContactDetails(event.target.value)} />
            </label>
            </div>
            </div>
    <TotalsSummary form={form} />
    </div>
  );
}
