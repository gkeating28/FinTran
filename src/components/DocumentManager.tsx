"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import ConfirmSubmitButton from "@/components/ConfirmDialog";
import DataGrid, { type GridColumn } from "@/components/DataGrid";
import type { ExportField } from "@/components/GridExport";
import { deleteDocument, postDocument } from "@/lib/document-actions";
import { loadTransactionReadiness } from "@/lib/readiness-actions";
import type { DocumentChoices } from "@/lib/document-data";
import { documentStatusLabel, isOrderKind, statusesForKind } from "@/lib/transaction-types";
import { useRegion } from "@/components/useRegion";
import { formatDate } from "@/lib/dates";
import { settlementState } from "@/lib/payments";
import { ORDER_PROGRESS_LABEL } from "@/lib/order-progress";
import { formatInteger } from "@/lib/numbers";
import type { DocumentLine, DocumentRow, ReadinessItem } from "@/lib/documents";
import { useAskContext } from "@/components/askContext";
import styles from "@/components/OpsPage.module.css";
import { OrderStatusButton } from "@/components/document/OrderStatusButton";
import { ReadinessControl, readinessStatus } from "@/components/document/Readiness";
import DocumentForm from "@/components/document/DocumentForm";

const noSubscription = () => () => {};

/** False while the server renders and while the browser hydrates, true afterwards. */
function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

const INVOICE_EXPORT_FIELDS: ExportField<DocumentRow>[] = [
  { key: "dueDate", label: "Due date", value: (row) => row.dueDate || null, type: "date" },
  { key: "supplyDate", label: "Supply date", value: (row) => row.supplyDate || null, type: "date" },
  { key: "currencyCode", label: "Currency", value: (row) => row.currencyCode },
  { key: "exchangeRate", label: "Exchange rate", value: (row) => row.exchangeRate, type: "number" },
  { key: "foreignNett", label: "Nett", value: (row) => row.foreignNettAmount, type: "money" },
  { key: "foreignVat", label: "VAT", value: (row) => row.foreignVatAmount, type: "money" },
  { key: "foreignTotal", label: "Total", value: (row) => row.foreignTotalAmount, type: "money" },
  { key: "homeNett", label: "Nett (home)", value: (row) => row.homeNettAmount, type: "money" },
  { key: "homeVat", label: "VAT (home)", value: (row) => row.homeVatAmount, type: "money" },
  { key: "homeTotal", label: "Total (home)", value: (row) => row.homeTotalAmount, type: "money" },
  { key: "paid", label: "Paid", value: (row) => row.paidAmount, type: "money" },
  { key: "due", label: "Amount due", value: (row) => row.amountDue, type: "money" },
  { key: "orderNumber", label: "Order number", value: (row) => row.orderNumber },
  { key: "supplierReference", label: "Supplier reference", value: (row) => row.supplierReference },
  { key: "buyerReference", label: "Buyer reference", value: (row) => row.buyerReference },
  { key: "contractReference", label: "Contract reference", value: (row) => row.contractReference },
  { key: "paymentTerms", label: "Payment terms", value: (row) => row.paymentTerms },
  { key: "voidReason", label: "Void reason", value: (row) => row.voidReason },
  { key: "notes", label: "Notes", value: (row) => row.notes },
];

export default function DocumentManager({
  rows,
  choices,
  loadError,
  actionError,
  title = "Purchase Invoices",
  summary,
  organisationName,
  typeCode,
  direction = "Purchases",
  openId,
  openStamp,
  canVoid = false,
  canDownload = false,
}: {
  rows: DocumentRow[];
  choices: DocumentChoices;
  loadError: string | null;
  actionError?: string;
  title?: string;
  summary?: string;
  organisationName?: string;
  typeCode?: string;
  direction?: "Sales" | "Purchases";
  openId?: string;
  openStamp?: string;
  canVoid?: boolean;
  canDownload?: boolean;
}) {
  const pathname = usePathname();
  const region = useRegion();
  const sales = direction === "Sales";
  const [draft, setDraft] = useState<DocumentRow | "new" | null>(null);
  useAskContext("transaction", draft && draft !== "new" ? draft.id : undefined, typeCode);
  const [lines, setLines] = useState<DocumentLine[] | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [readinessFilter, setReadinessFilter] = useState("");
  const [settlementFilter, setSettlementFilter] = useState("");
  const [invoicingFilter, setInvoicingFilter] = useState("");
  // Readiness is read after the rows arrive. It belongs to one set of rows, so a save that brings
  // new rows shows it as pending until it has been read again.
  const [loadedReadiness, setLoadedReadiness] = useState<{ rows: DocumentRow[]; value: Record<string, ReadinessItem[]> } | null>(null);
  const readinessById = loadedReadiness?.rows === rows ? loadedReadiness.value : rows.length === 0 ? {} : null;

  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    loadTransactionReadiness(rows.map((row) => row.id)).then((result) => {
      if (!cancelled) setLoadedReadiness({ rows, value: result });
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Moving to another page closes any open document.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setDraft(null);
    setLines(null);
    setLineError(null);
  }

  // A document named in the address opens once the page is in the browser, and again whenever the
  // address, the stamp or the rows change.
  const hydrated = useHydrated();
  const [seenOpen, setSeenOpen] = useState<{ openId?: string; openStamp?: string; rows: DocumentRow[] } | null>(null);
  if (
    hydrated &&
    (!seenOpen || seenOpen.openId !== openId || seenOpen.openStamp !== openStamp || seenOpen.rows !== rows)
  ) {
    setSeenOpen({ openId, openStamp, rows });
    const row = openId ? rows.find((item) => item.id === openId) : undefined;
    if (row) {
      setLines(row.lines);
      setDraft(row);
    }
  }

  const parties = sales ? choices.customers : choices.suppliers;
  const kindByType = new Map(choices.types.map((type) => [type.id, type.documentKind]));
  const rowIsOrder = (row: DocumentRow) => isOrderKind(kindByType.get(row.transactionTypeId));
  // A page for one type offers that kind's statuses. A page of mixed types offers them all.
  const kindsShown = new Set(choices.types.map((type) => isOrderKind(type.documentKind)));
  const statusChoices =
    kindsShown.size === 1
      ? statusesForKind(choices.types[0]?.documentKind)
      : (["draft", "posted", "void", "open", "closed", "cancelled"] as const);
  // A page that only lists orders shows how far each is invoiced, in place of readiness and payment.
  const ordersOnly = choices.types.length > 0 && choices.types.every((type) => type.documentKind === "order");
  const creditNotesOnly = choices.types.length > 0 && choices.types.every((type) => type.documentKind === "credit_note");
  const listedRows = readinessById
    ? rows.map((row) => ({ ...row, readiness: readinessById[row.id] ?? row.readiness }))
    : rows;
  const visibleRows = listedRows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    const partyId = sales ? row.customerId : row.supplierId;
    if (partyFilter && partyId !== partyFilter) return false;
    if (fromDate && row.transactionDate < fromDate) return false;
    if (toDate && row.transactionDate > toDate) return false;
    if (settlementFilter && !ordersOnly && (row.status !== "posted" || settlementState(row.paidAmount, row.amountDue) !== settlementFilter)) return false;
    if (ordersOnly && invoicingFilter && row.invoicing !== invoicingFilter) return false;
    if (sales && readinessFilter && !ordersOnly) {
      const status = readinessStatus(row.readiness);
      if (status !== readinessFilter) return false;
    }
    return true;
  });

  function edit(row: DocumentRow) {
    setLineError(null);
    setLines(row.lines);
    setDraft(row);
  }

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{title}</h1>
        <p className={styles.lede}>
          {summary ?? `${title} for ${organisationName ?? "this organisation"}.`}{" "}
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
        form={typeCode ? `transactions/${typeCode}` : "transactions"}
        exportFields={INVOICE_EXPORT_FIELDS}
        onOpen={edit}
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
              {statusChoices.map((status) => (
                <option key={status} value={status}>
                  {documentStatusLabel(status)}
                </option>
              ))}
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
            {ordersOnly ? (
              <select value={invoicingFilter} onChange={(event) => setInvoicingFilter(event.target.value)} aria-label="Invoicing">
                <option value="">Any invoicing</option>
                <option value="none">{ORDER_PROGRESS_LABEL.none}</option>
                <option value="part">{ORDER_PROGRESS_LABEL.part}</option>
                <option value="full">{ORDER_PROGRESS_LABEL.full}</option>
              </select>
            ) : null}
            {!ordersOnly ? (
              <select value={settlementFilter} onChange={(event) => setSettlementFilter(event.target.value)} aria-label="Payment">
                <option value="">Any payment</option>
                <option value="unpaid">Unpaid</option>
                <option value="part">Part paid</option>
                <option value="paid">Paid</option>
              </select>
            ) : null}
            {sales && !ordersOnly ? (
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
        columns={([
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
            render: (row) => (
              <ReadinessControl items={row.readiness} direction={direction} pending={readinessById == null} />
            ),
          },
          {
            key: "date",
            label: "Date",
            sortValue: (row) => row.transactionDate,
            render: (row) => formatDate(row.transactionDate, region),
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
            sortValue: (row) => row.dueDate,
            render: (row) => formatDate(row.dueDate, region),
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
            label: creditNotesOnly ? "Applied" : "Paid",
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
          {
            key: "invoicing",
            label: "Invoicing",
            sortValue: (row) => row.invoicing,
            render: (row) => (row.invoicing ? ORDER_PROGRESS_LABEL[row.invoicing] : ""),
          },
          {
            key: "invoiced",
            label: "Invoiced",
            mono: true,
            align: "right",
            sortValue: (row) => row.invoicedNett.replace(/,/g, ""),
            render: (row) => row.invoicedNett,
          },
          {
            key: "toInvoice",
            label: "To invoice",
            mono: true,
            align: "right",
            sortValue: (row) => row.remainingNett.replace(/,/g, ""),
            render: (row) => row.remainingNett,
          },
        ] satisfies GridColumn<DocumentRow>[]).filter((column) =>
          ordersOnly
            ? !["readiness", "paid", "dueAmount"].includes(column.key)
            : !["invoicing", "invoiced", "toInvoice"].includes(column.key),
        )}
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
                {rowIsOrder(row) ? (
                  <OrderStatusButton id={row.id} action="open" label="Activate" typeCode={typeCode} className={styles.quiet} />
                ) : (
                  <form action={postDocument}>
                    <input type="hidden" name="id" value={row.id} />
                    {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
                    <button className={styles.quiet} type="submit">
                      Post
                    </button>
                  </form>
                )}
                <form action={deleteDocument}>
                  <input type="hidden" name="id" value={row.id} />
                  {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
                  <ConfirmSubmitButton
                    className={styles.quiet}
                    title={`Remove ${row.transactionTypeCode} ${row.documentNumber || "draft"}?`}
                    message="It will be removed from this organisation."
                  >
                    Remove
                  </ConfirmSubmitButton>
                </form>
              </>
            ) : row.status === "open" ? (
              <>
                <button className={styles.quiet} type="button" onClick={() => edit(row)}>
                  Edit
                </button>
                <OrderStatusButton id={row.id} action="close" label="Close" typeCode={typeCode} className={styles.quiet} />
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
        <DocumentForm
          key={draft === "new" ? "new" : draft.id}
          title={title}
          header={draft === "new" ? null : draft}
          readiness={draft === "new" ? [] : (readinessById?.[draft.id] ?? draft.readiness)}
          readinessPending={draft !== "new" && readinessById == null}
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

function statusLabel(status: DocumentRow["status"]) {
  return documentStatusLabel(status);
}
