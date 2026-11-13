# Payments release B: hand-over

Written at the end of the session that built phases 2 to 5 and part one of phase 6. Start the next session from this file. The spec is `specs/QULAPLUS_PAYMENTS_SPEC.md`, version 3. It does not yet record the decisions listed at the end of this note.

Branch: `claude/intelligent-cerf-j32nz3`. Everything below that is marked done is committed and pushed.

## State

| Part | State |
| --- | --- |
| Release A, bank accounts | Done, pushed and applied to the FinTran Supabase project (`hxueqzgdwlaschcvwdke`) |
| Phase 2, payment kinds and `payments` | Done. `supabase/tests/payments.sql` |
| Phase 3, allocations and settlement | Done. `supabase/tests/allocations.sql` and `concurrency/last_amount.sh` |
| Phase 4, save, post, void, delete | Done. `supabase/tests/payment_functions.sql` |
| Phase 5, typed paid amount removed and migrated | Done. `supabase/tests/migrate_paid_amounts.sql` runs the migration file itself |
| Phase 6, screens | Part one done: see below |
| Phases 7 and 8 | Not started. Release C |

**Do not deploy release B until phase 6 is finished.** Phase 5 removes the typed paid amount, so without the screens nobody can record a payment. None of the release B migrations has been applied to the hosted project yet. Apply them together, in filename order, after the screens work. After applying, rename each migration file to the version the project records (as was done for `20261113103237_bank_accounts.sql`) and fix the one path in `supabase/tests/migrate_paid_amounts.sql` that names `20261113130600_remove_typed_paid_amount.sql`.

## Migrations for release B, in order

`20261113130000_payment_kinds`, `20261113130100_payments_table`, `20261113130200_settlement_columns`, `20261113130300_allocations`, `20261113130400_allocation_documents`, `20261113130500_payment_functions`, `20261113130600_remove_typed_paid_amount`, `20261113130700_allocate_lines`.

## Phase 6 part one, done

- `src/lib/transaction-types.ts`: `PAYMENT_KINDS`, `TypeKind`, `isPaymentKind`, `parseTypeKind`. The transaction type admin offers Payment and Receipt. System types (`is_system`) are hidden from the admin list and the Transactions menu. A payment type is counted by its payments. The form designer menu leaves payment types out until phase 7.
- `src/lib/payments.ts` with tests: types, `targetKindFor`, `paymentNoun`, `distributeOldestFirst`, `allocationTotals`, `parseAllocationAmount`.
- `src/lib/payment-data.ts`: `listPayments(typeCode)`, `loadPaymentRows`, `listOpenItems`.
- `src/lib/payment-actions.ts`: `savePayment` (with `then_action=post`), `postPayment`, `voidPayment`, `deletePayment`, `applyAllocations` (payment or credit note, through `allocate_lines`), `allocateOldestFirst`, `removeAllocation`, `updatePaymentNotes`, `loadOpenItems`, `loadPayment`, `createStandardPaymentTypes`.
- `src/components/payment/PaymentForm.tsx` and `PaymentDialogs.tsx`: the entry screen (header left, open items and allocations right, totals, footer, void and remove dialogs).

None of the screen code has been opened in a browser. It compiles and passes lint. Expect fixes on first use.

## Phase 6 still to do

1. **List page. DONE (not opened in a browser).** `PaymentManager.tsx` and the branch in the type page are in. A document link opens a new draft with `?new=1&party=<id>&allocate=<documentId>:<amount>,...` (`parsePaymentPrefill`, tested).
   Original note: `src/app/(app)/transactions/[code]/page.tsx` must show a payment manager when the type's kind is `payment` or `receipt`. Build `PaymentManager.tsx` (a `DataGrid` of `PaymentRow`: number, date, party, amount, allocated, unallocated, status; filters for status and "has money on account"; Add button; row opens `PaymentForm`), modelled on `DocumentManager.tsx` and `BankAccountManager.tsx`. Read `?open=` and a prefill from the document links below.
2. **Transactions menu. DONE (not opened in a browser).** The offer sits on `/transactions`, for owners and admins only, and `?error=` shows there.
   Original note: When the organisation has no payment or receipt type, an owner or admin sees an offer to create the four standard types, calling `createStandardPaymentTypes`. Show `?error=` on that page.
3. **Document Payments tab** (6.2). A fourth header tab on posted invoices and credit notes: effective and removed allocations (source, date, amount, exchange difference, who and when), the open amount, and Record receipt or Record payment. Those open a new draft payment of the right type with the party, currency and full open amount allocated (`PaymentPrefill` is ready). A posted credit note with a balance shows Apply to an invoice (uses `applyAllocations` with `credit_note_id`) and Refund. Load the allocations in `document-data.ts` or by an action when the tab opens.
4. **Grids and parties** (6.3). Document grids: Paid and Amount due columns and an unpaid, part paid or paid filter (`DocumentManager.tsx` already has a Paid column). Party summary (`party-summary.ts`, `party-summary-actions.ts`): money on account and recent payments, with tests in `party-summary.test.ts`.
5. **End-to-end flows** in `e2e/` for the five acceptance flows in phase 6. They cannot be run without the local Supabase stack, so write them carefully and say they are unrun.
6. **Documentation.** `CORE.md`, `TECHNICAL.md` and the status document: payments, receipts, allocations, settlement, calculated paid amounts. Drop "Paid amount is a single figure typed on the document" from the gaps if it is there. Add `supabase/tests/*` and the new concurrency test to the testing section.
7. Regenerate or hand-check `database.types.ts` (`node scripts/check-db-types.mjs` passes now).

## Decisions made while building, which the spec should say

- `tenant_id` on `bank_accounts` cascades. On `payments` and `allocations` it restricts.
- `replace_pending_allocations` is in `public`, not `private`, because `save_payment` runs with the caller's rights and cannot reach the private schema. It checks membership and draft status itself.
- `allocate_lines(p_source, p_lines)` was added so several amounts are applied together or not at all.
- Settlement may update a document dated in a locked period. The lock date applies to the allocation date.
- The migration of typed paid amounts is one `DO` block, so it is one transaction however it is run, and it does nothing on a second run.
- A typed `amount_due` on a posted document is recomputed from the paid amount, so it does not stick. A typed `paid_amount` is refused.
- A planned allocation is refused at once if the invoice has nothing open, not only when posting.

## Working notes

- No Docker here. A scratch Postgres 16 was used with stand-ins for `auth`, `vault`, `cron` and `storage`. The helper scripts lived in the earlier session's scratch folder and are gone. To rebuild: create the stand-ins, apply `supabase/migrations/20261112101106_baseline.sql` without its `pg_cron` line, then every later migration in order, then `DATABASE_URL=... scripts/run-sql-tests.sh`. All 38 SQL tests passed that way.
- Migrations that replace large functions were generated by copying the function text from the baseline and patching it, so the rest of each function is unchanged.
- Keep sessions short: read only the files a step needs, and avoid printing whole functions.
