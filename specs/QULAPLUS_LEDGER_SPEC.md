# Qula Plus general ledger spec

Version 2, 25 November 2026. Revised from version 1 after a review against the code and the six scoping answers below. Nothing in it is built.

Goal: give Qula Plus a double-entry general ledger that works two ways. An organisation can use Qula Plus as its book of record, or use it as a feed that sends documents and payments to another accounting system. The same ledger engine runs in both cases. Every posted document, payment and allocation produces balanced journal entries automatically, in the same database transaction. Owners and admins can post manual journals. A trial balance proves the books balance and agree with the customer and supplier balances.

This replaces the earlier position that Qula Plus has no ledger and will not have one. `CORE.md`, `docs/QULA_PLUS_REFERENCE.md` and `specs/QULAPLUS_JOURNAL_EXPORT_SPEC.md` say so and must be updated when this is built.

Read `AGENTS.md`, `TECHNICAL.md`, `CORE.md`, `docs/QULA_PLUS_REFERENCE.md` and these specs first: `QULAPLUS_PAYMENTS_SPEC.md`, `QULAPLUS_APPROVALS_SPEC.md`, `QULAPLUS_PAYMENT_APPROVALS_SPEC.md`, `QULAPLUS_JOURNAL_EXPORT_SPEC.md` and `QULAPLUS_HARDENING_SPEC.md`. All of them are built. This spec posts through the same functions they define, sits behind the approval gates they add and replaces the journal calculation the journal export spec defines.

## Rules for the agent

The rules from the earlier specs still apply: new migrations only, rules enforced in Postgres, no service-role key, security definer functions with `search_path = ''`, British spelling, SQL tests for every acceptance criterion, regenerate types and update the documentation after each phase (`npm run check:docs` must pass). Each phase must leave behaviour that is not mentioned in it unchanged.

Additionally:

1. Read the relevant guide in `node_modules/next/dist/docs/` before writing any app code. This is not the Next.js of older releases.
2. A SQL test that proves the balance rule must run `SET CONSTRAINTS ALL IMMEDIATE`. Every test rolls back, so a trigger deferred to commit would never fire.
3. Every SQL test that posts anything ends by asserting every reconciliation difference is 0 (phase 5).
4. Lock order, everywhere: transaction type row, then the document or payment, then allocations in id order, then the ledger counter last. A new function that takes locks follows it.
5. Do not copy posting rules into a second place. The ledger entries are the only calculation of a journal. Everything else reads them.

## Answers to the scoping questions

| # | Question | Answer | How the spec reads it |
| --- | --- | --- | --- |
| 1 | What the mode changes | **Controls, screens and export only** | The same entries are posted in both modes (L1). Switching mode never rebuilds anything |
| 2 | Mode scope | **Per organisation** | A setting on `organisation_defaults` (L2) |
| 3 | What a feed sends | **Documents and payments** | The feed carries invoices, credit notes, payments, receipts, refunds and allocations, with cancellations. It does not carry journals, because systems such as Xero refuse journals to their own debtor and creditor accounts (L9). The journal CSV stays for manual journals and for systems that accept journals |
| 4 | Reversal date | **One rule from the state of the period** | The original date when that period is open and not exported, otherwise the date of the void or removal (L6) |
| 5 | What exporting does to a period | **An optional lock, on by default in feed mode** | A setting that refuses new postings dated in exported periods (L7). It is deliberately separate from the lock date, because the lock date also blocks voids |
| 6 | Starting point | **A go-live date and an opening balance journal** | Brought forward from spec 10 into this spec, because book mode cannot be used without it (L11, phase 7) |

The remaining decisions are defaults. They are listed in the decisions table and can be changed before building.

## What exists today that this changes

| Place | Today | Under this spec |
| --- | --- | --- |
| Journal calculation | `private.journal_lines` works journals out from documents, payments and allocations when a batch is made. Rules are in `QULAPLUS_JOURNAL_EXPORT_SPEC.md` (J6 to J11) | Journals are made once, at posting, and stored. `private.journal_lines` is retired. The journal export reads stored entries |
| Account roles | `accounting_settings` holds seven GL code columns and a start date, edited on the Accounting tab | `gl_codes.system_role` is the only place a role is stored. `accounting_settings` keeps only the export start date |
| Reversals | A journal reversal is dated on the day of the void or removal | One rule from the state of the period (L6). Exported entries still reverse on the void date |
| Bank account GL code | Optional. A missing one is a journal export problem | Required, unique, created automatically (L8) |
| GL code on lines | Optional on purchases. Imported e-invoice lines have none. The journal export sends them to suspense | Required at posting, in both directions (L8). Suspense is used only for backfilled history |
| GL account types | Fixed Asset, Current Liability, Current Asset, Income, Expense | Adds Non-current Liability, Equity and Cost of Sales |
| Lock date | Blocks create, edit, post, void and delete of documents dated on or before it. Allocations respect it | Unchanged, and it also stops ledger entries. A separate exported-through date (L7) stops only new postings |
| Roles | Members read everything in the organisation | Ledger rows are readable by owners and admins only (L12) |
| Journal export tables | `journal_batches`, `journal_batch_lines`, `journal_exports` | Kept. They read from stored entries. Existing batches are matched to backfilled entries so nothing is sent twice (L10) |

## Releases

| Release | Phases | Why grouped |
| --- | --- | --- |
| A | 1 and 2 | Chart of accounts, mode setting and journal tables. Nothing posts yet |
| B | 3, 4 and 5 | **Shadow mode.** Posting starts, history is backfilled and the reconciliation runs. Nothing a person does changes. Lines with no GL code post to suspense and are listed. A ledger that holds only some activity is wrong, so these deploy together |
| C | 6, 7 and 8 | Enforcement, manual journals, opening balances, the mode switch and the screens. The new requirements (GL code on every line, period rules) switch on here |
| D | 9 | The feed: documents and payments, and the journal export refit |

Release B must run on the hosted project, with every reconciliation difference 0, before release C is built.

## Common columns and scoping

Every new table is a business table with the standard columns and rules: `id`, `tenant_id`, `organisation_id`, the audit columns, `UNIQUE (organisation_id, id)`, the tenant trigger, an index on every foreign key and composite foreign keys on `(organisation_id, <column>)` to other organisation-scoped tables. `journal_entries` and `journal_lines` are financial records: `ON DELETE RESTRICT` to their organisation and tenant, and `delete_organisation` refuses when any journal entry exists. Select on them is `private.has_org_role(organisation_id, array['owner','admin'])` (L12).

They are not copied into `audit_log`. They are immutable records and their volume would swamp it. Draft manual journals, mode changes and role changes are audited.

## Terms

| Term | Meaning |
| --- | --- |
| Journal entry | One balanced posting: a date, a source and two or more lines |
| Journal line | A debit or a credit to one GL code, with optional department and cost centre |
| Control account | A GL code that only system postings may use, because customers or suppliers explain its balance |
| System role | A job a GL code does for the posting rules, such as debtors control |
| Source | What caused an entry: a document, a payment, an allocation, a manual journal or a reversal |
| Mode | `book` (Qula Plus is the book of record) or `feed` (it sends to another system) |
| Exported through | The latest date any exported feed or journal batch covers |

Amounts follow the existing rules: money is `numeric(18,2)`, and home amount = foreign amount ÷ exchange rate.

## Decisions taken in this spec

Rows marked **answered** come from the scoping answers. The rest are defaults.

| # | Decision | Default chosen |
| --- | --- | --- |
| L1 | What the mode changes (**answered**) | Only controls, screens and export. The ledger posts the same entries in both modes, always, from the day it is switched on |
| L2 | Mode scope (**answered**) | Per organisation: `organisation_defaults.ledger_mode`, `feed` or `book`. Existing organisations start as `feed`. A new organisation is asked at creation and defaults to `book` |
| L3 | Switching mode | Owner only, through `set_ledger_mode(organisation_id, mode, reason)`, which records the reason in the audit log. To `book` needs a go-live date and a posted opening balance journal, or a recorded waiver reason. To `feed` needs no draft manual journals and a lock date set |
| L4 | How entries are made | By `AFTER` triggers on the status changes of `transaction_headers` and `payments` and on `allocations`, so every route to a posted state is covered, including payment runs and the automatic credit note application. If the ledger posting fails the whole action fails and consumes no number |
| L5 | Correcting the ledger | Entries are immutable once posted. A correction is a reversing entry. Nothing is ever updated or deleted, except draft manual journals |
| L6 | Date of a reversal (**answered**) | The original entry date when that date is after the lock date and after the exported-through date. Otherwise the date of the void or removal, which must be after the lock date |
| L7 | What exporting does (**answered**) | Each export sets `exported_through`. A setting `lock_exported` (default on in feed mode, off in book mode) refuses a new posting dated on or before it. When off, such a posting shows a warning to the owner. Voids and removals are never blocked by it: they reverse on their own date (L6) |
| L8 | Required accounts | Every invoice and credit note line needs a GL code at posting, sales and purchases. Every bank account needs its own Current Asset GL code. Both are enforced in release C |
| L9 | What a feed sends (**answered**) | Documents, payments, allocations and cancellations, in a neutral format (phase 9). Manual journals travel by the journal CSV |
| L10 | Journals already exported | The backfill matches the source and stage of existing `journal_batch_lines` and marks the matching entries exported, so nothing is sent twice |
| L11 | Starting point (**answered**) | A go-live date and an opening balance journal, a flagged manual journal that may not touch control accounts. Opening debtors and creditors are entered as ordinary documents dated before go-live |
| L12 | Who sees and posts | Owners and admins read the ledger and post manual journals. Members see none of it, including the Ledger tab on documents. A read-only accountant role is a separate spec |
| L13 | Control accounts | Debtors control and creditors control may only be used by system postings. Manual journals, document lines and products cannot use them |
| L14 | Balancing currency | Every entry balances in the home currency. Lines also carry the document currency amount and rate. Home rounding differences go to the rounding account |
| L15 | Reverse charge and self-accounted VAT | Not posted in this spec. Lines post with the VAT they carry. The VAT returns spec adds self-accounting. The role name `vat_deferred` is reserved for Irish cash receipts basis and not created |
| L16 | Journal numbers | One sequence per organisation, issued in posting order. Gaps are allowed. Backfilled entries take the next numbers in date order, and the first live entry follows them |
| L17 | Migrated payments | Payments with `source = 'migrated'` have no bank account. They post to suspense and are listed for review |
| L18 | Out of scope, named now | Consolidation and intercompany, periods and year end, bank reconciliation, foreign currency revaluation, fixed assets, VAT returns, formatted reports |

---

## Phase 1: chart of accounts (release A)

### 1.1 Account types

Extend the `gl_codes.account_type` check to:

| Type | Report section | Normal balance |
| --- | --- | --- |
| Fixed Asset | Balance sheet, non-current assets | Debit |
| Current Asset | Balance sheet, current assets | Debit |
| Current Liability | Balance sheet, current liabilities | Credit |
| Non-current Liability | Balance sheet, non-current liabilities | Credit |
| Equity | Balance sheet, equity | Credit |
| Income | Profit and loss | Credit |
| Cost of Sales | Profit and loss | Debit |
| Expense | Profit and loss | Debit |

Existing values stay valid. Add `private.account_normal_balance(text)` so reports never hard-code the table. A product's purchase GL code may be Expense or Cost of Sales. Its sales GL code must be Income. A purchase invoice line may use any type, as today, so assets and prepayments can be bought.

### 1.2 Extra columns on `gl_codes`

| Column | Rule |
| --- | --- |
| `system_role` | Nullable, unique per organisation where set |
| `active` | Boolean, default true. An inactive code cannot be used on new lines or journals |
| `external_code`, `external_name` | Nullable, up to 60 and 120. The code and name of this account in the other accounting system. Used by the feed in both modes |
| `report_group` | Nullable text, up to 60. Reserved for the reports spec so no later migration is needed |

### 1.3 System roles

| Role | Account type | Used for |
| --- | --- | --- |
| `debtors_control` | Current Asset | What customers owe, net of money on account |
| `creditors_control` | Current Liability | What the organisation owes suppliers, net of money on account |
| `vat_output` | Current Liability | VAT on sales |
| `vat_input` | Current Asset | VAT on purchases |
| `retained_earnings` | Equity | Year-end close (spec 10) |
| `fx_difference` | Expense | Realised exchange gains and losses |
| `rounding` | Expense | Home rounding differences and BT-114 rounding amounts |
| `suspense` | Current Asset | Postings that need review |

Enforced by trigger:

- A code's `system_role` must match the account type in the table.
- `system_role` cannot change, and the code cannot be deleted or made inactive, once any journal line uses it.
- A code with the role `debtors_control` or `creditors_control` cannot be chosen on a document line, a product or a manual journal (L13).
- Every organisation has exactly one code for each role. Posting refuses with a clear message if one is missing.

### 1.4 One source of truth for roles

The Accounting choices live in `accounting_settings`, edited on the Accounting tab of the organisation edit. The mapping is one to one:

| Column | Role |
| --- | --- |
| `receivables_gl_code_id` | `debtors_control` |
| `payables_gl_code_id` | `creditors_control` |
| `vat_sales_gl_code_id` | `vat_output` |
| `vat_purchases_gl_code_id` | `vat_input` |
| `exchange_gl_code_id` | `fx_difference` |
| `rounding_gl_code_id` | `rounding` |
| `suspense_gl_code_id` | `suspense` |

`retained_earnings` has no existing source and is always created. After this phase `gl_codes.system_role` is the only place a role is stored. The Accounting tab keeps its screen but reads and writes `system_role`. The six role columns and `suspense_gl_code_id` are dropped in the same release, once nothing reads them. `accounting_settings` keeps its row and its start date, renamed `export_start_date`.

Migration, for each organisation and each role, in this order:

1. **Existing choice.** A code named in `accounting_settings` takes the role. The migration never creates a second account for a role already set.
2. **No choice.** Create a code from this list, using the first free code: `1100` Debtors control, `2100` Creditors control, `2200` VAT on sales, `1200` VAT on purchases, `3200` Retained earnings, `7900` Exchange differences, `7910` Rounding, `9990` Suspense. When the code is taken, append `-1`, `-2` and so on.

Pre-checks, before any change, listing every problem and stopping if there are any:

- a choice whose account type does not match the role, such as a debtors account typed as Income. The existing screen does not check types, so this is possible
- one GL code chosen for two roles
- a code chosen for a control role that is already used on a document line or a product (list them, so they can be moved first)

List in the migration output, for every organisation, which codes were adopted and which were created. `create_tenant` and `create_organisation` create the default set for every new organisation.

### 1.5 Bank accounts (L8)

- For each bank account without a GL code, create a Current Asset code `1210`, `1211` and so on, named "Bank: {account name}", and link it.
- `bank_accounts.gl_code_id` becomes `NOT NULL`, must be a Current Asset code with no system role, and is unique per organisation.
- Pre-check: list bank accounts that already share a GL code. Stop, so they can be split first.
- Changing a bank account's GL code is refused once any journal line uses it.
- The bank account form creates a GL code for a new bank account by default, with the option to choose an existing unused one. Update the end-to-end seed and the bank account and payment flows (11 to 19 and 28 to 38).

### Acceptance

- [ ] Every organisation has one code for each of the eight roles after the migration, and a new organisation gets them on creation.
- [ ] An organisation whose Accounting tab already names a receivables account keeps it as debtors control, and no second debtors account is created.
- [ ] A receivables choice typed as Income stops the migration and is listed.
- [ ] Where no choice exists and code `1100` is taken by something else, debtors control becomes `1100-1` and is listed.
- [ ] The Accounting tab shows and changes roles through `system_role`, and the old columns no longer exist.
- [ ] A Current Liability code cannot take the role `vat_input`.
- [ ] The debtors control code cannot be chosen on a sales line, a purchase line, a product or a manual journal.
- [ ] Every bank account has its own Current Asset code, and two bank accounts cannot share one.
- [ ] Products accept a Cost of Sales purchase GL.

---

## Phase 2: mode and journal tables (release A)

### 2.1 Mode and period columns

Add to `organisation_defaults`:

| Column | Rule |
| --- | --- |
| `ledger_mode` | `feed` or `book`. Default `feed` |
| `ledger_start_date` | Nullable date. The go-live date (L11) |
| `lock_exported` | Boolean. Set from the mode when the mode is first set (on for `feed`, off for `book`), and editable by owners and admins afterwards |
| `exported_through` | Nullable date. Written only by the export functions |

`ledger_mode` changes only through `set_ledger_mode` (L3). `exported_through` only moves forward.

### 2.2 `journal_entries`

| Column | Rule |
| --- | --- |
| `id`, `tenant_id`, `organisation_id` | Common columns |
| `entry_number` | Bigint, unique per organisation. Issued at posting (L16). Null on manual drafts |
| `entry_date` | Required |
| `status` | `draft` or `posted`. System entries are inserted as `posted`. Only manual journals are ever `draft` |
| `source_type` | `document`, `payment`, `allocation`, `manual`, `reversal` |
| `source_header_id` | Composite key to `transaction_headers`, for `document` |
| `source_payment_id` | Composite key to `payments`, for `payment` |
| `source_allocation_id` | Composite key to `allocations`, for `allocation` |
| `reverses_entry_id` | Composite key to `journal_entries`, for `reversal`. Unique: an entry is reversed at most once |
| `source_ref` | Text up to 60. The document, payment or journal number, so grids and exports read without a join |
| `is_opening` | Boolean, default false. True for the opening balance journal. At most one per organisation |
| `description` | 1 to 200 |
| `backfilled` | Boolean, default false. True for entries made by phase 5 |
| `posted_at`, `posted_by` | Set at posting |

Checks:

- Exactly the source column that matches `source_type` is set. `manual` sets none. A reversal also sets the source column of the entry it reverses, so a document's entries are found together.
- A posted entry has `entry_number`, `posted_at` and at least two lines.

### 2.3 `journal_lines`

| Column | Rule |
| --- | --- |
| `id`, `tenant_id`, `organisation_id` | Common columns |
| `entry_id` | Composite key to `journal_entries`, `ON DELETE CASCADE` for drafts only |
| `line_number` | From 1, unique per entry |
| `gl_code_id` | Required, active at the time of posting |
| `department_id`, `cost_centre_id` | Optional |
| `debit`, `credit` | `numeric(18,2)`, both 0 or more, exactly one greater than 0. In the home currency |
| `currency_id`, `exchange_rate`, `foreign_amount` | The document currency, its rate and the signed amount in it (positive for a debit). For home-currency lines, the home currency, 1 and the home amount |
| `customer_id`, `supplier_id` | Optional, at most one. Set on control lines from documents and payments |
| `vat_category`, `vat_percentage`, `vat_taxable_home` | Set on VAT lines only, from the VAT breakdown, so the VAT returns spec reads them without going back to the documents |
| `description` | Up to 200 |

### 2.4 Rules, enforced by trigger

- **Balance.** A constraint trigger deferred to the end of the transaction refuses any posted entry whose debits differ from its credits. Each posting function also checks the balance itself before it returns, so the message is readable (rule 2 of the agent rules).
- **Immutability.** Posted entries and their lines cannot be updated or deleted by anyone. Draft manual journals can be edited and deleted by owners and admins.
- **Lock date.** No entry may be posted with an `entry_date` on or before the lock date, except the backfill, which uses a migration-only setting. A reversal is dated by L6 and so always passes.
- **Writes.** No direct insert, update or delete for `authenticated` on either table. All writes go through security definer functions and triggers, which set `fintran.ledger_post`.
- **Numbers.** `entry_number` comes from a per-organisation counter row, locked with `SELECT ... FOR UPDATE` last in the lock order, inside the posting transaction.

### 2.5 Indexes

`(organisation_id, entry_date)`, `(organisation_id, gl_code_id, entry_id)` on lines and each source column.

### Acceptance

- [ ] An entry whose debits and credits differ by €0.01 is refused (the test sets constraints immediate).
- [ ] A line with both a debit and a credit, or neither, is refused.
- [ ] Updating or deleting a posted entry or line is refused, including by the table owner inside a test transaction.
- [ ] An entry dated on or before the lock date is refused.
- [ ] Authenticated users cannot insert journal rows directly.
- [ ] A member, and a member of another organisation, see no journal rows. An owner or admin of another organisation sees none either.
- [ ] A second reversal of the same entry is refused.

---

## Phase 3: posting documents (release B)

### 3.1 When

| Event | Entry |
| --- | --- |
| A document becomes `posted` | One `document` entry, dated `transaction_date` |
| A document becomes `void` | One `reversal` of that entry, dated by L6 |
| Orders, requisitions, drafts | Nothing |

The trigger fires on the update that `post_document` and `void_document` already make in one statement, so it sees the full row: document number, snapshots, home amounts and rounding. It runs after the approval and readiness checks, so a refused post builds nothing.

### 3.2 GL code at posting (L8)

In release B a line with no GL code posts to the suspense account, with ` (no GL code)` on its description, and is listed. In release C, `post_document` refuses an invoice or credit note when any line has no GL code, naming the lines, and the readiness panel shows it as an error in both directions. The e-invoice import already asks for a GL code per line. Make it required there too.

### 3.3 Posting rules

**Sales invoice**

| Line | Debit | Credit |
| --- | --- | --- |
| Debtors control (customer set) | Home total plus home rounding | |
| Each document line's GL code, department and cost centre | | That line's home nett |
| VAT on sales, one line per VAT breakdown row | | That row's home VAT |
| Rounding | The balancing difference, on whichever side makes the entry balance | |

**Purchase invoice**

| Line | Debit | Credit |
| --- | --- | --- |
| Each document line's GL code, department and cost centre | That line's home nett | |
| VAT on purchases, one line per VAT breakdown row | That row's home VAT | |
| Creditors control (supplier set) | | Home total plus home rounding |
| Rounding | The balancing difference, on whichever side makes the entry balance | |

**Credit notes** post the mirror of the matching invoice.

"Home rounding" is the document's BT-114 `rounding_amount` converted at the document rate. The control line is `home_total_amount` plus that figure. The rounding line is whatever remains to balance, so it is zero for a home-currency document with no BT-114 and may be a cent or two otherwise. A line or VAT row with a zero amount is left out. A negative figure on any side moves to the other side, so no line carries a negative amount.

### 3.4 Home amounts

The header's home figures are the truth. Split them so the entry matches them exactly:

- `home_nett_amount` is spread across the document lines in proportion to each line's nett, by largest remainder, so the parts add up exactly.
- `home_vat_amount` is spread across the VAT breakdown rows the same way.
- The control line takes `home_total_amount` plus the home rounding.
- Any remaining difference goes to the rounding account.

### Acceptance

- [ ] A €1,000 nett sales invoice at 23% posts Dr debtors €1,230, Cr income €1,000, Cr VAT on sales €230.
- [ ] A purchase invoice with two lines on different GL codes, departments and cost centres posts each to its own code and dimensions.
- [ ] A sales invoice with 23% and 13.5% lines posts two VAT lines, each with its category, percentage and taxable amount.
- [ ] A £100.00 sales invoice at rate 0.85 posts in euro and balances, with the debtors line equal to the header's home total.
- [ ] A foreign-currency document with BT-114 set balances, with the debtors line equal to home total plus home rounding.
- [ ] Three lines whose home figures do not divide evenly still balance, with any difference on the rounding account.
- [ ] A line with no GL code posts to suspense in release B. In release C it is refused, naming the line, and issues no number.
- [ ] Voiding a purchase invoice posts an exact reversal. A document in an open, unexported period reverses on its own date. One in an exported period reverses on the void date.
- [ ] Orders and drafts create no journal entries.
- [ ] A document posted by an imported draft, by Ask Qula's confirmed post and by a payment run's credit note application each produce exactly one entry.

---

## Phase 4: posting payments and allocations (release B)

### 4.1 Payments

| Event | Entry |
| --- | --- |
| A payment becomes `posted` | One `payment` entry, dated `payment_date` |
| A payment becomes `void` | One `reversal`, dated by L6. Its allocations are removed first, which reverses their exchange entries (4.2) |

| Payment | Debit | Credit |
| --- | --- | --- |
| Customer receipt | Bank account's GL code | Debtors control (customer) |
| Supplier payment | Creditors control (supplier) | Bank account's GL code |
| Customer refund | Debtors control (customer) | Bank account's GL code |
| Supplier refund | Bank account's GL code | Creditors control (supplier) |

Both lines take the payment's `home_amount`. Unallocated money stays in the control account as money on account, which is correct. A migrated payment posts its bank side to suspense (L17).

### 4.2 Allocations and exchange differences

An allocation between two items in the same control account needs no entry, except to clear the exchange difference the payments spec records.

| Event | Entry |
| --- | --- |
| An allocation becomes effective with `exchange_difference` not 0 | One `allocation` entry, dated `allocation_date` |
| That allocation is removed | One `reversal`, dated by L6 |

| Line | Debit | Credit |
| --- | --- | --- |
| The control account of the target, party set | The gain | |
| Exchange differences | | The gain |

A loss (negative `exchange_difference`) swaps the sides. In every allowed pair the difference is exactly what is left in the control account after source and target have both posted.

Worked example from the payments spec: a £100.00 sales invoice at 0.85 posts debtors €117.65. The receipt at 0.86 credits debtors €116.28. The exchange difference is −€1.37, so the allocation posts Dr exchange differences €1.37, Cr debtors €1.37, and the customer's debtors balance is €0.00.

### Acceptance

- [ ] A €1,230 customer receipt posts Dr bank €1,230, Cr debtors €1,230.
- [ ] A supplier payment, customer refund and supplier refund each post the lines in 4.1.
- [ ] The worked example posts −€1.37 to exchange differences and leaves the customer's debtors balance at €0.00.
- [ ] The same figures on a purchase invoice post a €1.37 gain and leave the supplier's creditors balance at €0.00.
- [ ] Three partial allocations at different rates leave the control account equal to the remaining home amounts.
- [ ] Removing an allocation posts an exact reversal. A same-currency allocation posts nothing.
- [ ] Voiding a payment reverses its entry and the exchange entries of its allocations.
- [ ] A payment run of two suppliers posts one entry per payment.
- [ ] A migrated payment posts its bank side to suspense.

---

## Phase 5: backfill and reconciliation (release B)

### 5.1 Backfill function

`public.ledger_backfill(p_organisation_id uuid)`, security definer, owner or admin, idempotent. A migration calls it for every organisation, and it can be rehearsed and re-run. It:

1. Lists, and does not stop for, posted or void lines with no GL code (they post to suspense) and migrated payments (they post to suspense).
2. Stops, listing the rows, if any posted document's header home figures do not add up as 3.4 expects. Posted documents are never changed to fit.
3. In date order and then creation order, posts: every posted or void invoice and credit note (and the reversal for void ones), every posted or void payment (and its reversal), and every effective or removed allocation with an exchange difference (and its reversal).

Every backfilled entry has `backfilled = true` and bypasses the lock date through a migration-only setting. Numbers follow that order (L16). A backfilled reversal uses the date the void or removal actually happened, not L6, because the history is what it was.

### 5.2 Already exported (L10)

For every source and stage in an existing `journal_batch_lines` row, mark the matching backfilled entry exported in the same batch. `exported_through` is set from the latest existing batch. No existing batch is changed.

### 5.3 Reconciliation

`public.ledger_reconciliation(p_organisation_id uuid)`, owners and admins, returns one row per check:

| Check | Must be equal |
| --- | --- |
| Debtors | The debtors control balance, and the sum over customers of posted sales invoices' `home_amount_due` less posted sales credit notes' `home_amount_due` less posted customer receipts' `home_unallocated_amount` plus posted customer refunds' `home_unallocated_amount` |
| Creditors | The same for suppliers and creditors control |
| Bank | Each bank account's balance from system entries (document, payment, allocation and their reversals) and its posted receipts less posted payments in home amounts. Manual journal movements on a bank account are shown on their own row and are not part of the check |
| Balance | Total debits and total credits across the whole ledger |

Each row gives both figures and the difference. **Worth a look** adds a finding when any difference is not 0: "The ledger does not agree with customer balances." Owners and admins see it.

### Acceptance

- [ ] After the backfill on a copy of the live project, every reconciliation difference is 0 and every entry balances.
- [ ] Running the backfill twice creates no second entry.
- [ ] Backfilled entries for documents dated before the lock date are present and marked.
- [ ] Lines that had no GL code are on suspense and listed.
- [ ] Every posted document, payment and allocation with an exchange difference has exactly one entry, and every void or removed one also has exactly one reversal.
- [ ] Entries matched to an existing journal batch are marked exported, and a new journal batch does not include them.
- [ ] A manual journal on a bank account does not make the Bank check fail.

---

## Phase 6: enforcement and period rules (release C)

### 6.1 Requirements switch on

- The GL code on every invoice and credit note line (3.2). Suspense now only receives backfilled history.
- Bank account GL codes, already enforced from release A.

### 6.2 Period rules

- **Reversal date (L6).** Implemented in one function, `private.reversal_date(organisation_id, entry_date)`: the entry date when it is after the lock date and after `exported_through`, otherwise the date of the void or removal, which must itself be after the lock date. A void already refuses a document dated on or before the lock date, so only the exported case reaches the second branch.
- **Exported periods (L7).** With `lock_exported` on, `post_document`, `post_payment` and an allocation refuse a date on or before `exported_through`: "This date is in a period that has been exported. Use a later date." With it off, the action goes ahead and the owner sees a Worth a look finding listing documents posted into exported periods since the last export.
- **Setting.** Owners and admins change `lock_exported`. The change is audited.

### 6.3 The mode switch

`set_ledger_mode(p_organisation_id, p_mode, p_reason)`, owners only (L3). The Organisations screen shows the mode, what each mode changes and the preconditions that block a switch, each with a link to fix it. A change is audited with its reason.

### Acceptance

- [ ] A purchase or sales document with a line missing a GL code cannot be posted. The readiness panel shows it as an error.
- [ ] An imported e-invoice draft cannot be posted until every line has a GL code.
- [ ] Voiding a document dated in an open, unexported period reverses on the original date. Voiding one in an exported period reverses on the void date.
- [ ] With `lock_exported` on, posting a document dated inside an exported period is refused. With it off it posts and the finding appears.
- [ ] A void is never refused by `lock_exported`.
- [ ] A member cannot change the mode or the setting. An admin can change the setting but not the mode. An owner changes the mode and the reason is in the change history.
- [ ] Switching to `book` without a go-live date and an opening journal or waiver is refused. Switching to `feed` with a draft manual journal is refused.

---

## Phase 7: manual journals and opening balances (release C)

### 7.1 Functions (owners and admins, L12)

| Function | Behaviour |
| --- | --- |
| `save_manual_journal(p_journal jsonb) returns uuid` | Inserts or replaces a draft: date, description and lines (GL code, debit or credit, department, cost centre, description). Home currency only |
| `post_manual_journal(p_entry_id uuid)` | Checks it balances, has at least two lines, uses no control account (L13), uses only active codes and is dated after the lock date and after `exported_through` when `lock_exported` is on. Issues the number and posts |
| `delete_manual_journal(p_entry_id uuid)` | Drafts only |
| `reverse_journal(p_entry_id uuid, p_date date, p_description text)` | Manual journals only. Posts a `reversal` on the given date, on or after the original date and after the lock date. For accruals and prepayments |

A manual journal may post to bank account codes, VAT accounts, suspense and any ordinary code. This covers bank charges, interest and VAT adjustments until the bank and VAT specs give them proper screens.

### 7.2 Opening balance journal

`post_opening_journal(p_journal jsonb)` posts a manual journal flagged `is_opening`, dated the day before `ledger_start_date`. It may not touch control accounts, because opening debtors and creditors are entered as ordinary documents dated before go-live. It can be posted once. Spec 10 may add a dedicated route for opening debtors and creditors.

### Acceptance

- [ ] An owner posts a balanced manual journal with departments and cost centres, and it gets the next entry number.
- [ ] A member cannot save or post one. An admin can.
- [ ] An unbalanced draft cannot be posted. A journal touching debtors control is refused.
- [ ] Reversing an accrual on the first day of the next month posts the mirror entry on that date.
- [ ] A posted manual journal cannot be edited or deleted. A draft can.
- [ ] The opening balance journal posts once, dated the day before go-live, and is refused if it touches a control account.

---

## Phase 8: screens (release C)

Follow `AGENTS.md` and the UI rules in `TECHNICAL.md`. Owners and admins only (L12).

### 8.1 GL codes

- The account type picker shows the eight types grouped by report section.
- System role is read-only with a short explanation. Control accounts are marked and cannot be chosen in line pickers.
- An Active switch, and the external code and name fields, with a note on what they are for.

### 8.2 Journals

- **Ledger** on the main menu: a **Journals** grid with number, date, source, description, total and a link to the source. Filters by date, source type and GL code. A grid for an entry shows its lines and its reversal.
- **New journal** opens a manual journal form in the document shell: header on the left, line grid on the right, live debit and credit totals and the difference in the status row. Footer: Delete (draft) on the left, Cancel, Save and Save and post on the right. A posted manual journal shows **Reverse**.

### 8.3 Ledger on documents and payments

Posted documents and payments gain a **Ledger** tab listing their entries, with links.

### 8.4 Trial balance and account enquiry

- **Trial balance**: for a date range, each GL code with opening balance, debits, credits and closing balance, grouped by report section, with totals that must agree. Filters for department and cost centre. Excel export through the shared helpers. A working check, not the reports spec.
- Clicking a code opens **Account enquiry**: its lines with a running balance and links to each entry.
- The reconciliation from 5.3 is at the top of the trial balance, with a green tick when every difference is 0.
- **Ledger export:** a full download of the chart of accounts and every entry as CSV, in both modes, so an accountant can take the data away.

### Acceptance (also as end-to-end flows)

- [ ] Post a sales invoice, record and post a receipt, then see both entries in Journals and on each document's Ledger tab.
- [ ] The trial balance totals agree, and debtors control shows 0 for the customer once the invoice is paid.
- [ ] An owner posts and reverses a manual accrual. A member sees neither the Ledger menu nor the Ledger tab.
- [ ] The account enquiry's running balance matches the trial balance closing figure.
- [ ] The full ledger download contains every posted entry once.

---

## Phase 9: the feed (release D)

### 9.1 What it sends (L9)

A feed batch carries, for the organisation, everything posted and not yet fed:

| Item | Content |
| --- | --- |
| Document | A posted invoice or credit note, sales or purchases, from its snapshot: party, dates, currency and rate, reference, lines (description, quantity, unit price, discount, GL code with its `external_code`, department, cost centre, VAT category and percentage), VAT breakdown and totals |
| Payment | A posted receipt, payment or refund: party, date, amount, currency, bank account with its external code, reference and the allocations that settled documents |
| Allocation | An application, including credit notes applied to invoices, with its exchange difference |
| Cancellation | A void document, payment or removed allocation, referring to the item it cancels |

Orders, requisitions, drafts and manual journals are not in it. Manual journals travel by the journal CSV.

### 9.2 Tables and functions

- `feed_batches`: number `FD-0001`, up-to date, counts, who and when. Immutable.
- `feed_items`: batch, `item_type` (`document`, `payment`, `allocation`, `cancellation`), the source ids, `payload` jsonb (the item as made, so a download is the same later), `idempotency_key` (source id and stage, unique per organisation), `status` (`pending`, `exported`, `acknowledged`, `rejected`), `external_reference` and `error`.
- `public.feed_preview(p_organisation_id, p_up_to)` and `public.create_feed_batch(p_organisation_id, p_up_to)`, owners and admins. A batch sets `exported_through` (L7).
- Status moves `pending` to `exported` when the batch is made, and to `acknowledged` or `rejected` by an owner or admin until a connector does it. A rejected item can be put in a new batch and keeps its history.
- The same payload builders are the interface a connector will use.

### 9.3 Journal export refit

- `create_journal_batch` takes stored `journal_entries` not yet exported, up to the date, instead of calling `private.journal_lines`, which is dropped. The CSV columns do not change. A reversal is the stored reversal entry.
- The problems list loses the checks the ledger now enforces upstream (control account not set, bank account with no GL code, line with no GL code).
- `journal_exports` gains the entry id. Existing rows keep their source ids (5.2).
- The Journal export screen and the new Feed screen share one Export area under Admin. An organisation in `feed` mode sees Feed first. An organisation in `book` mode sees the Ledger first and can still export.

### Acceptance

- [ ] A feed batch of a sales invoice, a purchase invoice, a receipt and a credit note application contains each once, with GL codes, external codes, VAT and totals that reconcile.
- [ ] A document posted after the batch is in the next one and not the first. A void is a cancellation item referring to the original.
- [ ] Making the same batch twice finds nothing new.
- [ ] A rejected item is put in the next batch.
- [ ] A batch sets `exported_through`, and with `lock_exported` on a document dated before it cannot then be posted.
- [ ] The journal export after the refit produces the same CSV as before for the same posted data (flows 35 to 38 still pass).
- [ ] A manual journal is in the journal CSV and not in the feed.

---

## Build notes, release A

Release A (phases 1 and 2) is built in migrations `20261125100000_ledger_chart_of_accounts` and `20261125101000_ledger_journal_tables`, with tests `supabase/tests/ledger_chart.sql` and `ledger_journal.sql`. What differs from the text above:

- **The Accounting tab columns stay as a mirror.** Section 1.4 says the old role columns are dropped in the same release. The journal export still reads them, so they stay until phase 9 refits the export, and a trigger writes them from `system_role`. A direct write to them is refused. The start date is not renamed until phase 9 either.
- **A role account is never made inactive,** not only once journal lines use it, and it cannot be deleted by hand. An account the ledger has used cannot change role. Any other account, bank account codes included, can still be made inactive.
- **A bank account's GL code is created by a trigger** when a new bank account names none, so the bank account form, the seed and the tests needed no change. The form's option to choose an existing unused code comes with the screens in release C.
- **A bank account code cannot hold a system role,** and a role account cannot be a bank account's code.
- **`ledger_counters`** is a small table of its own for the entry numbers. It is locked last in the lock order.
- **`set_ledger_mode` and the new-organisation mode choice** are release C (phase 6.3). Until then every organisation is `feed`.
- **Tests changed.** `journal_export.sql`, `bank_accounts.sql`, `sales_phase6.sql`, the concurrency scripts, the end-to-end seed and flow 35 assumed an organisation has no default accounts, and were updated. The journal export scenarios about an unset account no longer exist, because every organisation now has all eight.
- **The end-to-end flows were not run** for this release, because they need the full local stack. Flow 35 and the seed were changed by reading the code.
- **Screens.** Only the Accounting tab and the GL code grid (eight account types, a System role column) changed. The Active switch, the external code fields and the control account markers are phase 8.

## Out of scope

- Periods and year-end close (spec 10), including a dedicated route for opening debtors and creditors
- Profit and loss, balance sheet and other formatted reports
- VAT returns, self-accounting for reverse charge, non-deductible VAT and Irish cash receipts basis
- Bank reconciliation and bank statement import
- Foreign-currency manual journals and period-end revaluation
- Fixed assets, accruals schedules and depreciation
- Consolidation and intercompany
- Connectors to Xero, Sage and QuickBooks, and anything that waits on a provider decision. The feed is built so a connector only maps payloads and updates item status
- A read-only accountant role and maker-checker approval of manual journals
- Ask Qula ledger tools

## Open questions

These are defaults above that you may want to change before building:

1. A new organisation defaults to `book` and an existing one to `feed` (L2).
2. Backfilled entries take the next numbers in date order (L16).
3. Manual journals are allowed in both modes and travel by the journal CSV in feed mode (L9).
4. `lock_exported` defaults on in feed mode and off in book mode (L7).
5. Members see no ledger data at all (L12).

## Done when

- [ ] All SQL, unit and end-to-end tests pass on a fresh database built from all migrations in order, and every test that posts ends with a clean reconciliation.
- [ ] The release B migration runs on a copy of the live project with every reconciliation difference 0 and its review lists produced, before release C is built.
- [ ] Types are regenerated.
- [ ] `TECHNICAL.md`, `CORE.md`, `docs/QULA_PLUS_REFERENCE.md` and the journal export spec describe the ledger, the modes, the posting rules, system roles, manual journals, the reconciliation and the feed, and drop "no ledger, by design" from the gaps and fixed points.
