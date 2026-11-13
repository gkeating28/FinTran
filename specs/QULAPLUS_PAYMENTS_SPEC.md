# Qula Plus payments and receipts spec

Version 3, 13 November 2026. Revised after the Claude Code reviews of versions 1 and 2.

Goal: record money paid and received as proper records, allocate it to invoices and credit notes, and make "paid" and "amount due" trustworthy. This replaces the typed paid amount.

This is the first of three parts. Bank feeds (open banking) and accounting system integration follow in later specs and build on the bank accounts, payments and allocations defined here. Qula Plus records payments. It does not move money.

Read `TECHNICAL.md`, `CORE.md` and `QULAPLUS_HARDENING_SPEC.md` first (the hardening spec is not in the repository at the time of writing: add it, or point this line at its real location). This spec assumes the hardening spec is complete, including the end-to-end suite.

## Rules for the agent

The rules from the earlier specs still apply:

- new migrations only, never edit an applied migration
- rules enforced in Postgres, not only in the app
- no service-role key
- security definer functions with `search_path = ''`
- British spelling
- SQL tests for every acceptance criterion
- regenerate types
- update the documentation after each phase
- add end-to-end flows for new screens

## Releases

The phases are grouped into three releases. A release is deployed as a whole. Phases inside a release may take several sessions, but nothing from a release reaches production until all of its phases pass.

| Release | Phases | Why grouped |
| --- | --- | --- |
| A | 1 | Bank accounts stand alone |
| B | 2 to 6 | Once allocations own the paid amount (phase 3), the typed paid amount must go (phase 5). From that moment users need a way to record payments, so the screens (phase 6) ship in the same deployment. Otherwise nobody could mark an invoice paid, and the app would send a field the database refuses |
| C | 7 and 8 | Printing, Ask Qula, Worth a look, import warning |

## Common columns and scoping

Every new table in this spec (`bank_accounts`, `payments`, `allocations`) is a business table and carries the standard scoping and audit columns, in addition to those listed for it:

| Column | Rule |
| --- | --- |
| `id` | `uuid`, primary key, default `gen_random_uuid()` |
| `tenant_id` | `uuid`, not null. Foreign key to `tenants(id)`: `ON DELETE CASCADE` for `bank_accounts`, as for the other setup lists, so a tenant holding only bank accounts can still be deleted; `ON DELETE RESTRICT` for `payments` and `allocations`, which is what stops a tenant with payments being deleted |
| `organisation_id` | `uuid`, not null. Foreign key to `organisations(id)`: `ON DELETE CASCADE` for `bank_accounts`; `ON DELETE RESTRICT` for `payments` and `allocations`, since they are financial records |
| `created_at`, `created_by`, `updated_at`, `updated_by` | As every business table, maintained by `private.set_audit_columns` |

Each table also gets:

- `UNIQUE (organisation_id, id)`, so other tables can reference it with same-organisation composite foreign keys
- the existing tenant trigger (`private.enforce_organisation_tenant`)
- row level security enabled, with select on `private.is_org_member(organisation_id)` and the write rules given in each phase
- an index on `organisation_id` and on every foreign key column
- the audit trigger (`private.write_audit_log`)

Every foreign key from these tables to another organisation-scoped table is a composite key on `(organisation_id, <column>)`.

`delete_organisation` also refuses when the organisation has any `payments` row: `This organisation has payments and cannot be deleted.`

## Terms

| Term | Meaning |
| --- | --- |
| Payment | Money going out of the organisation |
| Receipt | Money coming in |
| Allocation | Part or all of a payment, receipt or credit note applied to an open document |
| Effective allocation | An allocation that is neither pending nor removed |
| Open amount | What is still due on a posted invoice or credit note: total + rounding − paid |
| Unallocated | Part of a payment, receipt or credit note not yet applied ("on account") |
| Receivable document | A sales invoice, or a purchase credit note (the other party owes the organisation) |
| Payable document | A purchase invoice, or a sales credit note (the organisation owes the other party) |

Exchange rates follow the existing convention: a rate is how many units of the currency equal one home unit, and **home amount = foreign amount ÷ rate**.

## Decisions taken in this spec

| # | Decision | Default chosen |
| --- | --- | --- |
| K1 | Where payments live | Their own tables, `payments` and `allocations`. Numbering reuses transaction types, with two new kinds: `payment` and `receipt`. |
| K2 | Direction and party | The kind gives the direction of money (payment out, receipt in). The type's Sales or Purchases gives the party. Four combinations, shown below. |
| K3 | Currency | A payment's currency is its party's currency, and its bank account must be in that currency. Cross-currency payments are out of scope and are the **first follow-up** after this spec. |
| K4 | Allocations on drafts | A draft payment can hold planned (pending) allocations. They take effect only when the payment posts, and are re-checked then. |
| K5 | Changing allocations | Any member can add allocations and remove effective ones on posted payments. A removal is recorded, not deleted, with a reason. This is deliberate: an allocation moves no money, and every change is recorded and audited. Voiding a payment is owner or admin only, because it changes the record that money moved. |
| K6 | Credit notes | Posting a credit note with a preceding invoice allocates it to that invoice automatically, up to the invoice's open amount. The allocation can be removed. |
| K7 | Exchange differences | Recorded per allocation, in the home currency, by the formula in phase 3. Not posted anywhere, since Qula Plus has no ledger. Kept for the accounting integration. |
| K8 | Paid amount | `paid_amount` is calculated from allocations and can no longer be typed. Existing non-zero values on posted documents become migrated payments. |
| K9 | Overpayment | An allocation never takes a document's open amount below zero. Any excess stays unallocated, on account. |
| K10 | E-invoice paid amount (BT-113) | Every e-invoice consumer reads `paid_at_posting`, a figure fixed when the document posts, so generated e-invoices never change afterwards. |
| K11 | Small differences | No write-off in this spec. A short payment leaves its difference open. Write-offs and bank charges come with the cross-currency follow-up. |
| K12 | Credit limit on credit notes | Unchanged. Posted credit notes against an invoice may not exceed its **total**, not its amount due. The limit is about what was invoiced, not what was paid. A credit note against a paid invoice leaves its value on account, to be refunded. |

The four payment combinations (K2):

| Kind | Type | Party | Typical use | Allocated to |
| --- | --- | --- | --- | --- |
| `receipt` | Sales | Customer | Customer pays an invoice | Sales invoices |
| `payment` | Purchases | Supplier | Paying a supplier | Purchase invoices |
| `payment` | Sales | Customer | Refund to a customer | Sales credit notes |
| `receipt` | Purchases | Supplier | Refund from a supplier | Purchase credit notes |

---

## Phase 1: bank accounts (release A)

### 1.1 Table `bank_accounts`

| Column | Rule |
| --- | --- |
| `id`, `tenant_id`, `organisation_id` | See "Common columns and scoping". Organisation delete cascades |
| `code`, `name` | Code as other lists (fixed after save), `UNIQUE (organisation_id, code)`; name 1 to 100 |
| `iban` | Normalised before any check: spaces removed, uppercased. Then the existing `private.iban_is_valid` check. Unique per organisation on the normalised value |
| `bic` | Optional. Normalised the same way. Must match `^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$`. Reuse `private.prepare_bic` |
| `currency_id` | Required, one of the organisation's currencies |
| `gl_code_id` | Optional, a Current Asset GL code, for the accounting integration later |
| `active` | Boolean, default true. Inactive accounts can't be used on new payments |
| `is_default` | Boolean, default false |

Default account rules:

- A partial unique index allows at most one default per currency: `UNIQUE (organisation_id, currency_id) WHERE is_default`.
- Setting an account as default clears the previous default for that currency, in the same statement, through a `BEFORE` trigger.
- An inactive account cannot be the default. Making a default account inactive clears its default flag in the same statement.
- Two simultaneous "set default" saves for the same currency may collide on the unique index. One succeeds and the other shows a plain error asking the user to try again.

Permissions are the same as other setup lists: members read; owners and admins write. An account used by a payment cannot be deleted; make it inactive instead.

### 1.2 Migration

If `organisation_defaults.iban` is set, create a bank account from it (code `MAIN`, named from `organisation_defaults.bank_account_name` or "Main account", with the organisation's BIC, home currency, default). Leave the organisation's IBAN in place: it is still what invoices show as payment instructions (BT-84). Linking the two is left for the bank feeds spec.

### 1.3 Screen

**Bank accounts** under Admin, using the standard setup grid and the record form rules.

### Acceptance

- [ ] `ie29 aibk 9311 5212 3456 78` is stored as `IE29AIBK93115212345678`. An invalid IBAN is refused. The same IBAN typed with different spacing is refused as a duplicate.
- [ ] An invalid BIC is refused.
- [ ] Making a second EUR account the default clears the first. Two defaults in different currencies are allowed.
- [ ] An inactive account cannot be made the default.
- [ ] A member can read bank accounts but not change them.
- [ ] The migration creates `MAIN` from the organisation IBAN when one exists, and nothing otherwise.
- [ ] A member of another organisation cannot see the accounts. A row cannot be moved to another organisation, or saved with a tenant that doesn't own its organisation.
- [ ] The same account code can exist in two different organisations.

---

## Phase 2: payment kinds and the payments table (release B)

New column on `transaction_types`: `is_system boolean not null default false`. System types are created only by migrations, are hidden from the new-payment menu, and cannot be edited or deleted by users. Phase 5 uses it for the migrated types.

### 2.1 Kinds

- Add `payment` and `receipt` to `document_kind` in **a migration of its own**. `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as the value.
- Before adding them, list every place that branches on `document_kind` and handle the new values explicitly. At least:
  - every function and trigger in the EN 16931 phase 4 migration and later, including `en16931_document`, `en16931_readiness`, `post_document`, `set_order_status` and `create_from_order`
  - `isOrderKind` and anything else in `src/lib/transaction-types.ts`
  - the Transactions menu, the transaction type admin screen and the form designer
  - Ask Qula tools that filter by kind
- `transaction_headers` refuses these kinds. Payments never become headers.
- Types of these kinds number on post by default, and may number on insert.
- Nothing is seeded. On first use, the Transactions menu offers to create the four standard types: `REC` Customer receipt, `PAY` Supplier payment, `CREF` Customer refund, `SREF` Supplier refund.

### 2.2 Table `payments`

| Column | Rule |
| --- | --- |
| `id`, `tenant_id`, `organisation_id` | See "Common columns and scoping". Organisation delete is restricted |
| `transaction_type_id` | A `payment` or `receipt` type. Fixed after insert |
| `reference`, `document_number` | Issued as for documents, through `private.issue_reference` |
| `status` | `draft`, `posted`, `void` (existing `document_status` values) |
| `source` | `manual` or `migrated` (bank feeds will add `bank_feed`) |
| `payment_date` | Required |
| `customer_id` or `supplier_id` | Exactly one, matching the type's direction, composite keys |
| `party_name` | Copied from the party |
| `bank_account_id` | Required except for `migrated`. Active, same currency as the payment |
| `currency_id` | The party's currency (K3), or for migrated payments the document's currency |
| `exchange_rate` | Defaults from the currency rate. Exactly 1 for the home currency |
| `amount` | `numeric(18,2)`, greater than 0 |
| `home_amount` | `round(amount ÷ exchange_rate, 2)`, set by trigger |
| `allocated_amount`, `unallocated_amount`, `home_unallocated_amount` | Maintained only by the settlement function (phase 3.4). They count effective allocations only, so a draft shows nothing allocated even when it holds pending allocations. A void payment has `unallocated_amount` and `home_unallocated_amount` of 0. Grids, filters and findings for money on account use posted payments only |
| `payment_means_code` | From `ref_payment_means`. Defaults to `58` |
| `bank_reference` | Up to 140 |
| `notes` | Up to 4000 |
| `posted_at`, `posted_by`, `voided_at`, `voided_by`, `void_reason` | As for documents, with the same completeness constraints as `transaction_headers` |

What may change by status:

| Status | Editable |
| --- | --- |
| `draft` | Everything except `transaction_type_id` |
| `posted` | `notes` and `bank_reference` only (both audited). Amount, party, currency, rate, bank account, date and payment means are fixed |
| `void` | Nothing |

RLS: members select; members insert, update and delete drafts; members update `notes` and `bank_reference` on posted payments. Status changes only through the phase 4 functions, using a transaction-local setting as documents do.

### Acceptance

- [ ] A Purchases `receipt` with a customer is refused; with a supplier it is accepted.
- [ ] A payment whose bank account currency differs from its own is refused.
- [ ] A home-currency payment with an exchange rate other than 1 is refused.
- [ ] `transaction_headers` refuses a payment-kind type.
- [ ] A payment cannot reference a party, bank account, currency or type from another organisation.
- [ ] On a posted payment, changing `notes` succeeds and is audited; changing `amount` or `payment_means_code` is refused.
- [ ] An organisation with a payment cannot be deleted, and neither can its tenant.
- [ ] Every existing kind test still passes, and orders and invoices behave exactly as before.

---

## Phase 3: allocations and settlement (release B)

### 3.1 Table `allocations`

| Column | Rule |
| --- | --- |
| `id`, `tenant_id`, `organisation_id` | See "Common columns and scoping". Organisation delete is restricted |
| `source_payment_id` | Nullable. The payment or receipt being applied |
| `source_header_id` | Nullable. A credit note being applied to an invoice |
| | Exactly one of the two sources is set |
| `target_header_id` | Required. The document being settled |
| `amount` | `numeric(18,2)`, greater than 0, in the shared currency |
| `allocation_date` | See 3.3 |
| `home_amount_at_target_rate`, `home_amount_at_source_rate` | See 3.5 |
| `exchange_difference` | See 3.5 |
| `pending` | True while the source payment is a draft (K4) |
| `removed_at`, `removed_by`, `removal_reason` | Set when an effective allocation is removed. The row stays (K5) |

### 3.2 Allowed pairs and rules, enforced by trigger

| Source | Allowed target |
| --- | --- |
| Customer receipt | Posted sales invoice |
| Supplier payment | Posted purchase invoice |
| Customer refund (payment, Sales) | Posted sales credit note |
| Supplier refund (receipt, Purchases) | Posted purchase credit note |
| Posted sales credit note | Posted sales invoice |
| Posted purchase credit note | Posted purchase invoice |

Also:

- A credit note is never the target of another credit note.
- Source and target belong to the same organisation, the same party and the same currency.
- The target is never a draft, void document, order or requisition.
- A void or deleted payment cannot be a source. A draft payment can, as a pending allocation.
- **Over-allocation is refused (K9).** The same figure is used for both sides of a check:
  - an invoice: effective allocations targeting it cannot exceed its total plus rounding
  - a payment or receipt: effective allocations from it cannot exceed its amount
  - a credit note: effective allocations **as source** (applied to invoices) **plus** effective allocations **as target** (refunds) cannot exceed its total plus rounding. This is the same sum as its `paid_amount` (3.4), so a credit note's amount due can never go below zero
- An effective allocation cannot be edited. To change it, remove it and add a new one.
- **Locking:** every function that allocates locks the source row and then each target row with `SELECT ... FOR UPDATE`, targets in ascending `id` order, before checking open amounts. This applies to `allocate`, `allocate_oldest_first`, `post_payment` and the credit note allocation in `post_document`. Model the concurrency test on `supabase/tests/concurrency/last_unit.sh`.

### 3.3 Dates

- `allocation_date` defaults to the later of the source date and the target date (`payment_date` or the credit note's `transaction_date`, and the target's `transaction_date`). It may be set later than that, never earlier.
- When a draft payment posts, each pending allocation's date becomes the later of the payment date, the target date and the date it was given.
- **Lock date:**
  - an allocation whose `allocation_date` is on or before the lock date cannot be created
  - an effective allocation whose `allocation_date` is on or before the lock date cannot be removed, because that would change a closed period
  - `post_payment` checks the payment's own `payment_date` (even when nothing is allocated) and every allocation it makes effective
  - `void_payment` is refused when the payment date, or any of its effective allocations' dates, is on or before the lock date
  - the only exception is the phase 5 migration (5.3)

### 3.4 Settlement: who owns the paid figures

One function, `private.refresh_settlement(...)`, computes and writes these columns. No other code writes them:

| Table | Columns |
| --- | --- |
| `transaction_headers` | `paid_amount`, `amount_due`, `home_amount_due` (new) |
| `payments` | `allocated_amount`, `unallocated_amount`, `home_unallocated_amount` |

Figures:

- For an invoice: `paid_amount` = sum of effective allocations targeting it.
- For a credit note: `paid_amount` = sum of effective allocations targeting it (refunds) plus those where it is the source (applied to invoices).
- `amount_due` = total + rounding − `paid_amount`.
- `home_amount_due` = home total − sum of `home_amount_at_target_rate` over the same allocations (for a credit note used as a source, `home_amount_at_source_rate`).

Rules:

- The allocation trigger calls it for the source and the target after every insert, removal or change of `pending`.
- The existing header totals trigger, which derives `amount_due` from `paid_amount`, uses the same expression and must give the same result. Remove any second derivation.
- It runs with a transaction-local setting, `fintran.settlement`. While it is set:
  - the posted-document lock trigger allows changes to `paid_amount`, `amount_due` and `home_amount_due` only, on posted documents
  - `set_audit_columns` leaves `updated_at` and `updated_by` alone
  - `write_audit_log` skips header updates that change only these columns. The allocation rows themselves are audited, so nothing is lost
- Void documents are never refreshed. They keep their stored figures.
- A draft document always has `paid_amount = 0`, enforced by a check constraint. Its `amount_due` is its total plus rounding.

### 3.5 Home amounts and exchange differences

For each allocation:

- `home_amount_at_target_rate` = `round(amount ÷ target exchange rate, 2)`
- `home_amount_at_source_rate` = `round(amount ÷ source exchange rate, 2)`

**When they are calculated.** Home amounts and the exchange difference are set when an allocation becomes effective, not when it is created as pending. The rounding rule below depends on what is already allocated, so a pending allocation holds zeros in these columns until its payment posts.

**Equal rates.** When the source and target exchange rates are equal, `home_amount_at_source_rate` is set equal to `home_amount_at_target_rate` and `exchange_difference` is 0. This overrides the rounding rule below, so equal rates never produce a one cent difference.

**Rounding drift.** Otherwise, the allocation that brings a target's open amount to exactly zero takes the target's remaining home balance as `home_amount_at_target_rate`, instead of the rounded division. Likewise the allocation that fully allocates a payment, or fully applies a credit note, takes the source's remaining home balance as `home_amount_at_source_rate`. Fully settled documents and payments therefore always end with zero home balance.

**Exchange difference**, positive for a gain to the organisation:

| Target | Formula |
| --- | --- |
| Receivable (sales invoice, purchase credit note) | `home_amount_at_source_rate − home_amount_at_target_rate` |
| Payable (purchase invoice, sales credit note) | `home_amount_at_target_rate − home_amount_at_source_rate` |

Worked example, home currency EUR:

- A £100.00 sales invoice at rate 0.85 is €117.65. A £100.00 receipt at 0.86 is €116.28. Exchange difference **−€1.37** (a loss: the same pounds bought fewer euros).
- The same figures on a purchase invoice and supplier payment give **+€1.37** (a gain).
- A £100.00 sales invoice at 0.85 (€117.65) paid by two £50.00 receipts at 0.85: the first allocation is €58.82, the second takes the remaining €58.83. `home_amount_due` ends at €0.00 and both exchange differences are €0.00 (equal rates).

### 3.6 E-invoice figures (K10)

- Add `paid_at_posting numeric(18,2)` and `supplier_stated_paid_amount numeric(18,2)` to `transaction_headers`.
- `post_document` sets `paid_at_posting` to the current `paid_amount` **before** any credit note allocation (3.7), so a credit note's own e-invoice is unaffected by its application.
- Every e-invoice consumer reads `paid_at_posting` for posted and void documents, never the live figure. At least:
  - `en16931_document` and `en16931_source` (BT-113 and BT-115)
  - the `BR-CO-16` amount-due check in `en16931_readiness`
  - the outbound e-document payload and its check that `semantic` equals `en16931_document`
- For drafts, BT-113 is 0, since a draft cannot have allocations.
- Backfill: set `paid_at_posting = paid_amount` on every existing posted and void document, before any other change in this release.

### 3.7 Credit notes at posting (K6)

After setting `paid_at_posting`, `post_document` allocates a credit note with a `preceding_header_id` to that invoice, for the smaller of the credit note's total and the invoice's open amount, dated the later of the two documents' dates. If the invoice is already settled, no allocation is made and the credit note's value stays on account.

The credit note limit (K12) is unchanged: posted credit notes against an invoice still may not exceed the invoice's total.

### 3.8 Imported e-invoices

- `import_e_document` writes BT-113 to `supplier_stated_paid_amount`, not to `paid_amount`. It is information only and is never allocated or counted.
- Phase 8 shows a warning from it.
- Backfill: for documents already imported from an inbound e-document, set `supplier_stated_paid_amount` from the stored BT-113 where it is greater than 0, so the phase 8 warning works for them too.

### 3.9 Voiding and deleting

- `void_document` is refused when the document has any effective allocation, as source or target: `Remove this document's allocations before voiding it.` This includes the automatic allocation made when a credit note posts (3.7), so a wrongly posted credit note must have that allocation removed first. The credit note screen shows the message with a link to its Payments tab.
- Voiding a document deletes any **pending** allocations that target it (they belong to draft payments and have no effect yet). The draft payment then shows the amount as unallocated.
- `delete_payment` removes a draft payment and its pending allocations.

### 3.10 Access

- No direct insert, update or delete on `allocations` for `authenticated`. All writes go through security definer functions that check membership themselves.
- `save_payment` (phase 4) is security invoker for the payment row. It replaces pending allocations by calling `private.replace_pending_allocations(p_payment_id, p_lines jsonb)`, security definer, which checks that the caller is a member and the payment is a draft.

### 3.11 Functions

| Function | Behaviour |
| --- | --- |
| `allocate(p_source jsonb, p_target_header_id uuid, p_amount numeric, p_date date default null)` | Any member. `p_source` is `{"paymentId": …}` or `{"creditNoteId": …}`. Pending when the source payment is a draft |
| `remove_allocation(p_allocation_id uuid, p_reason text)` | Any member (K5). Effective allocations only. Reason required |
| `allocate_oldest_first(p_source jsonb)` | Any member. Applies the source's unallocated amount to the party's open documents allowed for that source, oldest due date first, then oldest date, then lowest id |

### Acceptance

- [ ] A €1,000 receipt allocated €600 and €400 to two invoices leaves both with amount due 0 and the receipt fully allocated.
- [ ] Allocating €1,200 against a €1,000 invoice is refused. Allocating €800 of a €1,000 receipt leaves €200 unallocated.
- [ ] Two concurrent allocations for the last €100 of an invoice: one succeeds, one is refused, and no deadlock occurs (concurrency test).
- [ ] An allocation to a draft invoice, an order, a void document or another party's invoice is refused.
- [ ] A credit note as the target of another credit note is refused.
- [ ] An allocation from a void payment is refused.
- [ ] An allocation whose source and target are in different organisations is refused by the foreign keys, even inside one tenant.
- [ ] Posting a €300 credit note against a €1,000 invoice reduces its amount due to €700, and the credit note's `paid_at_posting` is 0.
- [ ] Posting a credit note against a fully paid invoice makes no allocation and leaves the credit note open.
- [ ] Removing an allocation restores the open amount, and the removed row remains with its reason.
- [ ] The three worked examples in 3.5 produce exactly −€1.37, +€1.37 and €58.83, with `home_amount_due` €0.00 and an exchange difference of €0.00 on both allocations of the third.
- [ ] A pending allocation holds zero home amounts and an exchange difference of 0 until its payment posts, and has them set on posting.
- [ ] A €300 credit note applied €300 to an invoice cannot also be refunded any amount: the refund is refused, and its amount due stays 0.
- [ ] A €300 credit note applied €200 to an invoice can be refunded €100 but not €101.
- [ ] A void payment shows unallocated 0 and does not appear in "has money on account".
- [ ] A draft document with a non-zero `paid_amount` is refused by the database.
- [ ] Posting a payment with no allocations, dated on or before the lock date, is refused.
- [ ] An allocation dated on or before the lock date is refused, and so is removing one dated on or before it.
- [ ] Allocating to a posted document changes its `paid_amount` and `amount_due` without changing its `updated_at`, and writes no header audit row.
- [ ] `void_document` on a purchase invoice with an effective allocation is refused. Voiding one with only a pending allocation deletes that allocation.
- [ ] `en16931_document`, `en16931_readiness` and stored outbound e-documents are unchanged for every existing fixture after allocations are added to their documents.
- [ ] Importing an e-invoice with BT-113 of €50.00 sets `supplier_stated_paid_amount` to 50.00 and leaves `paid_amount` at 0.
- [ ] Authenticated users cannot insert, update or delete `allocations` directly.

---

## Phase 4: posting, voiding and numbering payments (release B)

| Function | Behaviour |
| --- | --- |
| `save_payment(p_payment jsonb) returns uuid` | Security invoker. Inserts or replaces a draft payment, then calls `private.replace_pending_allocations`. Refuses a non-draft. Fills party name, currency and default rate |
| `post_payment(p_payment_id uuid)` | Any member. Locks as in 3.2. Re-checks every pending allocation against current open amounts and fails, naming each document that no longer has enough open, if any would over-allocate or now targets a void document. Sets allocation dates (3.3), checks the lock date, makes the allocations effective, issues the number when the type numbers on post, and sets the posting fields |
| `void_payment(p_payment_id uuid, p_reason text)` | Owner or admin. Posted payments only. Lock date as in 3.3. Marks every effective allocation removed with the void reason, then voids |
| `delete_payment(p_payment_id uuid)` | Drafts only |

A post that fails any check consumes no number.

### Acceptance

- [ ] A draft receipt with pending allocations posts, and the allocations become effective with the dates from 3.3.
- [ ] If another receipt posted meanwhile took the open amount, posting fails, names the invoice and issues no number.
- [ ] Voiding a posted receipt restores every invoice's amount due.
- [ ] A member cannot void; an admin can, with a reason.
- [ ] A payment dated on or before the lock date cannot be posted. One with an allocation dated on or before it cannot be voided.
- [ ] On-post numbering issues gapless numbers for payments, as for sales documents.

---

## Phase 5: removing the typed paid amount (release B)

The `save_document` change and the screen change happen here, in the same release as phase 3, so the app never sends a field the database refuses.

### 5.1 App and save function

- `save_document` refuses a `paidAmount` value: `The paid amount is calculated from payments and cannot be typed.`
- Remove `paidAmount` from every caller: at least `src/lib/document-actions.ts` (the save and `updatePaidAmount` paths) and `HeaderPane.tsx`. Search for any other caller.
- Remove `updatePaidAmount`.
- The Payment tab shows paid (or "Applied" on credit notes) and amount due as read-only figures, with a link to the Payments tab (6.2, in the same release).

### 5.2 Migration of existing figures

Run in one migration, after the `paid_at_posting` backfill (3.6), with every list below written to the migration output:

| Documents | What happens |
| --- | --- |
| Posted invoices and credit notes with `paid_amount > 0` | A migrated payment and an allocation, as in 5.3 |
| Posted documents where `paid_amount` is greater than total plus rounding (overpaid) | Migrated payment for the full old `paid_amount`, allocation capped at total plus rounding, the excess left unallocated on the migrated payment. Listed. This is the one case where `amount_due` changes: a negative figure becomes 0 |
| Drafts with `paid_amount > 0` | `paid_amount` set to 0. Listed, since drafts can't hold allocations |
| Void documents with `paid_amount > 0` | Left unchanged. No migrated payment. Listed. Excluded from every open-item view |
| Posted documents linked to an inbound e-document whose `paid_amount` equals its BT-113 | Migrated as normal, so figures stay unchanged, and also listed for review, since the figure came from the supplier's file rather than a recorded payment |

### 5.3 Migrated payments

For each posted document in 5.2:

| Document | Migrated payment kind and type |
| --- | --- |
| Sales invoice | `receipt` on a Sales type |
| Purchase invoice | `payment` on a Purchases type |
| Sales credit note | `payment` on a Sales type (customer refund) |
| Purchase credit note | `receipt` on a Purchases type (supplier refund) |

- Use dedicated migrated types per kind and direction: `MIGREC`, `MIGPAY`, `MIGCREF`, `MIGSREF`, prefix `MIG-`, numbering on insert, with `is_system = true` (phase 2). They never share a number sequence with real payment types, and users cannot see, edit or delete them in the menu or the type admin screen.
- The payment has `source = 'migrated'`, no bank account, the document's party, the **document's** currency and exchange rate, `payment_date` = the document date, amount = the old `paid_amount`, and notes "Migrated from the typed paid amount".
- One effective allocation of the smaller of the old `paid_amount` and the document's total plus rounding, dated the document date. Any excess stays on the migrated payment as unallocated and is listed (see the overpaid row in 5.2).
- The migration runs with a migration-only setting that lets it bypass the lock date. No function exposes that setting.

Every posted document's `paid_amount`, `amount_due` and `paid_at_posting` must be exactly as before, except overpaid documents, whose negative `amount_due` becomes 0 (5.2). `paid_at_posting` is unchanged for all of them. Test against a copy of the live project: a Supabase branch if Geoff approves one, otherwise a local restore of a dump.

### Acceptance

- [ ] Every posted document's paid amount, amount due and `paid_at_posting` are unchanged after migration, except overpaid documents, which are listed and whose negative amount due becomes 0.
- [ ] `MIG*` types are not offered in the new-payment menu and cannot be edited or deleted by users.
- [ ] Each converted document shows one migrated allocation, and each migrated payment has a `MIG-` number.
- [ ] Real payment types' number sequences are unaffected.
- [ ] A posted document dated before the lock date migrates successfully.
- [ ] Drafts end with paid amount 0; void documents are unchanged.
- [ ] No screen, action or function accepts a typed paid amount.

---

## Phase 6: screens (release B)

### 6.1 Payment entry

Payment and receipt types appear in the Transactions menu like other types, with the standard grid. The entry screen follows the document screen conventions (status row, fill-page form, footer actions), with its own layout:

- **Left: header.** Type, date, party, bank account (active accounts in the party's currency, default preselected), amount, currency (read-only), exchange rate, payment means, bank reference, notes.
- **Right: open items.** The party's open documents allowed for this kind (3.2): number, date, due date, total, open amount and an **Allocate** amount field. Buttons: **Allocate oldest first** and **Clear**.
- **Totals.** Amount, allocated and unallocated. Unallocated is shown as "On account" when positive.
- **Footer.** Delete (drafts) on the left. Cancel, Save and Save and post on the right. Void on posted payments, for owners and admins.

On a posted payment, the open items panel stays usable for allocating unallocated money. Each effective allocation has **Remove**, which asks for a reason. Notes and bank reference stay editable.

### 6.2 Documents

- Add a **Payments** tab to posted invoices and credit notes. It lists effective and removed allocations (source, date, amount, exchange difference, who and when), the open amount, and **Record receipt** or **Record payment**.
- Those buttons open a new draft of the right kind, with the party, currency and the full open amount pre-allocated.
- On credit notes the paid figure is labelled **Applied**. A posted credit note with an unallocated balance shows **Apply to an invoice** and **Refund**.

### 6.3 Lists and parties

- Document grids gain **Paid** and **Amount due** columns and a filter for unpaid, part paid or paid.
- The party summary shows unallocated money on account and recent payments.
- Payment grids show amount, allocated and unallocated, with a filter for "has money on account".

### Acceptance (also as end-to-end flows)

- [ ] Record a receipt from a posted sales invoice, post it, and the invoice shows paid.
- [ ] Enter a receipt for two invoices using Allocate oldest first, post it, and both show the right amounts due.
- [ ] Apply a credit note's balance to a second invoice.
- [ ] Refund a customer's unallocated credit note balance with a customer refund.
- [ ] Remove an allocation on a posted payment with a reason, then reallocate it to another invoice.

---

## Phase 7: printing (release C)

- Add standard printable layouts:
  - **Remittance advice** for supplier payments and customer refunds
  - **Receipt** for customer receipts and supplier refunds
- Each shows the organisation and party details, the payment date, number, method, bank reference, amount, a table of effective allocations (document number, date, document total, amount applied) and any amount on account.
- They print from the payment page through the existing print route, with Print and PDF.
- Add `payment` and `receipt` kinds to the form designer, with the allocation table columns as line columns.

### Acceptance

- [ ] A supplier payment allocated to three invoices prints a remittance advice listing all three.
- [ ] A draft payment prints with the DRAFT watermark; a void one with VOID.

---

## Phase 8: Ask Qula, Worth a look and e-invoices (release C)

### 8.1 Ask Qula

- Ageing, overdue and top-party lookups use the calculated amount due.
- Add a `search_payments` lookup by party, date, kind, amount and unallocated balance.
- No new actions.

### 8.2 Worth a look

- **Money on account:** posted payments or credit notes with unallocated amounts older than 7 days
- **Part paid and overdue:** invoices past due with some payment allocated
- **Likely matches:** an unallocated receipt equal to the open amount of exactly one of that customer's invoices

### 8.3 Received e-invoices

When an imported document's `supplier_stated_paid_amount` is greater than 0, the import screen and the document show that the supplier says it is partly paid, so the user can record or check the payment. Nothing is created automatically.

### Acceptance

- [ ] "Who owes us the most?" reflects allocations, not the old typed figures.
- [ ] A receipt left unallocated for 8 days appears in Worth a look.
- [ ] An imported e-invoice with BT-113 greater than 0 shows the warning.

---

## Out of scope

- **First follow-up:** cross-currency payments, bank charges and small-difference write-offs
- Bank feeds, statement import and matching (next spec)
- Accounting system integration and journal export
- Making payments or collecting money: no bank payment files, direct debits or card payments
- Payment discounts, customer statements and dunning runs (Ask Qula can still draft a reminder)

## Done when

- [ ] All SQL, unit and end-to-end tests pass on a fresh database built from all migrations in order.
- [ ] The release B migration runs cleanly against a copy of the live project, with every paid amount, amount due and `paid_at_posting` unchanged (overpaid documents excepted, and listed), and its review lists produced.
- [ ] Types are regenerated.
- [ ] `TECHNICAL.md`, `CORE.md` and the status document describe payments, receipts, allocations, settlement and calculated paid amounts, and drop "Paid amount is a single figure typed on the document" from the gaps.
