"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ConfirmSubmitButton from "@/components/ConfirmDialog";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { useRegion } from "@/components/useRegion";
import { useRegisterPageLabel } from "@/components/FormChrome";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { APPROVAL_FILTERS, approvalBanner, approvalLabel, approvalMatches, needsApproval } from "@/lib/approvals";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/documents";
import { downloadXlsx } from "@/lib/export/download";
import type { PaymentActionState } from "@/lib/payment-actions";
import {
  approveRun,
  cancelPaymentRun,
  createPaymentRun,
  loadPaymentRunApproval,
  loadRunnableInvoices,
  postPaymentRun,
  rejectRun,
  removeRunPayment,
  requestRunApproval,
} from "@/lib/payment-run-actions";
import { runStatusLabel, summariseChoice, type PaymentRunRow, type RunApproval, type RunChoices, type RunnableInvoice } from "@/lib/payment-runs";

const noSubscription = () => () => {};

/** How long an action may run before the screen stops showing it as busy. */
const SLOW_ACTION_MS = 15_000;

/**
 * Runs an action and keeps a busy flag for it. The flag clears as soon as the action's own work has finished, and it never waits for
 * a page refresh, so a refresh that stalls cannot leave a button disabled. When the work has not finished after SLOW_ACTION_MS the flag
 * clears and a notice says to check where things stand. The work returns an error message, or null when it succeeded. A late result
 * replaces that notice.
 */
function useGuardedAction(setError: (message: string | null) => void) {
  const [busy, setBusy] = useState(false);
  const start = useCallback(
    (work: () => Promise<string | null>) => {
      setError(null);
      setBusy(true);
      const timer = setTimeout(() => {
        setBusy(false);
        setError("This is taking longer than expected. Reload the page to see where it stands before trying again.");
      }, SLOW_ACTION_MS);
      work()
        .then((message) => setError(message))
        .catch(() => setError("That did not complete. Reload the page to see where it stands before trying again."))
        .finally(() => {
          clearTimeout(timer);
          setBusy(false);
        });
    },
    [setError],
  );
  return [busy, start] as const;
}

function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

type Run = (action: (state: PaymentActionState, data: FormData) => Promise<PaymentActionState>, data: FormData, done?: (result: PaymentActionState) => void) => void;

/** The payment runs: a list, a form to make one from posted invoices, and the run itself with its approval and posting. */
export default function PaymentRunManager({
  rows,
  choices,
  loadError,
  organisationName,
  openId,
}: {
  rows: PaymentRunRow[];
  choices: RunChoices;
  loadError: string | null;
  organisationName: string;
  openId?: string;
}) {
  const region = useRegion();
  useRegisterPageLabel("Payment runs");
  const [creating, setCreating] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("");
  const [loaded, setLoaded] = useState<{ rows: PaymentRunRow[]; value: Record<string, RunApproval> } | null>(null);
  const approvals: Record<string, RunApproval> = loaded?.rows === rows ? loaded.value : {};
  const showApproval = Object.keys(approvals).length > 0;
  // Until approval has been read for these rows, a draft run shows no Post button, so nothing is offered that the database would refuse.
  const approvalsReady = loaded?.rows === rows || !rows.some((row) => row.status === "draft");

  useEffect(() => {
    const drafts = rows.filter((row) => row.status === "draft").map((row) => row.id);
    if (drafts.length === 0) return;
    let cancelled = false;
    void loadPaymentRunApproval(drafts).then((value) => {
      if (!cancelled) setLoaded({ rows, value });
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // After an action on the open run, read approval again. The page refresh the action asks for can arrive without the rows
  // changing, which left the dialog showing the run as still waiting for approval after it had been approved.
  // A reload that finishes after the rows have been replaced is dropped: the effect above reads approval for the new rows, and
  // storing an answer for the old ones would blank the dialog.
  const latestRows = useRef(rows);
  useEffect(() => {
    latestRows.current = rows;
  }, [rows]);
  const reloadApprovals = useCallback(() => {
    const drafts = rows.filter((row) => row.status === "draft").map((row) => row.id);
    if (drafts.length === 0) return;
    void loadPaymentRunApproval(drafts).then((value) => {
      if (latestRows.current === rows) setLoaded({ rows, value });
    });
  }, [rows]);

  // A run named in the address opens once the page is in the browser, and again when the rows change.
  const hydrated = useHydrated();
  const [seen, setSeen] = useState<{ openId?: string; rows: PaymentRunRow[] } | null>(null);
  if (hydrated && (!seen || seen.openId !== openId || seen.rows !== rows)) {
    const first = !seen || seen.openId !== openId;
    setSeen({ openId, rows });
    if (openId && first && rows.some((row) => row.id === openId)) setOpenRun(openId);
  }

  const visible = rows.filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (approvalFilter && showApproval && !approvalMatches(approvals[row.id], approvalFilter)) return false;
    return true;
  });
  const current = openRun ? (rows.find((row) => row.id === openRun) ?? null) : null;

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Payment runs</h1>
        <p className={styles.lede}>Payment runs for {organisationName}: several supplier invoices, approved and posted as one.</p>
      </div>
      {loadError ? (
        <p className={styles.alert} role="alert">
          {loadError}
        </p>
      ) : null}
      <DataGrid
        form="payment-runs"
        onOpen={(row) => setOpenRun(row.id)}
        rows={visible}
        searchPlaceholder="Search payment runs"
        searchText={(row) => `${row.documentNumber} ${row.bankAccountLabel} ${row.notes} ${runStatusLabel(row.status)} ${row.payments.map((payment) => payment.supplierName).join(" ")}`}
        emptyLabel="No payment runs yet for this organisation."
        toolbar={
          <>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Status">
              <option value="">Any status</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="cancelled">Cancelled</option>
            </select>
            {showApproval ? (
              <select value={approvalFilter} onChange={(event) => setApprovalFilter(event.target.value)} aria-label="Approval">
                <option value="">Any approval</option>
                {APPROVAL_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            ) : null}
            {choices.canCreate ? (
              <button className={styles.primary} type="button" onClick={() => setCreating(true)} disabled={choices.types.length === 0 || choices.bankAccounts.length === 0}>
                Add
              </button>
            ) : null}
          </>
        }
        columns={[
          { key: "number", label: "Number", mono: true, sortValue: (row) => row.documentNumber, render: (row) => row.documentNumber },
          { key: "date", label: "Date", sortValue: (row) => row.paymentDate, render: (row) => formatDate(row.paymentDate, region) },
          { key: "bank", label: "Bank account", sortValue: (row) => row.bankAccountLabel, render: (row) => row.bankAccountLabel },
          { key: "payments", label: "Payments", mono: true, align: "right" as const, sortValue: (row) => String(row.payments.length).padStart(6, "0"), render: (row) => String(row.payments.length) },
          { key: "total", label: "Total", mono: true, align: "right" as const, sortValue: (row) => row.total.padStart(16, "0"), render: (row) => `${row.currencyCode} ${formatMoney(row.total)}` },
          { key: "status", label: "Status", sortValue: (row) => row.status, render: (row) => runStatusLabel(row.status) },
          ...(showApproval ? [{ key: "approval", label: "Approval", sortValue: (row: PaymentRunRow) => approvalLabel(approvals[row.id]), render: (row: PaymentRunRow) => approvalLabel(approvals[row.id]) }] : []),
        ]}
        actions={(row) => (
          <button className={styles.quiet} type="button" onClick={() => setOpenRun(row.id)}>
            {row.status === "draft" ? "Open" : "View"}
          </button>
        )}
      />
      {creating ? <CreateRunDialog choices={choices} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenRun(id); }} /> : null}
      {current ? <RunDialog key={current.id} run={current} approval={approvals[current.id] ?? null} approvalReady={approvalsReady} onChanged={reloadApprovals} onClose={() => setOpenRun(null)} /> : null}
    </section>
  );
}

/** Chooses the type, bank account and date, then the invoices to pay. */
function CreateRunDialog({ choices, onClose, onCreated }: { choices: RunChoices; onClose: () => void; onCreated: (id: string) => void }) {
  const defaultBank = choices.bankAccounts.find((account) => account.isDefault) ?? choices.bankAccounts[0];
  const [typeId, setTypeId] = useState(choices.types[0]?.id ?? "");
  const [bankId, setBankId] = useState(defaultBank?.id ?? "");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [dueBy, setDueBy] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<{ bank: string; invoices: RunnableInvoice[]; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useGuardedAction(setError);
  const region = useRegion();

  useEffect(() => {
    if (!bankId) return;
    let live = true;
    void loadRunnableInvoices(bankId).then((result) => {
      if (live) setLoaded({ bank: bankId, invoices: result.invoices, error: result.error });
    });
    return () => {
      live = false;
    };
  }, [bankId]);
  const invoices = loaded?.bank === bankId ? loaded.invoices : [];
  const shown = invoices.filter((invoice) => !dueBy || (invoice.dueDate && invoice.dueDate <= dueBy));
  const summary = useMemo(() => summariseChoice(invoices, chosen), [invoices, chosen]);
  const bank = choices.bankAccounts.find((account) => account.id === bankId);

  function toggle(id: string) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function create() {
    const data = new FormData();
    data.set("transaction_type_id", typeId);
    data.set("bank_account_id", bankId);
    data.set("payment_date", date);
    data.set("notes", notes);
    data.set("invoice_ids", JSON.stringify([...chosen]));
    start(async () => {
      const result = await createPaymentRun({}, data);
      if (result.error) return result.error;
      if (result.id) onCreated(result.id);
      return null;
    });
  }

  return (
    <FormModal title="Add payment run" onClose={onClose} className={styles.lineDialog}>
      <div className={styles.modalForm}>
        {error || loaded?.error ? (
          <p className={styles.alert} role="alert">
            {error ?? loaded?.error}
          </p>
        ) : null}
        <div className={documentStyles.dialogCreate}>
          <label className={styles.field}>
            Payment type
            <select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
              {choices.types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.code} {type.description}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Bank account
            <select value={bankId} onChange={(event) => { setBankId(event.target.value); setChosen(new Set()); }}>
              {choices.bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name} ({account.currencyCode})
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Payment date
            <QuietInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className={styles.field}>
            Due on or before
            <QuietInput type="date" value={dueBy} onChange={(event) => setDueBy(event.target.value)} />
          </label>
        </div>
        <label className={styles.field}>
          Notes
          <QuietInput maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <p className={styles.panelMeta}>
          Posted purchase invoices in {bank?.currencyCode ?? "the bank account's currency"} with something still open. Each is paid in full.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th aria-label="Choose" />
              <th>Supplier</th>
              <th>Invoice</th>
              <th>Due</th>
              <th className={styles.numeric}>Open</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5}>{loaded?.bank === bankId ? "No invoice is waiting to be paid." : "Loading…"}</td>
              </tr>
            ) : (
              shown.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <input type="checkbox" checked={chosen.has(invoice.id)} onChange={() => toggle(invoice.id)} aria-label={`Pay ${invoice.number}`} />
                  </td>
                  <td>{invoice.supplierName}</td>
                  <td>
                    {invoice.typeCode} {invoice.number}
                  </td>
                  <td>{invoice.dueDate ? formatDate(invoice.dueDate, region) : ""}</td>
                  <td className={styles.numeric}>{formatMoney(invoice.open)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className={styles.panelMeta} role="status">
          {summary.invoices} {summary.invoices === 1 ? "invoice" : "invoices"} for {summary.suppliers} {summary.suppliers === 1 ? "supplier" : "suppliers"}, {bank?.currencyCode ?? ""} {formatMoney(summary.total)}.
        </p>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.primary} type="button" disabled={pending || chosen.size === 0 || !typeId || !bankId} onClick={create}>
            {pending ? "Making…" : "Make the run"}
          </button>
        </div>
      </div>
    </FormModal>
  );
}

/** One run: its payments, its approval, and posting it. */
function RunDialog({ run, approval, approvalReady, onChanged, onClose }: { run: PaymentRunRow; approval: RunApproval | null; approvalReady: boolean; onChanged: () => void; onClose: () => void }) {
  const region = useRegion();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [refuse, setRefuse] = useState(false);
  const [pending, start] = useGuardedAction(setError);
  const draft = run.status === "draft";
  const approvalNeeded = needsApproval(approval) && draft;

  const execute: Run = useCallback((action, data, done) => {
    start(async () => {
      const result = await action({}, data);
      if (result.error) return result.error;
      // Ask for the page again and read approval again, so the dialog never shows what the action has already changed.
      // The refresh is not waited for: the button is free again once the action is done.
      router.refresh();
      onChanged();
      done?.(result);
      return null;
    });
  }, [onChanged, router, start]);

  const post = (event: React.FormEvent<HTMLFormElement>, action: Parameters<Run>[0], closeAfter = false) => {
    event.preventDefault();
    execute(action, new FormData(event.currentTarget), closeAfter ? () => onClose() : undefined);
  };

  const banner = error
    ? { tone: "alert" as const, text: error }
    : draft
      ? (approvalBanner(approval) ?? null)
      : { tone: "notice" as const, text: run.status === "posted" ? "Posted. Every payment in the run is posted." : "Cancelled." };

  function exportToExcel() {
    downloadXlsx(`${run.documentNumber}.xlsx`, {
      sheet: run.documentNumber,
      columns: [
        { label: "Supplier", type: "text" },
        { label: "IBAN", type: "text" },
        { label: "BIC", type: "text" },
        { label: "Account name", type: "text" },
        { label: "Amount", type: "money" },
        { label: "Currency", type: "text" },
        { label: "Reference", type: "text" },
        { label: "Invoices", type: "text" },
      ],
      rows: run.payments.map((payment) => [
        payment.supplierName,
        payment.iban,
        payment.bic,
        payment.bankAccountName,
        Number(payment.amount),
        run.currencyCode,
        run.documentNumber,
        payment.invoices.map((invoice) => `${invoice.typeCode} ${invoice.number}`).join(", "),
      ]),
    });
  }

  return (
    <FormModal title={`Payment run ${run.documentNumber}`} onClose={onClose} className={styles.lineDialog}>
      <div className={styles.modalForm} id="payment-run">
        {banner ? (
          <p className={banner.tone === "alert" ? styles.alert : styles.notice} role={banner.tone === "alert" ? "alert" : "status"}>
            {banner.text}
          </p>
        ) : null}
        {approval?.bankSuppliers ? (
          <p className={styles.notice} role="status">
            Bank details changed recently for: {approval.bankSuppliers}.
          </p>
        ) : null}
        <p className={styles.panelMeta}>
          {formatDate(run.paymentDate, region)}, paid from {run.bankAccountLabel}, {run.currencyCode} {formatMoney(run.total)} in {run.payments.length}{" "}
          {run.payments.length === 1 ? "payment" : "payments"}.{run.notes ? ` ${run.notes}` : ""}
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>IBAN</th>
              <th>Invoices</th>
              <th className={styles.numeric}>Amount</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {run.payments.length === 0 ? (
              <tr>
                <td colSpan={5}>No payments in this run.</td>
              </tr>
            ) : (
              run.payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.supplierName}</td>
                  <td className={styles.mono}>{payment.iban || "None on record"}</td>
                  <td>{payment.invoices.map((invoice) => `${invoice.typeCode} ${invoice.number}`).join(", ")}</td>
                  <td className={styles.numeric}>{formatMoney(payment.amount)}</td>
                  <td>
                    {draft ? (
                      <form onSubmit={(event) => post(event, removeRunPayment)}>
                        <input type="hidden" name="payment_id" value={payment.id} />
                        <button className={styles.quiet} type="submit" disabled={pending}>
                          Take out
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className={styles.modalActions}>
          <div className={documentStyles.actionCluster}>
            {draft ? (
              <form onSubmit={(event) => post(event, cancelPaymentRun, true)}>
                <input type="hidden" name="id" value={run.id} />
                <ConfirmSubmitButton className={styles.quiet} title="Cancel this payment run?" message="Its draft payments are deleted and every invoice in it is free again.">
                  Cancel run
                </ConfirmSubmitButton>
              </form>
            ) : null}
            <button className={styles.quiet} type="button" onClick={exportToExcel}>
              Export to Excel
            </button>
          </div>
          <div className={documentStyles.actionCluster}>
            <button className={styles.quiet} type="button" onClick={onClose}>
              Close
            </button>
            {draft && approvalNeeded && approval ? (
              <>
                {(approval.state === "required" || approval.state === "rejected") && run.payments.length > 0 ? (
                  <form onSubmit={(event) => post(event, requestRunApproval)}>
                    <input type="hidden" name="id" value={run.id} />
                    <button className={styles.quiet} type="submit" disabled={pending}>
                      Request approval
                    </button>
                  </form>
                ) : null}
                {approval.state === "requested" && approval.canDecide ? (
                  <>
                    <button className={styles.quiet} type="button" onClick={() => setRefuse(true)}>
                      Refuse
                    </button>
                    <form onSubmit={(event) => post(event, approveRun)}>
                      <input type="hidden" name="id" value={run.id} />
                      <button className={styles.quiet} type="submit" disabled={pending}>
                        Approve
                      </button>
                    </form>
                  </>
                ) : null}
              </>
            ) : null}
            {draft && approvalReady && !approvalNeeded && run.payments.length > 0 ? (
              <form onSubmit={(event) => post(event, postPaymentRun)}>
                <input type="hidden" name="id" value={run.id} />
                <button className={styles.primary} type="submit" disabled={pending}>
                  {pending ? "Posting…" : "Post run"}
                </button>
              </form>
            ) : null}
          </div>
        </div>
        {refuse ? <RefuseRunDialog runId={run.id} onClose={() => setRefuse(false)} /> : null}
      </div>
    </FormModal>
  );
}

function RefuseRunDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useGuardedAction(setError);
  return (
    <FormModal title="Refuse approval" onClose={onClose} className={styles.lineDialog}>
      <form
        className={styles.modalForm}
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          start(async () => {
            const result = await rejectRun({}, data);
            if (result.error) return result.error;
            onClose();
            return null;
          });
        }}
      >
        <input type="hidden" name="id" value={runId} />
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <p className={styles.panelMeta}>The person who asked sees the reason and can change the run and ask again.</p>
        <label className={styles.field}>
          Reason
          <QuietInput name="reason" required maxLength={500} placeholder="Why this is refused" />
        </label>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className={styles.danger} type="submit" disabled={pending}>
            {pending ? "Refusing…" : "Refuse"}
          </button>
        </div>
      </form>
    </FormModal>
  );
}
