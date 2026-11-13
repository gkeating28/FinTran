"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import ConfirmSubmitButton from "@/components/ConfirmDialog";
import documentStyles from "@/components/Document.module.css";
import FormModal from "@/components/FormModal";
import styles from "@/components/OpsPage.module.css";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import { useRegion } from "@/components/useRegion";
import { formatDate } from "@/lib/dates";
import { formatExchangeRate, parseCurrencyRate } from "@/lib/currencies";
import { formatMoney } from "@/lib/documents";
import { numberValue, plainDecimal } from "@/lib/numbers";
import {
  allocateOldestFirst,
  applyAllocations,
  deletePayment,
  loadOpenItems,
  loadPayment,
  postPayment,
  savePayment,
  updatePaymentNotes,
  type PaymentActionState,
} from "@/lib/payment-actions";
import {
  allocationTotals,
  distributeOldestFirst,
  parseAllocationAmount,
  paymentNoun,
  type AllocationLine,
  type OpenItem,
  type PaymentChoices,
  type PaymentPrefill,
  type PaymentRow,
} from "@/lib/payments";
import { RemoveAllocationDialog, VoidPaymentDialog } from "./PaymentDialogs";
import paymentStyles from "./Payment.module.css";

/** The id of the form that holds the open payment. Buttons outside it submit it by this id. */
export const PAYMENT_FORM = "payment-document";

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** What the form holds, as one string, to tell whether anything changed since it opened. */
function signatureOf(values: string[], boxes: Record<string, string>) {
  return JSON.stringify([values, Object.entries(boxes).filter(([, value]) => value.trim()).sort(([left], [right]) => left.localeCompare(right))]);
}

function boxesFrom(row: PaymentRow | null, prefill: PaymentPrefill | null | undefined) {
  const boxes: Record<string, string> = {};
  for (const line of row?.status === "draft" ? row.allocations : []) {
    if (line.pending && !line.removedAt) boxes[line.documentId] = plainDecimal(line.amount);
  }
  for (const [id, amount] of Object.entries(prefill?.allocations ?? {})) boxes[id] = amount;
  return boxes;
}

/**
 * One payment or receipt. The header is on the left. On the right are the party's open documents with a box to
 * allocate against each, and the allocations already made. A draft is saved and posted here. A posted payment can
 * still be allocated while it has money on account, and each allocation can be removed with a reason.
 */
export default function PaymentForm({
  row,
  prefill,
  choices,
  onClose,
}: {
  row: PaymentRow | null;
  prefill?: PaymentPrefill | null;
  choices: PaymentChoices;
  onClose: () => void;
}) {
  const region = useRegion();
  const type = choices.type;
  const sales = type.direction === "Sales";
  const noun = paymentNoun(type.kind, type.direction);
  const [current, setCurrent] = useState<PaymentRow | null>(row);
  const [savedId, setSavedId] = useState<string | null>(null);
  const status = current?.status ?? "draft";
  const posted = status === "posted";
  const voided = status === "void";
  const locked = posted || voided;

  const [date, setDate] = useState(current?.paymentDate ?? today());
  const [partyId, setPartyId] = useState(current?.partyId ?? prefill?.partyId ?? "");
  const [bankAccountId, setBankAccountId] = useState(current?.bankAccountId ?? "");
  const [amount, setAmount] = useState(current ? plainDecimal(current.amount) : (prefill?.amount ?? ""));
  const [rate, setRate] = useState(current?.exchangeRate ?? "");
  const [meansCode, setMeansCode] = useState(current?.paymentMeansCode ?? "58");
  const [bankReference, setBankReference] = useState(current?.bankReference ?? "");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [boxes, setBoxes] = useState<Record<string, string>>(() => boxesFrom(row, prefill));
  const [loaded, setLoaded] = useState<{ key: string; items: OpenItem[]; error: string | null } | null>(null);
  const [reload, setReload] = useState(0);
  const [removing, setRemoving] = useState<AllocationLine | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // What the form held when it opened, to tell whether there is anything to save before posting.
  const [baseline] = useState(() => signatureOf([current?.paymentDate ?? today(), current?.partyId ?? prefill?.partyId ?? "", current?.bankAccountId ?? "", current ? plainDecimal(current.amount) : (prefill?.amount ?? ""), current?.paymentMeansCode ?? "58", current?.bankReference ?? "", current?.notes ?? ""], boxesFrom(row, prefill)));

  const party = choices.parties.find((item) => item.id === partyId);
  const currency = choices.currencies.find((item) => item.id === (party?.currencyId ?? current?.currencyId));
  const sameAsHome = Boolean(currency?.home);
  const rateValue = sameAsHome ? "1" : rate;
  const bankChoices = choices.bankAccounts.filter(
    (account) => account.currencyId === (party?.currencyId ?? current?.currencyId) && (account.active || account.id === bankAccountId),
  );

  // The open documents follow the party. Nothing is set until the answer comes back.
  const itemsKey = `${partyId}|${reload}`;
  useEffect(() => {
    if (!partyId || voided) return;
    let live = true;
    void loadOpenItems(type.id, partyId).then((result) => {
      if (live) setLoaded({ key: itemsKey, items: result.items, error: result.error });
    });
    return () => {
      live = false;
    };
  }, [partyId, type.id, voided, itemsKey]);
  const items = partyId && !voided && loaded?.key === itemsKey ? loaded.items : [];
  const itemsError = partyId && !voided && loaded?.key === itemsKey ? loaded.error : null;
  const loadingItems = Boolean(partyId) && !voided && loaded?.key !== itemsKey;

  /** Runs one of the payment actions with the data given. A refusal is shown. A success is handled by the caller. */
  const run = useCallback(
    (action: (state: PaymentActionState, data: FormData) => Promise<PaymentActionState>, data: FormData, done: (result: PaymentActionState) => void) => {
      setError(null);
      setNotice(null);
      startTransition(async () => {
        const result = await action({}, data);
        startTransition(() => {
          if (result.id) setSavedId(result.id);
          if (result.error) setError(result.error);
          else done(result);
        });
      });
    },
    [],
  );

  /** After a change to a posted payment: fetch it again, and the open documents with it. */
  const refreshPayment = useCallback(
    (message: string | null) => {
      const id = current?.id;
      if (!id) return;
      setBoxes({});
      setNotice(message);
      setReload((count) => count + 1);
      void loadPayment(id).then((fresh) => {
        if (fresh) setCurrent(fresh);
      });
    },
    [current?.id],
  );

  function chooseParty(id: string) {
    setPartyId(id);
    setBoxes({});
    const chosen = choices.parties.find((item) => item.id === id);
    const money = choices.currencies.find((item) => item.id === chosen?.currencyId);
    setRate(money?.home ? "1" : (money?.rate ?? ""));
    const usable = choices.bankAccounts.filter((account) => account.active && account.currencyId === chosen?.currencyId);
    const preferred = usable.find((account) => account.isDefault) ?? (usable.length === 1 ? usable[0] : undefined);
    setBankAccountId(preferred?.id ?? "");
  }

  const amountValue = numberValue(amount);
  const typedBoxes = items.map((item) => ({ item, value: parseAllocationAmount(boxes[item.id] ?? "") }));
  const boxesInvalid = typedBoxes.some((entry) => entry.value === undefined);
  const boxTotal = typedBoxes.reduce((sum, entry) => sum + (typeof entry.value === "number" ? entry.value : 0), 0);
  const overOpen = typedBoxes.some((entry) => typeof entry.value === "number" && entry.value > Number(entry.item.open));
  const totals = posted
    ? { allocated: numberValue(current?.allocatedAmount), unallocated: numberValue(current?.unallocatedAmount) - boxTotal, over: boxTotal > numberValue(current?.unallocatedAmount) }
    : allocationTotals(amountValue, [boxTotal]);
  const onAccount = posted ? numberValue(current?.unallocatedAmount) : totals.unallocated;

  const allocationsJson = JSON.stringify(
    typedBoxes.filter((entry) => typeof entry.value === "number").map((entry) => ({ targetHeaderId: entry.item.id, amount: String(entry.value) })),
  );

  const dirty = !current || signatureOf([date, partyId, bankAccountId, amount, meansCode, bankReference, notes], boxes) !== baseline;

  const banner = voided
    ? { tone: "notice" as const, text: `Void. ${current?.voidReason ?? ""}`.trim() }
    : [error, itemsError].filter(Boolean).map((text) => ({ tone: "alert" as const, text: text as string }))[0] ??
      (notice
        ? { tone: "notice" as const, text: notice }
        : posted
          ? { tone: "notice" as const, text: onAccount > 0 ? `Posted. ${formatMoney(onAccount)} is on account and can still be allocated.` : "Posted." }
          : !partyId
            ? { tone: "notice" as const, text: sales ? "Choose a customer to see what they owe." : "Choose a supplier to see what you owe." }
            : null);

  const title = voided || posted ? `View ${noun}` : current ? `Edit ${noun}` : `Add ${noun}`;
  const saveBlocked = pending || !partyId || !bankAccountId || !(amountValue > 0) || boxesInvalid || overOpen || totals.over;
  const partyLabel = sales ? "Customer" : "Supplier";

  const openItemsTable = (
    <div className={styles.linesPane}>
      <div className={styles.gridToolbar}>
        <span className={styles.paneLabel}>
          {type.kind === "receipt" && sales ? "Open invoices" : type.kind === "payment" && !sales ? "Open invoices" : "Open credit notes"} ({items.length})
          {loadingItems ? <span className={documentStyles.lineHint}>Loading…</span> : null}
        </span>
        {voided ? null : (
          <>
            {posted ? (
              <button
                className={styles.quiet}
                type="button"
                disabled={pending || onAccount <= 0 || items.length === 0}
                onClick={() => {
                  const data = new FormData();
                  data.set("payment_id", current?.id ?? "");
                  run(allocateOldestFirst, data, (result) => refreshPayment(result.message ?? null));
                }}
              >
                Allocate oldest first
              </button>
            ) : (
              <button
                className={styles.quiet}
                type="button"
                disabled={items.length === 0 || !(amountValue > 0)}
                onClick={() => setBoxes(distributeOldestFirst(items, amountValue))}
              >
                Allocate oldest first
              </button>
            )}
            <button className={styles.quiet} type="button" disabled={Object.keys(boxes).length === 0} onClick={() => setBoxes({})}>
              Clear
            </button>
            {posted ? (
              <button
                className={styles.primary}
                type="button"
                disabled={pending || boxTotal <= 0 || boxesInvalid || overOpen || totals.over}
                onClick={() => {
                  const data = new FormData();
                  data.set("payment_id", current?.id ?? "");
                  data.set("allocations", allocationsJson);
                  run(applyAllocations, data, (result) => refreshPayment(result.message ?? null));
                }}
              >
                {pending ? "Allocating…" : "Allocate"}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className={paymentStyles.itemsScroll}>
        <table className={styles.lineTable} data-lines="both">
          <thead>
            <tr>
              <th>Number</th>
              <th>Date</th>
              <th>Due</th>
              <th className={styles.num}>Total</th>
              <th className={styles.num}>Open</th>
              {voided ? null : <th className={styles.num}>Allocate</th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={voided ? 5 : 6}>{partyId ? "Nothing is open for this party." : "Choose a party first."}</td>
              </tr>
            ) : (
              items.map((item) => {
                const typed = parseAllocationAmount(boxes[item.id] ?? "");
                const tooMuch = typeof typed === "number" && typed > Number(item.open);
                return (
                  <tr key={item.id}>
                    <td className={styles.mono}>{item.documentNumber}</td>
                    <td>{formatDate(item.date, region)}</td>
                    <td>{formatDate(item.dueDate, region)}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{item.total}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{formatMoney(item.open)}</td>
                    {voided ? null : (
                      <td className={styles.num}>
                        <QuietInput
                          aria-label={`Allocate to ${item.documentNumber}`}
                          inputMode="decimal"
                          className={`${styles.mono} ${paymentStyles.allocateInput}`}
                          aria-invalid={typed === undefined || tooMuch}
                          value={boxes[item.id] ?? ""}
                          onChange={(event) => setBoxes((previous) => ({ ...previous, [item.id]: event.target.value }))}
                          onBlur={(event) => {
                            const parsed = parseAllocationAmount(event.target.value);
                            if (typeof parsed === "number") setBoxes((previous) => ({ ...previous, [item.id]: parsed.toFixed(2) }));
                          }}
                        />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {current && current.allocations.length > 0 ? (
        <>
          <p className={paymentStyles.subheading}>Allocations</p>
          <div className={paymentStyles.itemsScroll}>
            <table className={styles.lineTable} data-lines="both">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Date</th>
                  <th className={styles.num}>Amount</th>
                  <th className={styles.num}>Exchange difference</th>
                  <th>Status</th>
                  <th>By</th>
                  {posted ? <th className={styles.actions}>&nbsp;</th> : null}
                </tr>
              </thead>
              <tbody>
                {current.allocations.map((line) => {
                  const removed = Boolean(line.removedAt);
                  return (
                    <tr key={line.id} className={removed ? paymentStyles.removed : undefined}>
                      <td className={styles.mono}>{line.documentNumber}</td>
                      <td>{formatDate(line.date, region)}</td>
                      <td className={`${styles.mono} ${styles.num}`}>{line.amount}</td>
                      <td className={`${styles.mono} ${styles.num}`}>{line.pending ? "" : line.exchangeDifference}</td>
                      <td title={removed ? line.removalReason : undefined}>
                        {removed ? `Removed: ${line.removalReason}` : line.pending ? "Planned" : "Allocated"}
                      </td>
                      <td>{removed ? line.removedByName : line.byName}</td>
                      {posted ? (
                        <td className={styles.actions}>
                          {!removed && !line.pending ? (
                            <button className={styles.quiet} type="button" data-destructive="true" onClick={() => setRemoving(line)}>
                              Remove
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );

  return (
    <>
      <FormModal title={title} onClose={onClose} fillPage>
        <div className={styles.modalForm}>
          <form
            id={PAYMENT_FORM}
            className={styles.documentFields}
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const submitter = (event.nativeEvent as SubmitEvent).submitter;
              run(savePayment, new FormData(event.currentTarget, submitter), () => onClose());
            }}
            autoComplete="off"
            noValidate
          >
            <input type="hidden" name="transaction_type_id" value={type.id} />
            {current || savedId ? <input type="hidden" name="id" value={current?.id ?? savedId ?? ""} /> : null}
            <input type="hidden" name="allocations" value={allocationsJson} />
            <div className={styles.statusRow}>
              {banner ? (
                <p className={banner.tone === "alert" ? styles.alert : styles.notice} role={banner.tone === "alert" ? "alert" : "status"} title={banner.text}>
                  {banner.text}
                </p>
              ) : (
                <span />
              )}
            </div>
            <div className={paymentStyles.split}>
              <div className={styles.headerPane}>
                <div className={styles.headerBody}>
                  <div className={`${styles.invoiceForm} ${styles.headerFields}`}>
                    <label className={styles.field}>
                      Number
                      <input readOnly value={current?.documentNumber ?? ""} placeholder="Assigned on posting" className={styles.mono} />
                    </label>
                    <label className={styles.field}>
                      Date
                      <QuietInput name="payment_date" type="date" required disabled={locked} value={date} onChange={(event) => setDate(event.target.value)} />
                    </label>
                    <label className={`${styles.field} ${styles.wide}`}>
                      {partyLabel}
                      <select
                        name={sales ? "customer_id" : "supplier_id"}
                        required
                        disabled={locked}
                        value={partyId}
                        onChange={(event) => chooseParty(event.target.value)}
                      >
                        <option value="">{sales ? "Choose a customer" : "Choose a supplier"}</option>
                        {choices.parties.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.code} — {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`${styles.field} ${styles.wide}`}>
                      Bank account
                      <select name="bank_account_id" required={current?.source !== "migrated"} disabled={locked} value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}>
                        <option value="">{partyId ? "Choose a bank account" : "Choose a party first"}</option>
                        {bankChoices.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      Amount
                      <QuietInput
                        name="amount"
                        required
                        inputMode="decimal"
                        disabled={locked}
                        className={styles.mono}
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        onBlur={(event) => {
                          const typed = plainDecimal(event.target.value);
                          if (/^\d+(\.\d{1,2})?$/.test(typed)) setAmount(Number(typed).toFixed(2));
                        }}
                      />
                    </label>
                    <label className={styles.field}>
                      Currency
                      <input readOnly tabIndex={-1} value={currency?.code ?? ""} className={styles.mono} />
                    </label>
                    <label className={styles.field}>
                      Exchange rate
                      <QuietInput
                        name="exchange_rate"
                        inputMode="decimal"
                        readOnly={sameAsHome}
                        disabled={locked}
                        className={styles.mono}
                        value={rateValue}
                        onChange={(event) => setRate(event.target.value)}
                        onBlur={(event) => {
                          if (!sameAsHome && parseCurrencyRate(event.target.value)) setRate(formatExchangeRate(event.target.value));
                        }}
                      />
                    </label>
                    <label className={styles.field}>
                      Payment means
                      <select name="payment_means_code" disabled={locked} value={meansCode} onChange={(event) => setMeansCode(event.target.value)}>
                        {choices.paymentMeans.map((means) => (
                          <option key={means.code} value={means.code}>
                            {means.code} — {means.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`${styles.field} ${styles.wide}`}>
                      Bank reference
                      <QuietInput name="bank_reference" maxLength={140} disabled={voided} value={bankReference} onChange={(event) => setBankReference(event.target.value)} />
                    </label>
                    <label className={`${styles.field} ${styles.wide}`}>
                      Notes
                      <QuietTextarea name="notes" maxLength={4000} rows={3} spellCheck disabled={voided} value={notes} onChange={(event) => setNotes(event.target.value)} />
                    </label>
                  </div>
                  <div className={styles.headerSummary}>
                    <fieldset className={documentStyles.amountBox}>
                      <legend>Totals</legend>
                      <table>
                        <tbody>
                          <tr>
                            <th>Amount</th>
                            <td className={styles.mono}>{formatMoney(posted || voided ? numberValue(current?.amount) : amountValue)}</td>
                          </tr>
                          <tr>
                            <th>Allocated</th>
                            <td className={styles.mono}>{formatMoney(posted || voided ? numberValue(current?.allocatedAmount) : boxTotal)}</td>
                          </tr>
                          <tr>
                            <th>{onAccount > 0 ? "On account" : "Unallocated"}</th>
                            <td className={`${styles.mono} ${onAccount > 0 ? paymentStyles.onAccount : ""}`}>{formatMoney(voided ? 0 : onAccount)}</td>
                          </tr>
                        </tbody>
                      </table>
                      {totals.over && !voided ? <p className={styles.alert}>The allocations are more than the amount.</p> : null}
                    </fieldset>
                  </div>
                </div>
              </div>
              {openItemsTable}
            </div>
          </form>
          {removing ? (
            <RemoveAllocationDialog
              allocation={removing}
              onClose={() => setRemoving(null)}
              onRemoved={() => {
                setRemoving(null);
                refreshPayment("Removed.");
              }}
            />
          ) : null}
          {voidOpen && current && posted ? (
            <VoidPaymentDialog payment={current} noun={noun} onClose={() => setVoidOpen(false)} onVoided={onClose} />
          ) : null}
          <div className={styles.modalActions}>
            <div className={documentStyles.actionCluster}>
              {current && status === "draft" ? (
                <form
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    run(deletePayment, new FormData(event.currentTarget), () => onClose());
                  }}
                >
                  <input type="hidden" name="id" value={current.id} />
                  <ConfirmSubmitButton className={styles.quiet} title={`Delete this ${noun}?`} message="The draft and its planned allocations will be removed.">
                    Delete
                  </ConfirmSubmitButton>
                </form>
              ) : null}
              {posted && choices.canVoid ? (
                <button className={styles.quiet} type="button" onClick={() => setVoidOpen(true)}>
                  Void
                </button>
              ) : null}
            </div>
            <div className={documentStyles.actionCluster}>
              <button className={styles.quiet} type="button" onClick={onClose}>
                {locked ? "Close" : "Cancel"}
              </button>
              {posted ? (
                <button
                  className={styles.primary}
                  type="button"
                  disabled={pending || (notes === (current?.notes ?? "") && bankReference === (current?.bankReference ?? ""))}
                  onClick={() => {
                    const data = new FormData();
                    data.set("id", current?.id ?? "");
                    data.set("notes", notes);
                    data.set("bank_reference", bankReference);
                    run(updatePaymentNotes, data, (result) => refreshPayment(result.message ?? null));
                  }}
                >
                  {pending ? "Saving…" : "Save notes"}
                </button>
              ) : null}
              {locked ? null : (
                <>
                  {dirty ? (
                    <button className={styles.quiet} type="submit" form={PAYMENT_FORM} name="then_action" value="post" disabled={saveBlocked}>
                      Save and post
                    </button>
                  ) : current ? (
                    <form
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        run(postPayment, new FormData(event.currentTarget), () => onClose());
                      }}
                    >
                      <input type="hidden" name="id" value={current.id} />
                      <button className={styles.quiet} type="submit" disabled={pending}>
                        {pending ? "Posting…" : "Post"}
                      </button>
                    </form>
                  ) : null}
                  <button className={styles.primary} type="submit" form={PAYMENT_FORM} disabled={saveBlocked}>
                    {pending ? "Saving…" : "Save"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </FormModal>
    </>
  );
}
