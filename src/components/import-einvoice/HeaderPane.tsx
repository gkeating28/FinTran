"use client";

import { QuietInput, QuietTextarea } from "@/components/QuietField";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { semanticAt, semanticText } from "@/lib/einvoice/semantic-read";
import { dateValue, fieldMoney } from "./format";
import type { ImportFormState } from "./useImportForm";
import { TotalsSummary } from "./TotalsSummary";

/** The Document, Notes and Payment tabs, read from the e-invoice, with the totals under them. */
export function HeaderPane({ form }: { form: ImportFormState }) {
  const { semantic, documentNumber, creditNote, suppliers, supplierId, setSupplierId, purchaseTypes, typesReady, typeId, setTypeId, setShowCreate, savePeppol, setSavePeppol, code, setCode, name, setName, headerTab, setHeaderTab, createSupplier, sellerName, endpoint, totals, activeFlexLabels, grnIndex, otherRefIndex, showFlex, peppolMatch, vatMatch, matched, selected, rateText, currencyLabel, paymentCode, means, contact } = form;
  return (
    <div className={styles.headerPane}>
                    <div className={documentStyles.headerTabs} role="tablist" aria-label="Header">
                      {([
                        ["document", "Document"],
                        ["notes", "Notes"],
                        ["payment", "Payment"],
                      ] as const).map(([tab, label]) => (
                        <button
                          key={tab}
                          className={documentStyles.headerTab}
                          type="button"
                          role="tab"
                          id={`header-tab-${tab}`}
                          aria-selected={headerTab === tab}
                          aria-controls={`header-panel-${tab}`}
                          tabIndex={headerTab === tab ? 0 : -1}
                          onClick={() => setHeaderTab(tab)}
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
                        <label className={styles.field}>
                          Number
                          <input readOnly value="Draft" className={styles.mono} />
                        </label>
                        <label className={styles.field}>
                          Document type
                          <select value={typeId} onChange={(event) => setTypeId(event.target.value)} disabled={!typesReady || purchaseTypes.length === 0}>
                            <option value="">{purchaseTypes.length === 0 && typesReady ? "No Purchases types" : "Choose a type"}</option>
                            {purchaseTypes.map((type) => (
                              <option key={type.id} value={type.id}>
                                {type.code} — {type.description}
                              </option>
                            ))}
                          </select>
                        </label>
                        {showFlex && otherRefIndex >= 0 ? (
                          <label className={styles.field}>
                            {activeFlexLabels[otherRefIndex]}
                            <input value="" disabled />
                          </label>
                        ) : (
                          <span />
                        )}
                        <label className={styles.field}>
                          Supplier code
                          {createSupplier ? (
                            <input
                              value={code}
                              onChange={(event) => setCode(event.target.value.toUpperCase())}
                              maxLength={20}
                              className={styles.mono}
                            />
                          ) : (
                            <select
                              value={supplierId || matched?.id || ""}
                              onChange={(event) => {
                                if (event.target.value === "new") {
                                  setShowCreate(true);
                                  return;
                                }
                                setSupplierId(event.target.value);
                              }}
                            >
                              <option value="">Choose a supplier</option>
                              <option value="new">Create New</option>
                              {suppliers.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>
                                  {supplier.code} — {supplier.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </label>
                        <label className={styles.field}>
                          Supplier name
                          <QuietInput
                            maxLength={200}
                            disabled={!createSupplier}
                            value={createSupplier ? name : selected?.name || sellerName}
                            onChange={(event) => setName(event.target.value)}
                          />
                        </label>
                        <div className={styles.fieldPair}>
                          <label className={styles.field}>
                            Currency
                            <input readOnly value={currencyLabel} className={styles.mono} />
                          </label>
                          <label className={styles.field}>
                            Exchange rate
                            <input disabled value={rateText} className={styles.mono} />
                          </label>
                        </div>
                        <div className={styles.fieldPair}>
                          <label className={styles.field}>
                            Transaction date
                            <input type="date" disabled value={dateValue(semanticText(semantic?.["BT-2"]))} />
                          </label>
                          <label className={styles.field}>
                            Due date
                            <input type="date" disabled value={dateValue(semanticText(semantic?.["BT-9"]))} />
                          </label>
                        </div>
                        <label className={styles.field}>
                          Supplier invoice no.
                          <input disabled value={documentNumber || semanticText(semantic?.["BT-1"])} />
                        </label>
                        <div className={styles.fieldPair}>
                          <label className={styles.field}>
                            Supply date
                            <input type="date" disabled value={dateValue(semanticText(semantic?.["BT-72"]))} />
                          </label>
                          {showFlex && grnIndex >= 0 ? (
                            <label className={styles.field}>
                              {activeFlexLabels[grnIndex]}
                              <input value="" disabled />
                            </label>
                          ) : null}
                        </div>
                        <label className={styles.field}>
                          Order number
                          <input disabled value={semanticText(semantic?.["BT-13"])} />
                        </label>
                        <label className={styles.field}>
                          Buyer reference
                          <input disabled value={semanticText(semantic?.["BT-10"])} />
                        </label>
                        <label className={styles.field}>
                          Contract reference
                          <input disabled value={semanticText(semantic?.["BT-12"])} />
                        </label>
                        <div className={styles.fieldPair}>
                          <label className={styles.field}>
                            Period start
                            <input type="date" disabled value={dateValue(semanticAt(semantic, "BG-14", "BT-73"))} />
                          </label>
                          <label className={styles.field}>
                            Period end
                            <input type="date" disabled value={dateValue(semanticAt(semantic, "BG-14", "BT-74"))} />
                          </label>
                          <span className={`${styles.panelMeta} ${styles.wide}`}>Enter both dates, or leave both blank.</span>
                        </div>
                        {showFlex
                          ? activeFlexLabels.map((label, index) =>
                              index === grnIndex || index === otherRefIndex || !label.trim() ? null : (
                                <label key={`${label}-${index}`} className={styles.field}>
                                  {label}
                                  <input value="" disabled />
                                </label>
                              ),
                            )
                          : null}
                        {creditNote ? (
                          <>
                            <label className={`${styles.field} ${styles.wide}`}>
                              Credits invoice
                              <input disabled value={semanticAt(semantic, "BG-3", "BT-25")} />
                            </label>
                            <label className={styles.field}>
                              Preceding invoice
                              <input disabled value={semanticAt(semantic, "BG-3", "BT-25")} />
                            </label>
                            <label className={styles.field}>
                              Preceding date
                              <input type="date" disabled value={dateValue(semanticAt(semantic, "BG-3", "BT-26"))} />
                            </label>
                            <p className={`${styles.panelMeta} ${styles.wide}`}>
                              A credit note needs the invoice it applies to before it can be posted. Choose a posted invoice for this supplier, or type the reference and date.
                            </p>
                          </>
                        ) : null}
                        <p className={`${styles.panelMeta} ${styles.wide}`}>
                          {peppolMatch
                            ? `Matched supplier ${peppolMatch.code} — ${peppolMatch.name} by Peppol ID. `
                            : matched
                              ? `Matched supplier ${matched.code} — ${matched.name} by VAT number. `
                              : "No supplier matched. Choose Create New, or choose an existing supplier."}
                        </p>
                        {vatMatch && !peppolMatch && !vatMatch.peppol_id && endpoint.id ? (
                          <label className={`${styles.checkLine} ${styles.wide}`}>
                            <input type="checkbox" checked={savePeppol} onChange={(event) => setSavePeppol(event.target.checked)} />
                            Save this Peppol ID to the supplier
                          </label>
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
                          <QuietTextarea value={semanticText(semantic?.["BT-22"])} maxLength={4000} rows={8} disabled />
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
                          <select value={paymentCode} disabled>
                            <option value="">No payment means</option>
                            {means.some((meansRow) => meansRow.common) ? (
                              <optgroup label="Common">
                                {means
                                  .filter((meansRow) => meansRow.common)
                                  .map((meansRow) => (
                                    <option key={meansRow.code} value={meansRow.code}>
                                      {meansRow.code} — {meansRow.name}
                                    </option>
                                  ))}
                              </optgroup>
                            ) : null}
                            <optgroup label="All">
                              {means
                                .filter((meansRow) => !meansRow.common)
                                .map((meansRow) => (
                                  <option key={meansRow.code} value={meansRow.code}>
                                    {meansRow.code} — {meansRow.name}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        </label>
                        <label className={`${styles.field} ${styles.wide}`}>
                          Payment terms
                          <QuietTextarea value={semanticText(semantic?.["BT-20"])} maxLength={400} rows={2} disabled />
                        </label>
                        <label className={styles.field}>
                          Rounding
                          <input disabled value={fieldMoney(semanticText(totals?.["BT-114"]) || "0")} className={styles.mono} />
                        </label>
                        <label className={styles.field}>
                          Paid amount
                          <input disabled value={fieldMoney(semanticText(totals?.["BT-113"]) || "0")} className={styles.mono} />
                        </label>
                        <label className={`${styles.field} ${styles.wide}`}>
                          Contact details
                          <QuietTextarea value={contact} maxLength={500} rows={4} disabled />
                        </label>
                      </div>
                    </div>
    <TotalsSummary form={form} />
    </div>
  );
}
