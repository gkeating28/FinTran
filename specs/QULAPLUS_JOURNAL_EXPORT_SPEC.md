# Qula Plus journal export spec

Version 2, 20 November 2026. Built, and applied to the hosted project on 19 November 2026. The branch is awaiting merge. The four scoping answers are recorded below. The four review questions were answered with their defaults.

Goal: let an owner or admin send what has been posted in Qula Plus to the organisation's own accounting system as a journal file. Qula Plus has no ledger by design, so accounting stays in the customer's system and this is the route in. This is step 3 of the agreed order (aged debtors and creditors, approvals with price tolerance and payment approvals, journal export, bank statement import, live connectors and bank feeds). It comes after approvals so that what is exported has already passed them.

Read `docs/QULA_PLUS_REFERENCE.md`, `CORE.md`, `TECHNICAL.md`, `specs/QULAPLUS_PAYMENTS_SPEC.md` and `specs/QULAPLUS_PAYMENT_APPROVALS_SPEC.md` first. This spec builds on posted documents, posted payments and their allocations, and the GL codes already on lines and bank accounts.

## Rules for the agent

The rules from the earlier specs still apply: new migrations only, rules enforced in Postgres, no service-role key, security definer functions with `search_path = ''`, British spelling, SQL tests for every acceptance criterion, regenerate types, and update the documentation after each phase (`npm run check:docs` must pass). Each phase must leave behaviour that is not mentioned in it unchanged. Nothing here changes how a document or a payment is posted, numbered, approved or voided.

## Answers to the scoping questions

| # | Question | Answer | How the spec reads it |
| --- | --- | --- | --- |
| 1 | First format | **One generic journal CSV** | One file layout that any accountant can import or map. Xero, Sage and QuickBooks files come after, as layouts over the same journal lines (J14) |
| 2 | What is in the journal | **Documents, payments, exchange differences and reversals** | Posted invoices and credit notes, posted payments, receipts and refunds against the bank account's GL code, the exchange gain or loss on allocations, and a reversal for anything voided or removed after it was exported |
| 3 | VAT | **Two accounts** | One account for VAT on sales and one for VAT on purchases, set once in the accounting settings. An account on each rate can come later (J5) |
| 4 | Control | **Batches by date, owners and admins only** | A batch records what it contained, so nothing exports twice and nothing is missed. A batch can be downloaded again and cannot be run again (J9 to J12) |

## What exists today that this changes

| Place | Today | Under this spec |
| --- | --- | --- |
| Control accounts | Nowhere. GL codes sit on lines and on bank accounts (Current Asset, optional) | An Accounting settings screen maps receivables, payables, VAT on sales, VAT on purchases, exchange gain or loss and rounding to GL codes |
| Line amounts | In the document's own currency. The header has the home totals | The journal converts each line to the home currency and puts the rounding difference on the control account, so every journal balances |
| Posted documents and payments | No record of having been sent anywhere | Each records the batch that exported it, and the batch that exported its reversal if it was voided later |
| Reports | Aged debtors and creditors only | A Journal export screen under Admin, with a preview and the batches |

## Decisions taken in this spec

| # | Decision | Default chosen |
| --- | --- | --- |
| J1 | What is exported | Posted invoices and credit notes (sales and purchases), posted payments, receipts and refunds, the exchange difference on each effective allocation, and reversals. Orders, requisitions, drafts and voided-before-export items are never exported |
| J2 | Who | Owners and admins set up, preview and export. A member sees nothing of it. The batch tables are readable by owners and admins only |
| J3 | Home currency | Every journal line is in the home currency. A line also carries the amount in the document's currency, as information, for the accountant |
| J4 | Control accounts | Six settings: receivables, payables, VAT on sales, VAT on purchases, exchange gain or loss and rounding. Receivables is the control for Sales documents and payments, payables for Purchases. Each bank account's own GL code is the bank line |
| J5 | VAT | The VAT of a document goes to VAT on sales for a Sales document and VAT on purchases for a Purchases document, whatever the rate. Zero and exempt rates have no VAT amount and so no VAT line |
| J6 | A document's journal | A sales invoice: debit receivables for the total, credit each line's GL code for its nett, credit VAT on sales. A purchase invoice: debit each line's GL code, debit VAT on purchases, credit payables. A credit note is the same with debits and credits swapped. Department and cost centre go on the lines that carry a GL code, not on control or VAT lines |
| J7 | Conversion and rounding | Each line's nett is converted at the document's exchange rate and rounded to cents. The last line takes the difference so the lines add up to the header's home nett. VAT is the header's home total less its home nett, so the control line always equals the app's home total (it differs from the header's home VAT only by a cent of conversion rounding). Rounding (`rounding_amount`, converted) goes to the rounding account. The control line is the total of the others, so the journal balances to the cent |
| J8 | A payment's journal | A supplier payment or a supplier refund of money in: debit or credit payables against the bank account's GL code, for the payment's home amount. A receipt or a customer refund: receivables against bank. This is the whole payment, applied or not |
| J9 | Exchange differences | Each effective allocation with an exchange difference writes one journal, dated on the allocation date: the difference between the control account and the exchange account. A credit note applied to an invoice, which moves nothing between accounts, writes a journal only if it has a difference |
| J10 | Reversals | A purchase document voided after it was exported is reversed by a journal dated on the void date. A payment voided after it was exported is reversed the same way, with the exchange differences of its allocations. An allocation removed after it was exported has its exchange difference reversed, dated on the removal date. Anything voided or removed before it was exported is simply left out |
| J19 | Reversals use the exported lines | A reversal is the lines of the original journal as stored in its batch, turned round, with the accounts they were exported to, dated on the void or removal date. It does not recalculate from the settings or the bank account's current GL code, so changing an account after an export cannot send a reversal to a different account. Found in review of the first build |
| J11 | Choosing what goes in a batch | "Everything not yet exported, up to and including this date." The date is a journal date: the document date, the payment date, the allocation date, the void or removal date. Nothing is left behind because it was posted late. A start date in the accounting settings keeps older history out when an organisation goes live |
| J12 | Batches | Creating a batch writes its lines to `journal_batch_lines` and marks every source with the batch, in one transaction. A batch is numbered `JB-0001`. It cannot be changed or deleted. It can be downloaded again exactly as made. A mistake is corrected in the accounting system or by reversing in Qula Plus and exporting again |
| J13 | Ready to export | A batch cannot be made while anything it would contain cannot be journalled: a control account not set, a bank account with no GL code, a line with no GL code, or a payment in a currency with no rate. The preview lists each problem and the document or payment it is on |
| J14 | File | A UTF-8 CSV with a byte order mark, as the other exports. One row for each journal line: batch, journal, date, account code, account name, description, debit, credit, currency, amount in currency, department, cost centre, source kind, source number and party. Text that could be read as a formula is made safe, as the other exports do |
| J15 | Lock date | The lock date stops posting in a period. It does not stop exporting. A batch can contain anything not yet exported |
| J16 | Audit | Setting the accounts, making a batch and downloading one are recorded in the audit log with who and when |
| J18 | Purchase lines with no GL code | A posted purchase line can have no GL code (an imported e-invoice, for one) and cannot be edited. A seventh account in the accounting settings, the suspense account, takes such a line, and its description ends with `(no GL code)` so it can be recoded in the accounting system. With none set the line is a problem, as in J13. Sales lines always have a GL code, so this is for purchases. Added after the first build, at the owner's request |
| J17 | Existing data | No organisation has settings or batches at the time of the migration, so nothing is exported until an owner or admin sets the accounts and makes a batch |

## Phase 1: the accounting settings

### 1.1 Database

- `accounting_settings` (standard scoping, one row for each organisation): the seven GL codes (the six of J4 and the suspense account of J18) as foreign keys to `gl_codes`, an optional start date, and the usual audit columns. Owners and admins read and write it. Members cannot read it.
- A trigger checks that each GL code belongs to the organisation. The VAT and control accounts are not restricted to a type, because accountants differ on how they classify them.
- `journal_problems(p_organisation_id)` is added in phase 2. Phase 1 only stores the settings.

### 1.2 Screen

- Admin gets an Accounting tile and an Accounting screen in the standard record form: the accounts as GL code lists, the start date, and a short line saying what each is for. Owners and admins edit. A member does not see the tile.
- Bank accounts already have an optional GL code. The screen lists the bank accounts that have none, with a link to each.

### Acceptance

- [x] An owner saves the accounts and the start date, and they come back.
- [x] A GL code from another organisation is refused.
- [x] A member cannot read or write the settings, and the database refuses the same calls made directly.
- [x] Saving is recorded in the audit log.
- [x] Clearing an account is allowed, and the preview then reports it as missing.
- [x] A posted purchase line with no GL code is reported while there is no suspense account, and goes to the suspense account, marked `(no GL code)`, once there is one (J18).

## Phase 2: the journal

### 2.1 Database

- `journal_preview(p_organisation_id, p_up_to date)` returns the journal lines for everything not yet exported up to the date, as J6 to J10 describe, without writing anything. Each line has its journal number, date, account, description, debit, credit, currency and amount in currency, department, cost centre, source kind, source number and party, and the source's id.
- `journal_problems(p_organisation_id, p_up_to date)` returns what cannot be journalled (J13), each with the source it is on and a plain message.
- Both are for owners and admins and return nothing to anyone else.

### Acceptance

- [x] Every journal the preview returns balances to the cent: its debits equal its credits.
- [x] A sales invoice of two lines at 100.00 and 50.00 with 23 per cent VAT gives debit receivables 184.50, credit each GL code 100.00 and 50.00, credit VAT on sales 34.50.
- [x] A purchase invoice gives the mirror, with VAT on purchases and payables.
- [x] A credit note gives the same lines with debits and credits swapped.
- [x] A document in a foreign currency is converted at its rate, the lines add up to the header's home nett, and the control line equals the header's home payable.
- [x] A document's rounding amount goes to the rounding account.
- [x] A receipt gives debit bank, credit receivables. A supplier payment gives debit payables, credit bank. A customer refund and a supplier refund mirror them.
- [x] An allocation with an exchange difference gives one journal between the control account and the exchange account, dated on the allocation date. One without a difference gives none.
- [x] A purchase document voided after export gives a reversal on the void date. One voided before export gives nothing.
- [x] A payment voided after export, and an allocation removed after export, are reversed.
- [x] A reversal goes to the accounts the original was exported to, even after a control, VAT or bank account is changed (J19).
- [x] The balance the journal leaves on the receivables account, and on the payables account, equals what the app shows as due, including money on account and credit notes. Tested for the organisation as a whole, not party by party. A document's rounding amount is part of what is owed in the journal and is not in `home_amount_due`, so the two differ by that amount.
- [x] A control account not set, the VAT, rounding and exchange accounts when needed, and a bank account with no GL code are each reported with the document or payment they are on. A line with no GL code cannot be posted and a rate cannot be missing (the column is required), so those two checks cannot be reached and only the first is coded.
- [x] Departments and cost centres are on the lines with a GL code and not on control or VAT lines.
- [x] The start date leaves earlier items out. A late-posted document dated before the last batch is included in the next one.
- [x] A member gets nothing from either function.

## Phase 3: batches

### 3.1 Database

- `journal_batches` (organisation, number, up-to date, created by and at, line count, total debit, total credit) and `journal_batch_lines` (the lines as made). Neither can be written directly, changed or deleted by anyone. Owners and admins can read them.
- What each batch exported is recorded in `journal_exports` (batch, source kind `document`, `payment` or `allocation`, source id, stage `post` or `reversal`), unique on source and stage. This replaces marker columns on the three source tables, so the guards on posted documents, payments and allocations are not touched and nothing about posting changes.
- `create_journal_batch(p_up_to date)` does what J12 says in one transaction, refuses while `journal_problems` has anything, refuses an empty batch, and returns the batch.
- `journal_batch_lines_for(p_batch_id)` returns a batch's lines for download. It writes an audit record.

### Acceptance

- [x] Creating a batch stores the lines and marks every source. Running it again straight away says there is nothing to export.
- [x] A batch with a problem is refused and lists it. Nothing is marked.
- [x] Two people creating a batch at once cannot export the same item twice. An advisory lock for the organisation and the unique key on `journal_exports` enforce it, and `supabase/tests/concurrency/journal_batch.sh` proves it with two connections.
- [x] A batch cannot be changed or deleted, by an owner either, and the database refuses direct writes.
- [x] Voiding an exported purchase invoice puts a reversal in the next batch, and not the same one.
- [x] The lines of a batch are the same when downloaded again later, after the source has changed.
- [x] Numbers keep counting: `JB-0001`, `JB-0002`.
- [x] A member cannot create or read a batch.
- [x] Making and downloading a batch are in the audit log.

## Phase 4: screens and the file

- **Journal export** under Admin: the batches, newest first, with number, date, lines, totals and who made it, each with Download. An Add button opens the preview.
- **Preview.** Choose the "up to" date. It shows the problems first, and each links to the document, payment or setting to fix. When there are none it shows the journals, grouped by journal with their debits and credits and the totals, and a Create batch button that says how many journals and lines it will export.
- **Download** is the CSV in J14, named after the batch, for example `JB-0001.csv`.
- Owners and admins only. A member does not see the tile and is sent back to Admin if they open the address.

### Acceptance

- [ ] The preview shows a problem and a link to fix it, and the Create batch button is not offered while there is one.
- [ ] Creating a batch adds it to the list, and the preview then says nothing is waiting.
- [ ] Download gives a CSV with a header row, one row for each line, amounts with two decimals and debits equal to credits.
- [ ] A name that begins with `=` is exported as plain text.
- [ ] A member does not see the tile and cannot open the screen.

## Phase 5: end-to-end tests

New flows, numbered from 35, each with amounts no other flow uses:

35. An owner sets the accounting accounts. The preview reports a bank account with no GL code, the owner adds one, and the problem goes.
36. A purchase invoice and a supplier payment are posted. The preview shows their journals, balanced, and a batch is created and downloaded.
37. Running the export again says nothing is waiting. Voiding the exported invoice puts a reversal in the next batch.
38. A member does not see the Accounting or Journal export tiles and is refused when calling the database directly.

### Acceptance

- [ ] All four flows pass in CI, and the existing flows pass without changes beyond any new setup they need.

## Out of scope

- Files for Xero, Sage and QuickBooks, and live connectors that send the journal to them. They are layouts or senders over the same journal lines, and come after this.
- A ledger, trial balance or any report that adds up accounts. Qula Plus does not hold balances beyond what is due on documents.
- Fixed assets, stock, payroll, bank statement matching and VAT returns.
- An account on each VAT rate, and different control accounts for different customers, suppliers or currencies.
- Exporting orders, requisitions and drafts.
- Re-running or editing a batch. A mistake is fixed in the accounting system, or by reversing in Qula Plus and exporting the correction.
- Ask Qula reading the journal, and Worth a look for documents that have waited a long time to be exported.

## Review questions, answered

All four took their defaults: (1) journals are dated on the document date, payment date, allocation date and void or removal date, (2) the start date is not required, and the preview says how many journals are over a year old while it is blank, (3) the rounding and exchange accounts are required only when a document has a rounding amount or an allocation has an exchange difference, (4) journals are numbered `JB-0001-0007`, with the document number in the description and its own column.

## Done when

- [ ] All SQL, unit and end-to-end tests pass on a fresh database built from all migrations in order.
- [ ] With no settings and no batch, every existing flow passes unchanged.
- [ ] Types are regenerated.
- [ ] `CORE.md`, `TECHNICAL.md` and `docs/QULA_PLUS_REFERENCE.md` describe the journal export, and `npm run check:docs` passes.
- [x] The migration is applied to the hosted FinTran project: `journal_export`, version `20261119180342`, on 19 November 2026. Checked afterwards: four new tables with no rows, the five functions, seven policies, and no insert, update or delete grant on the batch tables.
