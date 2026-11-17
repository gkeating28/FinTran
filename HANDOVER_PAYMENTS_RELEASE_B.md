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
| Phase 7a, printed payments | Written (see below), unrun | 
| Phase 7b, payment kinds in the form designer | Written, unrun in CI (flow 19, `payment_forms.sql`) |
| Phase 8 | Not started. Release C |

**Release B migrations are applied to the hosted project** (`hxueqzgdwlaschcvwdke`), at the owner's request, so that the branch could be run against it. The files are renamed to the versions the project records, and the path in `supabase/tests/migrate_paid_amounts.sql` is fixed. The hosted project had no typed paid amounts (0 of 10 documents), so the data migration changed nothing. Phase 5 removed the typed paid amount, so recording a payment now depends on the phase 6 screens, which have not been opened in a browser.

## Migrations for release B, in order

`20261113123253_payment_kinds`, `20261113123735_payments_table`, `20261113124214_settlement_columns`, `20261113125229_allocations`, `20261113125349_allocation_documents`, `20261113125722_payment_functions`, `20261113130052_remove_typed_paid_amount`, `20261113130201_allocate_lines`.

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
3. **Document Payments tab** (6.2). **DONE (not opened in a browser).** `PaymentsTab.tsx`, `loadDocumentPayments` and `loadDocumentPaymentsTab`. Record receipt, payment or refund links use `recordPaymentHref`; Apply to an invoice and Remove (for applications of a credit note) are in the tab. Its dialogs are portalled to the body because the tab sits inside the document form. Removing a payment's own allocations stays on the payment screen.
   Original note: A fourth header tab on posted invoices and credit notes: effective and removed allocations (source, date, amount, exchange difference, who and when), the open amount, and Record receipt or Record payment. Those open a new draft payment of the right type with the party, currency and full open amount allocated (`PaymentPrefill` is ready). A posted credit note with a balance shows Apply to an invoice (uses `applyAllocations` with `credit_note_id`) and Refund. Load the allocations in `document-data.ts` or by an action when the tab opens.
4. **Grids and parties** (6.3). **DONE (not opened in a browser).** Unpaid, part paid and paid filter and an Applied label on credit note grids in `DocumentManager.tsx` (`settlementState`); money on account and recent payments in the party summary (tests in `party-summary.test.ts`).
   Original note: Document grids: Paid and Amount due columns and an unpaid, part paid or paid filter (`DocumentManager.tsx` already has a Paid column). Party summary (`party-summary.ts`, `party-summary-actions.ts`): money on account and recent payments, with tests in `party-summary.test.ts`.
5. **End-to-end flows. WRITTEN, UNRUN.** `e2e/payments.spec.ts`, flows 12 to 16 (and 17 for the double tap), one per acceptance case. Selectors come from the components, not from a run. The first CI run will show what needs fixing.
   Original note: in `e2e/` for the five acceptance flows in phase 6. They cannot be run without the local Supabase stack, so write them carefully and say they are unrun.
6. **Documentation. DONE.** `CORE.md` has a Payments and settlement section and updated header, transaction type and screen text. `TECHNICAL.md` has the actions, functions, permissions, tests and e2e flows. There is no separate status document in the repository. The gap line about a typed paid amount was not in `CORE.md` or `TECHNICAL.md`.
   Original note: `CORE.md`, `TECHNICAL.md` and the status document: payments, receipts, allocations, settlement, calculated paid amounts. Drop "Paid amount is a single figure typed on the document" from the gaps if it is there. Add `supabase/tests/*` and the new concurrency test to the testing section.
7. **DONE.** `database.types.ts` already has every table, column and payment function the code calls: `node scripts/check-db-types.mjs` and `tsc` pass. Original note: regenerate or hand-check `database.types.ts` (`node scripts/check-db-types.mjs` passes now).

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

## Transaction type codes (added later)

Every type code is three characters: direction (`S` or `P`) plus `RQ`, `OR`, `IN`, `CN`, `RC`, `PY` or `RF`. See CORE.md, Transaction type codes. The migration `20261113184039_three_character_type_codes` renamed the hosted types (QulaPlus Dublin: nine types, all renamed, guard back on, documents still attached). The standard payment types, the e2e seed and flows, and the unit test examples use the new codes. The SQL tests keep their own throwaway codes. The hidden system types made by `remove_typed_paid_amount` are renamed by `three_character_migrated_type_codes` to `SMR`, `PMP`, `SMF` and `PMF` (direction, M for migrated, then the kind's first letter). Old links with the old codes are redirected by `src/lib/legacy-type-codes.ts`.

## Phase 7a, printing (added later)

Fixed layouts for payments, receipts and refunds: remittance advice for money out, receipt for money in. `payment-print.ts` (builder and tests), `payment-print-data.ts` (loader), `PrintedPayment.tsx`, a branch in the print route, and Print on the payment list and the open payment. Flow 18 covers the acceptance cases and has not run. Not done, and left for 7b: payment and receipt kinds in the form designer, with the allocation table columns, and the database check on saved layouts that goes with it. `getFormType` now treats a payment type as not found, so `/forms/{payment code}` cannot open a designer for the wrong kind. 7b has to lift that when it adds the kinds.

## Phase 7b, form designer for payments (added later)

Payment and receipt types now have forms. The layout uses the same table and settings as a document's, but its own field lists: `src/lib/payment-form-layout.ts` (fields, labels, standard layout, `parsePaymentLayout`, `withRequiredPaymentFields`, tests). `private.validate_form_layout` has a payment branch (migration `20261117120000_payment_form_layouts`, test `supabase/tests/payment_forms.sql`). `buildPaymentPrint` takes the saved layout. `PaymentFormDesigner.tsx` is the screen, `getPaymentFormType` and `savedPaymentLayout` (in `payment-print-data.ts`) find the type and its form, and the Forms list and the payment list link to it. Decision: `getFormType` still treats a payment type as not found, as the document designer must not open for one, so the handover's earlier note to lift it was not followed. The migration is not yet applied to the hosted project. Flow 19 has not run.
