"use client";

import { useState, useSyncExternalStore } from "react";
import DataGrid, { type GridColumn } from "@/components/DataGrid";
import styles from "@/components/OpsPage.module.css";
import { useRegion } from "@/components/useRegion";
import PaymentForm from "@/components/payment/PaymentForm";
import { formatDate } from "@/lib/dates";
import { documentStatusLabel } from "@/lib/transaction-types";
import type { PaymentChoices, PaymentPrefill, PaymentRow } from "@/lib/payments";

const noSubscription = () => () => {};

/** False while the server renders and while the browser hydrates, true afterwards. */
function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

function plain(value: string) {
  return value.replace(/,/g, "");
}

export default function PaymentManager({
  title,
  summary,
  rows,
  choices,
  loadError,
  actionError,
  openId,
  openStamp,
  startNew = false,
  prefill = null,
}: {
  title: string;
  summary: string;
  rows: PaymentRow[];
  choices: PaymentChoices;
  loadError: string | null;
  actionError?: string;
  openId?: string;
  openStamp?: string;
  /** Open a new draft as soon as the page is in the browser, for a link raised from a document. */
  startNew?: boolean;
  prefill?: PaymentPrefill | null;
}) {
  const region = useRegion();
  const [draft, setDraft] = useState<PaymentRow | "new" | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [partyFilter, setPartyFilter] = useState("");
  const [onAccountOnly, setOnAccountOnly] = useState(false);
  // The prefill belongs to the link that opened the draft. A draft opened with the Add button has none.
  const [activePrefill, setActivePrefill] = useState<PaymentPrefill | null>(null);

  // A payment named in the address, or a new one asked for by a document, opens once the page is in the
  // browser, and again whenever the address, the stamp or the rows change.
  const hydrated = useHydrated();
  const [seen, setSeen] = useState<{ openId?: string; openStamp?: string; startNew: boolean; rows: PaymentRow[] } | null>(null);
  if (hydrated && (!seen || seen.openId !== openId || seen.openStamp !== openStamp || seen.startNew !== startNew || seen.rows !== rows)) {
    const first = !seen || seen.openId !== openId || seen.openStamp !== openStamp || seen.startNew !== startNew;
    setSeen({ openId, openStamp, startNew, rows });
    const row = openId ? rows.find((item) => item.id === openId) : undefined;
    if (row) {
      setActivePrefill(null);
      setDraft(row);
    } else if (startNew && first) {
      setActivePrefill(prefill);
      setDraft("new");
    }
  }

  const visibleRows = rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (partyFilter && row.partyId !== partyFilter) return false;
    if (onAccountOnly && !(row.status === "posted" && Number(row.unallocatedAmount) > 0)) return false;
    return true;
  });

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>{title}</h1>
        <p className={styles.lede}>{summary}</p>
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
        form={`transactions/${choices.type.code}`}
        onOpen={(row) => {
          setActivePrefill(null);
          setDraft(row);
        }}
        rows={visibleRows}
        searchPlaceholder={`Search ${title.toLowerCase()}`}
        searchText={(row) =>
          `${row.documentNumber} ${row.partyName} ${row.bankAccountLabel} ${row.bankReference} ${row.notes} ${documentStatusLabel(row.status)} ${row.voidReason}`
        }
        emptyLabel={`No ${title.toLowerCase()} yet for this organisation.`}
        minWidth="820px"
        toolbar={
          <>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status">
              <option value="">Any status</option>
              {(["draft", "posted", "void"] as const).map((status) => (
                <option key={status} value={status}>
                  {documentStatusLabel(status)}
                </option>
              ))}
            </select>
            <select value={partyFilter} onChange={(event) => setPartyFilter(event.target.value)} aria-label={choices.type.direction === "Sales" ? "Customer" : "Supplier"}>
              <option value="">{choices.type.direction === "Sales" ? "Any customer" : "Any supplier"}</option>
              {choices.parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.code}
                </option>
              ))}
            </select>
            <select value={onAccountOnly ? "on-account" : ""} onChange={(event) => setOnAccountOnly(event.target.value === "on-account")} aria-label="Money on account">
              <option value="">Any allocation</option>
              <option value="on-account">Has money on account</option>
            </select>
            <button
              className={styles.primary}
              type="button"
              onClick={() => {
                setActivePrefill(null);
                setDraft("new");
              }}
            >
              Add
            </button>
          </>
        }
        columns={
          [
            {
              key: "number",
              label: "Number",
              mono: true,
              sortValue: (row) => row.documentNumber,
              render: (row) => row.documentNumber || "Draft",
            },
            {
              key: "date",
              label: "Date",
              sortValue: (row) => row.paymentDate,
              render: (row) => formatDate(row.paymentDate, region),
            },
            {
              key: "party",
              label: choices.type.direction === "Sales" ? "Customer" : "Supplier",
              sortValue: (row) => row.partyName,
              render: (row) => row.partyName,
            },
            {
              key: "currency",
              label: "Currency",
              mono: true,
              sortValue: (row) => row.currencyCode,
              render: (row) => row.currencyCode,
            },
            {
              key: "amount",
              label: "Amount",
              mono: true,
              align: "right",
              sortValue: (row) => plain(row.amount),
              render: (row) => row.amount,
            },
            {
              key: "allocated",
              label: "Allocated",
              mono: true,
              align: "right",
              sortValue: (row) => plain(row.allocatedAmount),
              render: (row) => row.allocatedAmount,
            },
            {
              key: "unallocated",
              label: "Unallocated",
              mono: true,
              align: "right",
              sortValue: (row) => plain(row.unallocatedAmount),
              render: (row) => row.unallocatedAmount,
            },
            {
              key: "status",
              label: "Status",
              sortValue: (row) => row.status,
              render: (row) => documentStatusLabel(row.status),
            },
          ] satisfies GridColumn<PaymentRow>[]
        }
        actions={(row) => (
          <button
            className={styles.quiet}
            type="button"
            onClick={() => {
              setActivePrefill(null);
              setDraft(row);
            }}
          >
            {row.status === "draft" ? "Edit" : "View"}
          </button>
        )}
      />
      {draft ? (
        <PaymentForm
          key={draft === "new" ? "new" : draft.id}
          row={draft === "new" ? null : draft}
          prefill={draft === "new" ? activePrefill : null}
          choices={choices}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}
