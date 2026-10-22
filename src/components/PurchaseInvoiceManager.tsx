"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import UnitSelect from "@/components/UnitSelect";
import {
  createCreditNote,
  deletePurchaseInvoice,
  postPurchaseInvoice,
  savePurchaseInvoice,
  updatePaidAmount,
  voidPurchaseInvoice,
} from "@/lib/purchase-invoice-actions";
import type { PurchaseInvoiceChoices } from "@/lib/purchase-invoice-data";
import { readinessHref } from "@/lib/en16931";
import { formatInteger, groupThousands, numberValue } from "@/lib/numbers";
import { formatExchangeRate, parseCurrencyRate } from "@/lib/currencies";
import {
  breakdownFromLines,
  formatMoney,
  lineAmounts,
  parseMoney,
  roundCents,
  toHome,
  type CreditInvoice,
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

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + days);
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

function termsText(days: number) {
  if (days === 0) return "Due on receipt";
  if (days === 1) return "Payment due within 1 day";
  return `Payment due within ${days} days`;
}

const SPLIT_WIDTH_KEY = "fintran.transactionSplitWidth";
const SPLIT_HANDLE = 10;
const SPLIT_MIN = 280;

type HeaderTab = "document" | "payment";

function clampSplit(width: number, container: number) {
  const max = Math.max(SPLIT_MIN, container - SPLIT_MIN - SPLIT_HANDLE);
  return Math.round(Math.min(max, Math.max(SPLIT_MIN, width)));
}

function FlexField({
  index,
  label,
  value,
  disabled,
  onChange,
}: {
  index: number;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (update: (current: string[]) => string[]) => void;
}) {
  if (!label.trim()) return <div />;
  return (
    <label className={styles.field}>
      {label}
      <QuietInput
        name={`flex${index + 1}`}
        maxLength={200}
        disabled={disabled}
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
    unitCode: "C62",
    lineNote: "",
    sellerItemId: "",
  };
}

function creditLabel(invoice: CreditInvoice) {
  const reference = invoice.reference == null ? "—" : formatInteger(invoice.reference);
  return `${invoice.typeCode} ${reference} · ${invoice.transactionDate}`;
}

export default function PurchaseInvoiceManager({
  rows,
  choices,
  loadError,
  actionError,
  title = "Purchase Invoices",
  summary,
  typeCode,
  direction = "Purchases",
  openId,
  canVoid = false,
  canDownload = false,
}: {
  rows: PurchaseInvoiceRow[];
  choices: PurchaseInvoiceChoices;
  loadError: string | null;
  actionError?: string;
  title?: string;
  summary?: string;
  typeCode?: string;
  direction?: "Sales" | "Purchases";
  openId?: string;
  canVoid?: boolean;
  canDownload?: boolean;
}) {
  const pathname = usePathname();
  const sales = direction === "Sales";
  const [draft, setDraft] = useState<PurchaseInvoiceRow | "new" | null>(null);
  const [lines, setLines] = useState<PurchaseInvoiceLine[] | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [readinessFilter, setReadinessFilter] = useState("");

  useEffect(() => {
    setDraft(null);
    setLines(null);
    setLineError(null);
  }, [pathname]);

  useEffect(() => {
    if (!openId) return;
    const row = rows.find((item) => item.id === openId);
    if (!row) return;
    setLines(row.lines);
    setDraft(row);
  }, [openId, rows]);

  const parties = sales ? choices.customers : choices.suppliers;
  const visibleRows = rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    const partyId = sales ? row.customerId : row.supplierId;
    if (partyFilter && partyId !== partyFilter) return false;
    if (fromDate && row.transactionDate < fromDate) return false;
    if (toDate && row.transactionDate > toDate) return false;
    if (sales && readinessFilter) {
      const status = readinessStatus(row.readiness);
      if (status !== readinessFilter) return false;
    }
    return true;
  });

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
            `${title} for this organisation. The reference comes from the transaction type, and the next number is one more than its last reference. Amounts in the home currency are the foreign amounts divided by the exchange rate.`}{" "}
          {typeCode ? <Link href={`/forms/${typeCode}`}>Design the printed form.</Link> : null}
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
        rows={visibleRows}
        searchPlaceholder={`Search ${title.toLowerCase()}`}
        searchText={(row) =>
          `${row.transactionTypeCode} ${row.documentNumber} ${row.reference ?? ""} ${row.supplierCode} ${row.supplierName} ${row.orderNumber} ${row.notes} ${statusLabel(row.status)} ${row.voidReason}`
        }
        emptyLabel={`No ${title.toLowerCase()} yet for this organisation.`}
        minWidth="980px"
        toolbar={
          <>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status">
              <option value="">Any status</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="void">Void</option>
            </select>
            <select value={partyFilter} onChange={(event) => setPartyFilter(event.target.value)} aria-label={sales ? "Customer" : "Supplier"}>
              <option value="">{sales ? "Any customer" : "Any supplier"}</option>
              {parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.code}
                </option>
              ))}
            </select>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="From date" />
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="To date" />
            {sales ? (
              <select value={readinessFilter} onChange={(event) => setReadinessFilter(event.target.value)} aria-label="Readiness">
                <option value="">Any readiness</option>
                <option value="error">Errors</option>
                <option value="warning">Warnings</option>
                <option value="ready">Ready</option>
              </select>
            ) : null}
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
          </>
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
            label: "Number",
            mono: true,
            sortValue: (row) => row.documentNumber || String(row.reference ?? ""),
            render: (row) => row.documentNumber || (row.reference == null ? "Draft" : formatInteger(row.reference)),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (row) => row.status,
            render: (row) => statusLabel(row.status),
          },
          {
            key: "readiness",
            label: "Readiness",
            sortValue: (row) => String(row.readiness.filter((item) => item.severity === "error").length * 100 + row.readiness.length),
            render: (row) => <ReadinessControl items={row.readiness} direction={direction} />,
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
            label: sales ? "Customer" : "Supplier",
            sortValue: (row) => row.supplierName,
            render: (row) => `${row.supplierCode} ${row.supplierName}`,
          },
          {
            key: "due",
            label: "Due",
            mono: true,
            sortValue: (row) => row.dueDate,
            render: (row) => row.dueDate,
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
          {
            key: "dueAmount",
            label: "Amount due",
            mono: true,
            align: "right",
            sortValue: (row) => row.amountDue.replace(/,/g, ""),
            render: (row) => row.amountDue,
          },
        ]}
        actions={(row) => (
          <>
            <Link className={styles.quiet} href={`/print/${row.transactionTypeCode}/${row.id}`}>
              Print
            </Link>
            {row.status === "draft" ? (
              <>
                <button className={styles.quiet} type="button" onClick={() => edit(row)}>
                  Edit
                </button>
                <form action={postPurchaseInvoice}>
                  <input type="hidden" name="id" value={row.id} />
                  {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
                  <button className={styles.quiet} type="submit">
                    Post
                  </button>
                </form>
                <form action={deletePurchaseInvoice}>
                  <input type="hidden" name="id" value={row.id} />
                  {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
                  <button
                    className={styles.quiet}
                    type="submit"
                    onClick={(event) => {
                      if (!window.confirm(`Remove ${row.transactionTypeCode} ${row.documentNumber || "draft"}?`)) event.preventDefault();
                    }}
                  >
                    Remove
                  </button>
                </form>
              </>
            ) : (
              <button className={styles.quiet} type="button" onClick={() => edit(row)}>
                View
              </button>
            )}
          </>
        )}
      />
      {draft ? (
        <InvoiceForm
          key={draft === "new" ? "new" : draft.id}
          title={title}
          header={draft === "new" ? null : draft}
          lines={lines}
          lineError={lineError}
          choices={choices}
          typeCode={typeCode}
          direction={direction}
          canVoid={canVoid}
          canDownload={canDownload}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function statusLabel(status: PurchaseInvoiceRow["status"]) {
  if (status === "posted") return "Posted";
  if (status === "void") return "Void";
  return "Draft";
}

function readinessStatus(items: PurchaseInvoiceRow["readiness"]) {
  if (items.some((item) => item.severity === "error")) return "error" as const;
  if (items.length > 0) return "warning" as const;
  return "ready" as const;
}

function readinessSummary(items: PurchaseInvoiceRow["readiness"], direction: "Sales" | "Purchases" = "Purchases") {
  const errors = items.filter((item) => item.severity === "error").length;
  const warnings = items.filter((item) => item.severity === "warning").length;
  if (errors > 0) {
    return `${errors} error${errors === 1 ? "" : "s"}. Posting is blocked until these are fixed.`;
  }
  if (warnings > 0) {
    return direction === "Sales"
      ? `${warnings} warning${warnings === 1 ? "" : "s"}.`
      : `${warnings} warning${warnings === 1 ? "" : "s"}. A purchase can still be posted.`;
  }
  return "Ready. This document has the data needed for an EN 16931 invoice.";
}

function ReadinessList({ items, direction }: { items: PurchaseInvoiceRow["readiness"]; direction: "Sales" | "Purchases" }) {
  return (
    <ul className={styles.readinessList}>
      {items.map((item, index) => {
        const href = readinessHref(item.businessTerm, direction);
        const label = href === "/customers" ? "Open Customers" : href === "/suppliers" ? "Open Suppliers" : "Open Organisations";
        return (
          <li key={`${item.ruleId}-${item.businessTerm}-${index}`} className={styles.readinessItem} data-status={item.severity}>
            <div className={styles.readinessRule}>{item.ruleId}</div>
            <p>{item.message}</p>
            {href ? <Link href={href}>{label}</Link> : <p className={styles.panelMeta}>Enter this on the document.</p>}
          </li>
        );
      })}
    </ul>
  );
}

function ReadinessControl({ items, direction }: { items: PurchaseInvoiceRow["readiness"]; direction: "Sales" | "Purchases" }) {
  const [open, setOpen] = useState(false);
  const status = readinessStatus(items);

  return (
    <>
      <button
        className={styles.readinessButton}
        data-status={status}
        type="button"
        onClick={() => setOpen(true)}
      >
        Readiness
      </button>
      {open ? (
        <FormModal title="Readiness" className={styles.readinessDialog} onClose={() => setOpen(false)}>
          <div className={styles.readinessBody}>
            <p className={styles.readinessSummary} data-status={status}>
              {readinessSummary(items, direction)}
            </p>
            {items.length > 0 ? <ReadinessList items={items} direction={direction} /> : null}
          </div>
        </FormModal>
      ) : null}
    </>
  );
}

function InvoiceForm({
  title,
  header,
  lines,
  lineError,
  choices,
  typeCode,
  direction,
  canVoid,
  canDownload,
  onClose,
}: {
  title: string;
  header: PurchaseInvoiceRow | null;
  lines: PurchaseInvoiceLine[] | null;
  lineError: string | null;
  choices: PurchaseInvoiceChoices;
  typeCode?: string;
  direction: "Sales" | "Purchases";
  canVoid: boolean;
  canDownload: boolean;
  onClose: () => void;
}) {
  const sales = direction === "Sales";
  const posted = header?.status === "posted";
  const voided = header?.status === "void";
  const locked = posted || voided;
  const [saveState, saveAction, savePending] = useActionState(savePurchaseInvoice, {} as ActionState);
  const [paidState, paidAction, paidPending] = useActionState(updatePaidAmount, {} as ActionState);
  const state = posted ? paidState : saveState;
  const action = posted ? paidAction : saveAction;
  const pending = posted ? paidPending : savePending;
  const [typeId, setTypeId] = useState(header?.transactionTypeId ?? choices.types[0]?.id ?? "");
  const [transactionDate, setTransactionDate] = useState(header?.transactionDate ?? today());
  const [dueDate, setDueDate] = useState(header?.dueDate ?? "");
  const [supplierId, setSupplierId] = useState(header ? (sales ? header.customerId : header.supplierId) : "");
  const [termsDays, setTermsDays] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState(header?.supplierName ?? "");
  const [contactDetails, setContactDetails] = useState(header?.contactDetails ?? "");
  const [notes, setNotes] = useState(header?.notes ?? "");
  const [currencyId, setCurrencyId] = useState(header?.currencyId ?? "");
  const [exchangeRate, setExchangeRate] = useState(header?.exchangeRate ?? "");
  const [orderNumber, setOrderNumber] = useState(header?.orderNumber ?? "");
  const [supplierReference, setSupplierReference] = useState(header?.supplierReference ?? "");
  const [supplyDate, setSupplyDate] = useState(header?.supplyDate ?? "");
  const [paidAmount, setPaidAmount] = useState(header?.paidAmount || "0.00");
  const [roundingAmount, setRoundingAmount] = useState(header?.roundingAmount || "0.00");
  const [precedingHeaderId, setPrecedingHeaderId] = useState(header?.precedingHeaderId ?? "");
  const [precedingReference, setPrecedingReference] = useState(header?.precedingReference ?? "");
  const [precedingDate, setPrecedingDate] = useState(header?.precedingDate ?? "");
  const [buyerReference, setBuyerReference] = useState(header?.buyerReference ?? "");
  const [contractReference, setContractReference] = useState(header?.contractReference ?? "");
  const [paymentTerms, setPaymentTerms] = useState(header?.paymentTerms ?? "");
  const [invoicePeriodStart, setInvoicePeriodStart] = useState(header?.invoicePeriodStart ?? "");
  const [invoicePeriodEnd, setInvoicePeriodEnd] = useState(header?.invoicePeriodEnd ?? "");
  const [paymentMeansCode, setPaymentMeansCode] = useState(header?.paymentMeansCode ?? "");
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
  const [headerTab, setHeaderTab] = useState<HeaderTab>("document");
  const [headerWidth, setHeaderWidth] = useState<number | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [voidOpen, setVoidOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const headerWidthRef = useRef<number | null>(null);
  const sideBySideRef = useRef(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(SPLIT_WIDTH_KEY);
    const value = stored == null ? Number.NaN : Number(stored);
    if (!Number.isFinite(value)) return;
    headerWidthRef.current = value;
    setHeaderWidth(value);
  }, []);

  useEffect(() => {
    const node = splitRef.current;
    if (!node) return;
    const watch = () => {
      const wide = node.clientWidth >= 860;
      if (wide === sideBySideRef.current) return;
      sideBySideRef.current = wide;
      setSideBySide(wide);
    };
    watch();
    const observer = new ResizeObserver(watch);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function paintWidth(width: number) {
    const node = splitRef.current;
    if (!node) return;
    node.style.gridTemplateColumns = `${width}px ${SPLIT_HANDLE}px minmax(0, 1fr)`;
  }

  function rememberWidth(next: number) {
    const node = splitRef.current;
    const width = node ? clampSplit(next, node.clientWidth) : next;
    headerWidthRef.current = width;
    paintWidth(width);
    setHeaderWidth(width);
    window.localStorage.setItem(SPLIT_WIDTH_KEY, String(width));
  }

  function dragSplit(event: React.PointerEvent<HTMLButtonElement>) {
    if (!sideBySideRef.current) return;
    const node = splitRef.current;
    if (!node) return;
    event.preventDefault();
    const bounds = node.getBoundingClientRect();
    const origin = headerWidthRef.current ?? (bounds.width - SPLIT_HANDLE) / 2;
    const startX = event.clientX;
    const target = event.currentTarget;
    let latest = origin;
    let frame = 0;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      latest = clampSplit(origin + ev.clientX - startX, bounds.width);
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paintWidth(latest);
      });
    };
    const stop = (ev: PointerEvent) => {
      if (frame) window.cancelAnimationFrame(frame);
      latest = clampSplit(origin + ev.clientX - startX, bounds.width);
      rememberWidth(latest);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function nudgeSplit(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const node = splitRef.current;
    if (!node || !sideBySide) return;
    event.preventDefault();
    const current = headerWidthRef.current ?? (node.clientWidth - SPLIT_HANDLE) / 2;
    const delta = event.key === "ArrowLeft" ? -24 : 24;
    rememberWidth(current + (event.shiftKey ? delta * 3 : delta));
  }

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
  const lineVat = choices.vatRates.filter((rate) => rate.vatType === (sales ? "Sales" : "Expense"));
  const glChoices = [...choices.glCodes].sort((left, right) => {
    if (!sales) return left.code.localeCompare(right.code);
    const rank = (code: InvoiceCode) => (code.accountType === "Income" ? 0 : 1);
    return rank(left) - rank(right) || left.code.localeCompare(right.code);
  });
  const parties = sales ? choices.customers : choices.suppliers;
  const totals = useMemo(() => {
    if (locked && header) {
      return {
        foreignNett: numberValue(header.foreignNettAmount),
        foreignVat: numberValue(header.foreignVatAmount),
        foreignTotal: numberValue(header.foreignTotalAmount),
        homeNett: numberValue(header.homeNettAmount),
        homeVat: numberValue(header.homeVatAmount),
        homeTotal: numberValue(header.homeTotalAmount),
        amountDue: roundCents(numberValue(header.foreignTotalAmount) - numberValue(paidAmount) + numberValue(header.roundingAmount)),
        breakdown: header.breakdown,
      };
    }
    const breakdown = breakdownFromLines(
      invoiceLines.map((line) => {
        const vat = lineVat.find((rate) => rate.id === line.vatRateId);
        return {
          nett: numberValue(line.nettAmount),
          rate: vat ? Number(vat.rate) : 0,
          category: vat?.vatCategory || "O",
          exemption: vat?.exemptionReason ?? "",
        };
      }),
    );
    const foreignNett = roundCents(invoiceLines.reduce((sum, line) => sum + numberValue(line.nettAmount), 0));
    const foreignVat = roundCents(breakdown.reduce((sum, row) => sum + row.vat, 0));
    const foreignTotal = roundCents(foreignNett + foreignVat);
    return {
      foreignNett,
      foreignVat,
      foreignTotal,
      homeNett: toHome(foreignNett, exchangeRate),
      homeVat: toHome(foreignVat, exchangeRate),
      homeTotal: toHome(foreignTotal, exchangeRate),
      amountDue: roundCents(foreignTotal - numberValue(paidAmount) + numberValue(roundingAmount)),
      breakdown,
    };
  }, [exchangeRate, lineVat, header, invoiceLines, locked, paidAmount, roundingAmount]);

  function chooseSupplier(id: string) {
    setSupplierId(id);
    setPrecedingHeaderId((current) => {
      const invoice = choices.creditInvoices.find((item) => item.id === current);
      const partyId = sales ? invoice?.customerId : invoice?.supplierId;
      if (invoice && partyId !== id) return "";
      return current;
    });
    const supplier = parties.find((item) => item.id === id);
    if (!supplier) {
      setSupplierName("");
      setContactDetails("");
      setCurrencyId("");
      setExchangeRate("");
      setTermsDays(null);
      return;
    }
    setSupplierName(supplier.name);
    setContactDetails(supplier.contactDetails);
    const days = supplier.paymentTermsDays === "" ? null : Number(supplier.paymentTermsDays);
    setTermsDays(Number.isFinite(days) ? days : null);
    if (sales && days != null && !dueDate) {
      setDueDate(addDays(transactionDate, days));
      if (!paymentTerms) setPaymentTerms(termsText(days));
    }
    if (sales && supplier.buyerReference && !buyerReference) setBuyerReference(supplier.buyerReference);
    const currency = choices.currencies.find((item) => item.id === supplier.currencyId);
    if (!currency) {
      setCurrencyId("");
      setExchangeRate("");
      return;
    }
    setCurrencyId(currency.id);
    setExchangeRate(formatExchangeRate(currency.rate));
  }

  function chooseCredit(id: string) {
    setPrecedingHeaderId(id);
    const invoice = choices.creditInvoices.find((item) => item.id === id);
    if (!invoice) return;
    setPrecedingReference(invoice.documentNumber || (invoice.reference == null ? "" : String(invoice.reference)));
    setPrecedingDate(invoice.transactionDate);
  }

  function saveLine() {
    if (!lineDraft) return;
    const description = lineDraft.description.trim();
    const vat = lineVat.find((rate) => rate.id === lineDraft.vatRateId);
    const amounts = lineAmounts(lineDraft.quantity, lineDraft.price, lineDraft.discountAmount || "0", vat?.rate ?? null);
    const lineNote = lineDraft.lineNote.trim();
    const sellerItemId = lineDraft.sellerItemId.trim();
    const unitCode = lineDraft.unitCode.trim().toUpperCase() || "C62";
    if (!description) {
      setLineMessage("Enter a description.");
      return;
    }
    if (lineNote.length > 400) {
      setLineMessage("A line note can be up to 400 characters.");
      return;
    }
    if (sellerItemId.length > 60) {
      setLineMessage("A seller item identifier can be up to 60 characters.");
      return;
    }
    if (!/^[A-Z0-9]{2,3}$/.test(unitCode)) {
      setLineMessage("Choose a unit.");
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
      unitCode,
      lineNote,
      sellerItemId,
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
    choices.types.length === 0 || parties.length === 0 || choices.currencies.length === 0 || lines === null;
  const creditNote = selectedType?.documentKind === "credit_note";
  const paymentMeans =
    !paymentMeansCode || choices.paymentMeans.some((means) => means.code === paymentMeansCode)
      ? choices.paymentMeans
      : [{ code: paymentMeansCode, name: paymentMeansCode, common: false }, ...choices.paymentMeans];
  const creditChoices = choices.creditInvoices.filter((invoice) => {
    const partyId = sales ? invoice.customerId : invoice.supplierId;
    return partyId === supplierId && invoice.id !== header?.id;
  });
  const showCreditNote = sales && selectedType?.documentKind === "invoice" && posted && header;
  const canVoidDocument = posted && canVoid && !sales;
  const splitStyle: CSSProperties = sideBySide
    ? {
        gridTemplateColumns:
          headerWidth == null ? "minmax(0, 1fr) 10px minmax(0, 1fr)" : `${headerWidth}px 10px minmax(0, 1fr)`,
      }
    : {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
      };
  const splitMax = splitRef.current
    ? Math.max(SPLIT_MIN, splitRef.current.clientWidth - SPLIT_MIN - SPLIT_HANDLE)
    : 1200;

  function openPanel(panel: "void" | "credit") {
    setVoidOpen(panel === "void" ? !voidOpen : false);
    setCreditOpen(panel === "credit" ? !creditOpen : false);
  }

  return (
    <>
    <FormModal
      title={locked ? `View ${title}` : header ? `Edit ${title}` : `Add ${title}`}
      onClose={onClose}
      fillPage
    >
      <div className={styles.modalForm}>
      <form id="purchase-document" className={styles.documentFields} action={action} autoComplete="off" noValidate>
        {header ? <input type="hidden" name="id" value={header.id} /> : null}
        {locked ? null : <input type="hidden" name="lines" value={JSON.stringify(invoiceLines)} />}
        {posted ? (
          <p className={styles.notice}>Posted. The document is read-only, except the paid amount.</p>
        ) : null}
        {voided ? (
          <p className={styles.alert} role="status">
            Void{header?.voidReason ? ` — ${header.voidReason}` : ""}. This document cannot be changed.
          </p>
        ) : null}
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
        {header ? (
          <div className={styles.readinessBar}>
            <ReadinessControl items={header.readiness} direction={direction} />
            {canDownload ? (
              <a className={styles.quiet} href={`/transactions/${header.transactionTypeCode}/${header.id}/en16931`}>
                Download EN 16931 JSON
              </a>
            ) : null}
          </div>
        ) : null}
        {choices.types.length === 0 ? (
          <p className={styles.panelMeta}>Add a {sales ? "Sales" : "Purchases"} transaction type before saving a document.</p>
        ) : null}
        {parties.length === 0 ? (
          <p className={styles.panelMeta}>Add a {sales ? "customer" : "supplier"} before saving a document.</p>
        ) : null}
        <div className={`${styles.invoiceSplit} ${sideBySide ? "" : styles.invoiceStacked}`} ref={splitRef} style={splitStyle}>
        <div className={styles.headerPane}>
        <div className={styles.headerTabs} role="tablist" aria-label="Header">
          {([
            ["document", "Document"],
            ["payment", "Payment"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={styles.headerTab}
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
        <label className={styles.field}>
          Transaction type
          {typeLocked ? <input type="hidden" name="transaction_type_id" value={typeId} /> : null}
          <select
            name={typeLocked ? undefined : "transaction_type_id"}
            required
            autoComplete="off"
            value={typeId}
            disabled={typeLocked || locked}
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
        {showFlex ? <FlexField index={0} label={flexLabels[0]} value={flex[0]} disabled={locked} onChange={setFlex} /> : null}
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
        {showFlex ? <FlexField index={1} label={flexLabels[1]} value={flex[1]} disabled={locked} onChange={setFlex} /> : null}
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
        {sales ? null : (
          <label className={styles.field}>
            Supplier invoice no.
            <QuietInput name="supplier_reference" maxLength={60} disabled={locked} value={supplierReference} onChange={(event) => setSupplierReference(event.target.value)} />
          </label>
        )}
        <label className={styles.field}>
          Supply date
          <QuietInput name="supply_date" type="date" disabled={locked} value={supplyDate} onChange={(event) => setSupplyDate(event.target.value)} />
        </label>
        {showFlex ? <FlexField index={2} label={flexLabels[2]} value={flex[2]} disabled={locked} onChange={setFlex} /> : null}
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
            disabled={locked}
            value={exchangeRate}
            onChange={(event) => setExchangeRate(event.target.value)}
            onBlur={(event) => {
              if (parseCurrencyRate(event.target.value)) setExchangeRate(formatExchangeRate(event.target.value));
            }}
            className={styles.mono}
          />
        </label>
        {showFlex ? <FlexField index={3} label={flexLabels[3]} value={flex[3]} disabled={locked} onChange={setFlex} /> : null}
        {showFlex ? <FlexField index={4} label={flexLabels[4]} value={flex[4]} disabled={locked} onChange={setFlex} /> : null}
        <label className={styles.field}>
          Order number
          <QuietInput name="order_number" maxLength={40} disabled={locked} value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} />
        </label>
        <label className={styles.field}>
          Buyer reference
          <QuietInput name="buyer_reference" maxLength={100} disabled={locked} value={buyerReference} onChange={(event) => setBuyerReference(event.target.value)} />
        </label>
        <label className={styles.field}>
          Contract reference
          <QuietInput name="contract_reference" maxLength={60} disabled={locked} value={contractReference} onChange={(event) => setContractReference(event.target.value)} />
        </label>
        <label className={styles.field}>
          Period start
          <QuietInput name="invoice_period_start" type="date" disabled={locked} value={invoicePeriodStart} onChange={(event) => setInvoicePeriodStart(event.target.value)} />
        </label>
        <label className={styles.field}>
          Period end
          <QuietInput name="invoice_period_end" type="date" disabled={locked} value={invoicePeriodEnd} onChange={(event) => setInvoicePeriodEnd(event.target.value)} />
          <span className={styles.panelMeta}>Enter both dates, or leave both blank.</span>
        </label>
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
        <label className={`${styles.field} ${styles.wide}`}>
          Notes
          <QuietTextarea name="notes" maxLength={4000} rows={2} disabled={locked} value={notes} onChange={(event) => setNotes(event.target.value)} />
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
          <QuietTextarea name="payment_terms" maxLength={400} rows={2} disabled={locked} value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} />
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
          Paid amount
          <QuietInput
            name="paid_amount"
            required
            inputMode="decimal"
            disabled={voided}
            value={paidAmount}
            onChange={(event) => setPaidAmount(event.target.value)}
            onBlur={(event) => {
              if (parseMoney(event.target.value)) setPaidAmount(formatMoney(event.target.value));
            }}
            className={styles.mono}
          />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Contact details
          <QuietTextarea name="contact_details" maxLength={500} rows={2} disabled={locked} value={contactDetails} onChange={(event) => setContactDetails(event.target.value)} />
        </label>
        </div>
        </div>
        <div className={styles.headerSummary}>
          <fieldset className={styles.amountBox}>
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
            <p className={styles.panelMeta}>Amount due {formatMoney(totals.amountDue)}</p>
            {totals.breakdown.length ? (
              <table className={styles.vatBreakdown}>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Rate</th>
                    <th>Taxable</th>
                    <th>VAT</th>
                    <th>Exemption</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.breakdown.map((row) => (
                    <tr key={`${row.category}-${row.rate}`}>
                      <td className={styles.mono}>{row.category}</td>
                      <td className={styles.mono}>{row.rate.toFixed(2)}%</td>
                      <td className={styles.mono}>{formatMoney(row.taxable)}</td>
                      <td className={styles.mono}>{formatMoney(row.vat)}</td>
                      <td>{row.exemption || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </fieldset>
        </div>
        </div>
        <button
          className={styles.splitHandle}
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize header and lines"
          aria-valuemin={SPLIT_MIN}
          aria-valuemax={splitMax}
          aria-valuenow={headerWidth ?? Math.round(splitMax / 2)}
          tabIndex={sideBySide ? 0 : -1}
          onPointerDown={dragSplit}
          onKeyDown={nudgeSplit}
        />
        <div className={styles.linesPane}>
          <div className={styles.gridToolbar}>
            <span className={styles.paneLabel}>
              Lines{lines === null ? "" : ` (${invoiceLines.length})`}
              {locked && invoiceLines.length > 0 ? <span className={styles.lineHint}>Select a line to see its details.</span> : null}
            </span>
            {locked ? null : (
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
            )}
          </div>
          {lines === null ? (
            <p className={styles.empty}>Loading lines…</p>
          ) : (
            <div className={styles.lineScroll}>
              <table className={styles.lineTable}>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Product</th>
                    <th>Description</th>
                    <th>Unit</th>
                    <th>GL</th>
                    <th>VAT</th>
                    <th className={styles.num}>Qty</th>
                    <th className={styles.num}>Nett</th>
                    <th className={styles.num}>VAT amount</th>
                    {locked ? null : <th className={styles.actions}>&nbsp;</th>}
                  </tr>
                </thead>
                <tbody>
                  {invoiceLines.length === 0 ? (
                    <tr>
                      <td colSpan={locked ? 9 : 10}>No lines yet.</td>
                    </tr>
                  ) : (
                    invoiceLines.map((line) => (
                      <tr
                        key={line.lineNumber}
                        className={locked ? styles.lineClick : undefined}
                        tabIndex={locked ? 0 : undefined}
                        role={locked ? "button" : undefined}
                        aria-label={locked ? `View line ${line.lineNumber}` : undefined}
                        onClick={
                          locked
                            ? () => {
                                setLineMessage(null);
                                setLineDraft(line);
                              }
                            : undefined
                        }
                        onKeyDown={
                          locked
                            ? (event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                setLineMessage(null);
                                setLineDraft(line);
                              }
                            : undefined
                        }
                      >
                        <td className={styles.mono}>{line.lineNumber}</td>
                        <td className={styles.mono}>{line.productCode}</td>
                        <td>{line.description}</td>
                        <td className={styles.mono}>{line.unitCode || "C62"}</td>
                        <td className={styles.mono}>{choices.glCodes.find((code) => code.id === line.glCodeId)?.code ?? ""}</td>
                        <td className={styles.mono}>{choices.vatRates.find((rate) => rate.id === line.vatRateId)?.code ?? ""}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.quantity}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.nettAmount}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{line.vatAmount}</td>
                        {locked ? null : (
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
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={7}>Total</th>
                    <td className={`${styles.mono} ${styles.num}`}>{formatMoney(totals.foreignNett)}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{formatMoney(totals.foreignVat)}</td>
                    {locked ? null : <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        </div>
      </form>
      {voidOpen && canVoidDocument && header ? (
        <form className={styles.sideSheet} action={voidPurchaseInvoice} autoComplete="off">
          <div className={styles.sideSheetHead}>
            <strong>Void document</strong>
            <button className={styles.quiet} type="button" onClick={() => setVoidOpen(false)}>Close</button>
          </div>
          <input type="hidden" name="id" value={header.id} />
          {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
          <label className={styles.field}>
            Void reason
            <QuietInput name="reason" required maxLength={500} placeholder="Why this document is being voided" />
          </label>
          <button className={styles.primary} type="submit">Void</button>
        </form>
      ) : null}
      {creditOpen && showCreditNote && header ? (
        <div className={styles.sideSheet} role="dialog" aria-label="Credit notes">
          <div className={styles.sideSheetHead}>
            <strong>Credit notes</strong>
            <button className={styles.quiet} type="button" onClick={() => setCreditOpen(false)}>Close</button>
          </div>
          <p>Remaining that can be credited: {header.remainingAmount}</p>
          {header.credits.length > 0 ? (
            <ul>
              {header.credits.map((credit) => (
                <li key={credit.id}>
                  <Link href={`/transactions/${credit.typeCode}?open=${credit.id}`}>
                    {credit.typeCode} {credit.documentNumber || credit.transactionDate}
                  </Link>
                  {" "}· {credit.status} · {credit.total}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.panelMeta}>No credit notes yet.</p>
          )}
          {choices.creditNoteTypes.length === 0 ? (
            <p className={styles.panelMeta}>
              This organisation has no sales credit note type. <Link href="/transaction-types">Add one</Link> before raising a credit note.
            </p>
          ) : (
            <form action={createCreditNote}>
              <input type="hidden" name="id" value={header.id} />
              {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
              {choices.creditNoteTypes.length > 1 ? (
                <label className={styles.field}>
                  Credit note type
                  <select name="credit_type_id" required defaultValue="">
                    <option value="">Choose a type</option>
                    {choices.creditNoteTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.code} — {type.description}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="credit_type_id" value={choices.creditNoteTypes[0]?.id ?? ""} />
              )}
              <button className={styles.primary} type="submit">Create credit note</button>
            </form>
          )}
        </div>
      ) : null}
      <div className={styles.modalActions}>
        <div className={styles.actionCluster}>
          {canVoidDocument ? (
            <button className={styles.quiet} type="button" aria-expanded={voidOpen} onClick={() => openPanel("void")}>
              Void
            </button>
          ) : null}
          {showCreditNote ? (
            <button className={styles.quiet} type="button" aria-expanded={creditOpen} onClick={() => openPanel("credit")}>
              Credit notes
            </button>
          ) : null}
        </div>
        <div className={styles.actionCluster}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            {locked && !posted ? "Close" : "Cancel"}
          </button>
          {voided ? null : (
            <button className={styles.primary} type="submit" form="purchase-document" disabled={pending || (!posted && (blocked || !supplierId))}>
              {pending ? "Saving…" : posted ? "Save paid amount" : "Save"}
            </button>
          )}
        </div>
      </div>
      </div>
    </FormModal>
    {lineDraft ? (
      <LineEditor
        draft={lineDraft}
        products={choices.products}
        units={choices.units}
        glCodes={glChoices}
        departments={choices.departments}
        costCentres={choices.costCentres}
        vatRates={lineVat}
        sales={sales}
        readOnly={locked}
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

function choicesWithCurrent(products: InvoiceProduct[], id: string, code: string, description: string) {
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

function withCurrent<T extends { id: string }>(rows: T[], id: string, extra: T) {
  if (!id || rows.some((row) => row.id === id)) return rows;
  return [extra, ...rows];
}

function LineEditor({
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
  draft: PurchaseInvoiceLine;
  products: InvoiceProduct[];
  units: PurchaseInvoiceChoices["units"];
  glCodes: InvoiceCode[];
  departments: InvoiceCode[];
  costCentres: InvoiceCode[];
  vatRates: InvoiceVat[];
  sales?: boolean;
  readOnly?: boolean;
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
        <QuietInput value={draft.description} maxLength={200} disabled={readOnly} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
      </label>
      <label className={styles.field}>
        Unit
        <UnitSelect units={unitChoices} value={draft.unitCode || "C62"} disabled={readOnly} onChange={(unitCode) => onChange({ ...draft, unitCode })} />
      </label>
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
            if (parseMoney(event.target.value || "0")) onChange({ ...draft, discountAmount: formatMoney(event.target.value || "0") });
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
