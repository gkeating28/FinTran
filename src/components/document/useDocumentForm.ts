"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useGridLines } from "@/components/GridLines";
import { useGridPageSize } from "@/components/useGridPageSize";
import { saveDocument } from "@/lib/document-actions";
import type { DocumentChoices } from "@/lib/document-data";
import { isOrderKind } from "@/lib/transaction-types";
import { useRegion } from "@/components/useRegion";
import { gridPageSlice, pageIndexForSize, type GridPageSize } from "@/lib/grid-page";
import { numberValue } from "@/lib/numbers";
import { parseAmount } from "@/lib/products";
import { formatExchangeRate } from "@/lib/currencies";
import { breakdownFromLines, formatMoney, lineAmounts, roundCents, toHome, type DocumentLine, type DocumentRow, type InvoiceCode, type OrderSource, type ReadinessItem } from "@/lib/documents";
import type { ActionState } from "@/lib/types";
import { addDays, DOCUMENT_FORM, termsText, today, type HeaderTab } from "./shared";
import { useSplitLayout } from "./useSplitLayout";

export type DocumentFormProps = {
  title: string;
  header: DocumentRow | null;
  /** Read by the list after the rows arrive, so it is passed in and not taken from the header. */
  readiness: ReadinessItem[];
  readinessPending: boolean;
  lines: DocumentLine[] | null;
  lineError: string | null;
  choices: DocumentChoices;
  typeCode?: string;
  direction: "Sales" | "Purchases";
  canVoid: boolean;
  canDownload: boolean;
  onClose: () => void;
};

export type DocumentFormState = ReturnType<typeof useDocumentForm>;

/** Everything the open document needs: its fields, lines, totals, which buttons show, and the handlers. */
export function useDocumentForm({ title, header, readiness, readinessPending, lines, lineError, choices, typeCode, direction, canVoid, canDownload, onClose }: DocumentFormProps) {
  const sales = direction === "Sales";
  const region = useRegion();
  const posted = header?.status === "posted";
  const voided = header?.status === "void";
  const opened = header?.status === "open";
  const closed = header?.status === "closed";
  const cancelled = header?.status === "cancelled";
  const locked = posted || voided || closed || cancelled;
  const [state, action, pending] = useActionState(saveDocument, {} as ActionState);
  // True once a field on the form has been changed. Lines are compared with the saved ones further down.
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [typeId] = useState(header?.transactionTypeId ?? choices.types[0]?.id ?? "");
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
  const [salesOrderReference, setSalesOrderReference] = useState(header?.salesOrderReference ?? "");
  const [supplierReference, setSupplierReference] = useState(header?.supplierReference ?? "");
  const [supplyDate, setSupplyDate] = useState(header?.supplyDate ?? "");
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
  const [invoiceLines, setInvoiceLines] = useState<DocumentLine[]>(lines ?? []);
  const [linePageSize, setLinePageSize] = useGridPageSize(`transactions/${typeCode ?? "document"}/lines`, "all");
  const lineGridLines = useGridLines(`transactions/${typeCode ?? "document"}/lines`);
  const [linePageIndex, setLinePageIndex] = useState(0);
  const [lineDraft, setLineDraft] = useState<DocumentLine | null>(null);
  const [lineMessage, setLineMessage] = useState<string | null>(null);
  const [headerTab, setHeaderTab] = useState<HeaderTab>("document");
  const [voidOpen, setVoidOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  // Lines loaded after the form opened replace the ones shown.
  const [seenLines, setSeenLines] = useState<DocumentLine[] | null | undefined>(undefined);
  if (lines !== seenLines) {
    setSeenLines(lines);
    if (lines) setInvoiceLines(lines);
  }

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  const selectedType = choices.types.find((type) => type.id === typeId);
  const selectedCurrency = choices.currencies.find((currency) => currency.id === currencyId);
  const supplierCurrency = selectedCurrency?.code ?? "";
  const homeCurrency = choices.homeCurrencyCode;
  const sameAsHome = Boolean(supplierCurrency && homeCurrency && supplierCurrency.toUpperCase() === homeCurrency.toUpperCase());
  const rateValue = sameAsHome ? (formatExchangeRate(selectedCurrency?.rate ?? "1") || "1.0000") : exchangeRate;
  const flexLabels = selectedType?.flexLabels ?? ["", "", "", "", ""];
  const grnIndex = flexLabels.findIndex((label) => label.trim().toUpperCase() === "GRN");
  const otherRefIndex = flexLabels.findIndex((label) => label.trim().toLowerCase() === "other reference");
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
        amountDue: numberValue(header.amountDue),
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
      homeNett: toHome(foreignNett, rateValue),
      homeVat: toHome(foreignVat, rateValue),
      homeTotal: toHome(foreignTotal, rateValue),
      amountDue: roundCents(foreignTotal + numberValue(roundingAmount)),
      breakdown,
    };
  }, [rateValue, lineVat, header, invoiceLines, locked, roundingAmount]);

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
    if (parseAmount(lineDraft.discountAmount || "0") === null) {
      setLineMessage("Amounts can have at most 2 decimal places.");
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
    if (!lineDraft.lineNumber && linePageSize !== "all") {
      setLinePageIndex(Math.max(0, Math.ceil((invoiceLines.length + 1) / linePageSize) - 1));
    }
    setLineDraft(null);
    setLineMessage(null);
  }

  const blocked =
    choices.types.length === 0 || parties.length === 0 || choices.currencies.length === 0 || lines === null;
  const creditNote = selectedType?.documentKind === "credit_note";
  // An order or a requisition is opened and closed. It has no readiness, e-invoice or posting.
  const orderDocument = isOrderKind(selectedType?.documentKind);
  // An order becomes invoices and a requisition becomes purchase orders.
  const requisition = selectedType?.documentKind === "requisition";
  // Unsaved changes: a new document, a changed field, or lines that differ from the saved ones. A button that changes
  // the status then saves first and acts second, in one step, and its label says so.
  const linesDirty = useMemo(() => lines !== null && JSON.stringify(invoiceLines) !== JSON.stringify(lines), [invoiceLines, lines]);
  // Some fields are set by code and not typed, such as a due date worked out from the terms, so they raise no input
  // event. After each render the form's values are compared with the ones it had when it first settled.
  const savedSignature = useRef<string | null>(null);
  // This runs after every render on purpose, and it only ever sets the flag to true, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const form = document.getElementById(DOCUMENT_FORM);
    if (!(form instanceof HTMLFormElement) || lines === null) return;
    const signature = JSON.stringify([...new FormData(form).entries()].map(([name, value]) => [name, typeof value === "string" ? value : ""]));
    if (savedSignature.current === null) savedSignature.current = signature;
    else if (signature !== savedSignature.current) setFieldsDirty(true);
  });
  const dirty = !header || fieldsDirty || linesDirty;
  const cannotSave = pending || blocked || !supplierId;
  const followOnNoun = requisition ? "purchase order" : "invoice";
  const followOnTypes = choices.followOnTypes.filter((type) => type.documentKind === (requisition ? "order" : "invoice"));
  // Only an order limits what can be taken from it, so only an order shows what is left.
  const showDrawn = selectedType?.documentKind === "order" && Boolean(header) && header?.status !== "draft";
  // A credit note made from an invoice that came from an order can give quantity back to that order, line by line.
  const showReturns = creditNote && invoiceLines.some((line) => line.canReturnToOrder);
  // An invoice can bring lines in from the active orders of the supplier or customer chosen on it.
  const canBringIn = selectedType?.documentKind === "invoice" && !locked;
  const partyOrders = choices.orderSources.filter((order) => order.partyId === supplierId);

  /** The numbers of the orders the lines came from, each once, in line order. */
  function orderRefs(lines: DocumentLine[]) {
    return [...new Set(lines.map((line) => line.sourceNumber ?? "").filter(Boolean))].join(", ");
  }

  /**
   * Replaces the lines of an invoice and keeps its order reference in step with the orders they came from.
   * On a purchase that is the order number. On a sale it is the sales order, because the order number there
   * is the customer's. A reference the person typed themselves is left alone.
   */
  function replaceLines(next: DocumentLine[]) {
    if (selectedType?.documentKind === "invoice") {
      const before = orderRefs(invoiceLines);
      const after = orderRefs(next).slice(0, 200);
      const current = sales ? salesOrderReference.trim() : orderNumber.trim();
      if (before !== after && (!current || current === before)) {
        if (sales) setSalesOrderReference(after);
        else setOrderNumber(after);
      }
    }
    setInvoiceLines(next);
  }

  function bringIn(chosen: { order: OrderSource; lineIds: Set<string> }[]) {
    const present = new Set(invoiceLines.map((line) => line.sourceLineId).filter(Boolean));
    const added = chosen.flatMap(({ order, lineIds }) =>
      order.lines.flatMap((line) => {
        if (!line.id || present.has(line.id) || !lineIds.has(line.id)) return [];
        const whole = numberValue(line.quantity);
        const share = whole > 0 ? numberValue(line.remainingQuantity) / whole : 1;
        const discount = formatMoney(Math.round(numberValue(line.discountAmount) * share * 100) / 100);
        const vat = lineVat.find((rate) => rate.id === line.vatRateId);
        const amounts = lineAmounts(line.remainingQuantity, line.price, discount || "0", vat?.rate ?? null);
        const { remainingQuantity, ...rest } = line;
        return [
          {
            ...rest,
            drawnQuantity: "",
            id: "",
            sourceLineId: line.id,
            sourceNumber: order.documentNumber,
            sourceDocument: `${order.typeCode} ${order.documentNumber}`.trim(),
            quantity: remainingQuantity,
            discountAmount: discount,
            nettAmount: amounts && !("error" in amounts) ? formatMoney(amounts.nett) : line.nettAmount,
            vatAmount: amounts && !("error" in amounts) ? formatMoney(amounts.vat) : line.vatAmount,
          },
        ];
      }),
    );
    replaceLines([...invoiceLines, ...added].map((line, index) => ({ ...line, lineNumber: index + 1 })));
    // On a sale the order number is the customer's, taken from the first sales order that has one when it is still empty.
    const customerOrder = chosen.find(({ order, lineIds }) => order.orderNumber && order.lines.some((line) => line.id && lineIds.has(line.id)))?.order.orderNumber;
    if (sales && !orderNumber.trim() && customerOrder) setOrderNumber(customerOrder);
    setOrdersOpen(false);
  }

  // Lines that came from another document say which one.
  const showSource = invoiceLines.some((line) => line.sourceDocument);
  const showLinks = Boolean(header) && (orderDocument || (header?.sources.length ?? 0) > 0);
  const paymentMeans =
    !paymentMeansCode || choices.paymentMeans.some((means) => means.code === paymentMeansCode)
      ? choices.paymentMeans
      : [{ code: paymentMeansCode, name: paymentMeansCode, common: false }, ...choices.paymentMeans];
  const creditChoices = choices.creditInvoices.filter((invoice) => {
    const partyId = sales ? invoice.customerId : invoice.supplierId;
    return partyId === supplierId && invoice.id !== header?.id;
  });
  // A draft invoice or credit note can be posted from the open document, as it can from the list.
  const canPostHere = !orderDocument && !locked && (!header || header.status === "draft");
  const showCreditNote = sales && selectedType?.documentKind === "invoice" && posted && header;
  const canVoidDocument = posted && canVoid && !sales;
  const linePage = gridPageSlice(invoiceLines, linePageIndex, linePageSize);

  function changeLinePageSize(next: GridPageSize) {
    setLinePageIndex(pageIndexForSize(linePage.page, linePageSize, invoiceLines.length, next));
    setLinePageSize(next);
  }

  function openPanel(panel: "void" | "credit" | "links" | "orders") {
    setOrdersOpen(panel === "orders" ? !ordersOpen : false);
    setVoidOpen(panel === "void" ? !voidOpen : false);
    setCreditOpen(panel === "credit" ? !creditOpen : false);
    setLinksOpen(panel === "links" ? !linksOpen : false);
  }

  const banner = state.error
    ? { tone: "alert" as const, text: state.error }
    : lineError
      ? { tone: "alert" as const, text: lineError }
      : voided
        ? { tone: "alert" as const, text: `Void${header?.voidReason ? ` — ${header.voidReason}` : ""}. This document cannot be changed.` }
        : posted
          ? { tone: "notice" as const, text: "Posted. The document is read-only, except the paid amount." }
          : cancelled
            ? { tone: "alert" as const, text: "Cancelled. This order cannot be changed." }
            : closed
              ? { tone: "notice" as const, text: "Closed. Reopen the order to change it." }
              : opened
                ? { tone: "notice" as const, text: "Active. It can still be changed. An order closes by itself when posted invoices cover every line." }
          : choices.types.length === 0
            ? { tone: "alert" as const, text: `Add a ${sales ? "Sales" : "Purchases"} transaction type before saving a document.` }
            : parties.length === 0
              ? { tone: "alert" as const, text: `Add a ${sales ? "customer" : "supplier"} before saving a document.` }
              : null;
  const split = useSplitLayout();

  return {
    title,
    header,
    readiness,
    readinessPending,
    lines,
    choices,
    typeCode,
    direction,
    canDownload,
    onClose,
    setFieldsDirty,
    typeId,
    transactionDate,
    setTransactionDate,
    dueDate,
    setDueDate,
    supplierId,
    termsDays,
    supplierName,
    setSupplierName,
    contactDetails,
    setContactDetails,
    notes,
    setNotes,
    currencyId,
    setExchangeRate,
    orderNumber,
    setOrderNumber,
    salesOrderReference,
    setSalesOrderReference,
    supplierReference,
    setSupplierReference,
    supplyDate,
    setSupplyDate,
    roundingAmount,
    setRoundingAmount,
    precedingHeaderId,
    precedingReference,
    setPrecedingReference,
    precedingDate,
    setPrecedingDate,
    buyerReference,
    setBuyerReference,
    contractReference,
    setContractReference,
    paymentTerms,
    setPaymentTerms,
    invoicePeriodStart,
    setInvoicePeriodStart,
    invoicePeriodEnd,
    setInvoicePeriodEnd,
    paymentMeansCode,
    setPaymentMeansCode,
    flex,
    setFlex,
    invoiceLines,
    linePageSize,
    setLinePageIndex,
    lineDraft,
    setLineDraft,
    lineMessage,
    setLineMessage,
    headerTab,
    setHeaderTab,
    voidOpen,
    setVoidOpen,
    creditOpen,
    setCreditOpen,
    linksOpen,
    setLinksOpen,
    ordersOpen,
    setOrdersOpen,
    sales,
    region,
    posted,
    voided,
    opened,
    closed,
    cancelled,
    locked,
    action,
    pending,
    lineGridLines,
    selectedType,
    supplierCurrency,
    homeCurrency,
    sameAsHome,
    rateValue,
    flexLabels,
    grnIndex,
    otherRefIndex,
    showFlex,
    lineVat,
    glChoices,
    parties,
    totals,
    creditNote,
    orderDocument,
    requisition,
    dirty,
    cannotSave,
    followOnNoun,
    followOnTypes,
    showDrawn,
    showReturns,
    canBringIn,
    partyOrders,
    showSource,
    showLinks,
    paymentMeans,
    creditChoices,
    canPostHere,
    showCreditNote,
    canVoidDocument,
    linePage,
    banner,
    chooseSupplier,
    chooseCredit,
    saveLine,
    replaceLines,
    bringIn,
    changeLinePageSize,
    openPanel,
    ...split,
  };
}
