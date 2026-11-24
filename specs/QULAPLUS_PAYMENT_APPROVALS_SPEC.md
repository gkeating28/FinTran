# Qula Plus payment approvals, supplier bank details and payment run spec

Version 1, 19 November 2026. Built and applied to the hosted project: migrations `20261119123844_supplier_bank_details`, `20261119124618_payment_approvals` and `20261119131003_payment_runs`, with end-to-end flows 28 to 34. The acceptance boxes below have not been ticked one by one against their tests, so unticked does not mean unbuilt. The four scoping answers are recorded below.

Goal: let an organisation say that a payment of money out above a set amount, or to a supplier whose bank details have just changed, must be approved by someone senior before it is posted, and let a person pay many suppliers in one controlled batch, a payment run, that is approved as a whole. This is the spec after approvals and price tolerance and before journal export in the agreed order.

Read `docs/QULA_PLUS_REFERENCE.md`, `CORE.md`, `TECHNICAL.md`, `specs/QULAPLUS_APPROVALS_SPEC.md` and `specs/QULAPLUS_PAYMENTS_SPEC.md` first. This spec reuses the approvals machinery (rules table and screen, roles, fingerprint, emails, Worth a look) and the payments tables. Where it says "as for documents" it means the approvals spec.

## Rules for the agent

The rules from the earlier specs still apply: new migrations only, rules enforced in Postgres, no service-role key, security definer functions with `search_path = ''`, British spelling, SQL tests for every acceptance criterion, regenerate types, and update the documentation after each phase (`npm run check:docs` must pass). Each phase must leave behaviour that is not mentioned in it unchanged, and with no rule set and no bank change window set, nothing changes for anyone.

## Answers to the scoping questions

| # | Question | Answer | How the spec reads it |
| --- | --- | --- | --- |
| 1 | Which payments | **Money out only** | Supplier payments and customer refunds (kind `payment`). Receipts and supplier refunds (kind `receipt`) are never held back (B1) |
| 2 | What triggers approval | **Amount, plus a change of supplier bank details** | The amount rules, and a second trigger: a payment to a supplier whose bank details changed recently. The app holds no supplier bank details today, so this spec adds them first (phase 1) |
| 3 | Payment run | **Build a payment run now** | A payment run is built here (phase 4). It does not exist today: one payment can settle several invoices of one supplier, and that is all |
| 4 | Who decides and who is told | **Stricter for payments** | The person who asked can never approve, even when they are the only owner. The same emails and switch as documents (B6) |

## What exists today that this changes

| Place | Today | Under this spec |
| --- | --- | --- |
| `post_payment` | Any member can post a draft payment. It is the only way a payment becomes posted | Refuses a money-out payment that needs approval and has not got it, and a payment that belongs to a run (post the run instead) |
| Suppliers | Name, address, VAT number, Peppol ID, currency, terms, contact details. No bank details | Adds IBAN, BIC and account name, with a history of changes |
| `approval_rules` | Rules for purchase invoice and purchase order types only | Also for payment types of kind `payment` |
| Payments screen | One payment at a time, with its allocations | Unchanged for one payment. Adds Request approval, Approve and Refuse, and a Payment runs screen |
| `email_outbox` | Emails about documents (`header_id`) | Also about a payment or a run |

## Decisions taken in this spec

| # | Decision | Default chosen |
| --- | --- | --- |
| B1 | What is covered | Payments of kind `payment`: supplier payments (Purchases) and customer refunds (Sales). Not receipts, supplier refunds or documents. Voiding a posted payment stays owner or admin as today and is not gated |
| B2 | What is held back | **Posting** a payment, and posting a run. Creating, editing, deleting and planning allocations on a draft stay free for any member |
| B3 | Rules | The same `approval_rules` table and screen: for a payment type, an amount in the home currency and the role that must approve at or above it, as a ladder. The amount compared is the payment's home amount (`home_amount`). With no rule, nothing changes |
| B4 | Approver level | As for documents: the role must be at least the rule's, in the order member, admin, owner. An owner can approve anything an admin can |
| B5 | An approval is for one version | A fingerprint of the payment (supplier or customer, bank account, date, amount, currency, rate, means, reference) and its planned allocations (target and amount). Any change cancels the approval. Saving without changing does not |
| B6 | Separate people, stricter | The person who requested approval can never approve or refuse it. The consequence is that an organisation with one owner and no admin cannot approve its own large payment: it must add a second person with a high enough role, or an owner can change the rule, which is recorded in the audit log |
| B7 | Rejection | As for documents: a reason is required, the payment can be changed and asked again, and the reason is shown to the requester |
| B8 | Supplier bank details | New fields on a supplier: `iban`, `bic` and `bank_account_name`. The IBAN is checked and tidied by the same function bank accounts use (`private.prepare_iban`). It does not have to be unique, because suppliers can share a bank. All three are optional |
| B9 | Bank change history | Every change to a supplier's IBAN, BIC or account name is recorded in `supplier_bank_changes` with who, when, the old and new values, and the audit log. The first time details are set, from nothing, is not a change |
| B10 | Bank change window | One setting on the Organisations screen, `bank_change_days` (whole days, 1 to 90, blank means off). While a supplier's latest change is newer than the window, a money-out payment to that supplier needs approval from an admin or owner whatever its amount. It applies whether or not the payment type has amount rules. Blank by default, so nothing changes until an owner or admin sets it |
| B11 | Payment run | A batch of draft supplier payments made together: one bank account, one currency, one payment type, a payment date, and the posted supplier invoices chosen for it. Each supplier with chosen invoices gets one draft payment that allocates the full amount open on each chosen invoice. A run has a number, a status (`draft`, `posted`, `cancelled`) and a total |
| B12 | Approving a run | The run is approved as a whole, not each payment. The amount compared with the rules is the run's total in the home currency, using the rules of the run's payment type. A run also needs admin approval when any supplier in it is inside the bank change window, and the screen lists which. Any change to the run, its payments or their allocations cancels the approval |
| B13 | Posting a run | One action posts every payment in the run, in one transaction, or none of them. A payment that belongs to a run cannot be posted on its own |
| B14 | Changing a run | While a run is a draft, a payment can be taken out of it (the payment stays as an ordinary draft), a supplier can be dropped from it and a run can be cancelled, which deletes its draft payments. A posted run cannot be changed, and voiding one of its payments is done on that payment as today |
| B15 | Run output | The run screen exports to Excel: supplier, IBAN, BIC, account name, amount, reference and the invoices paid. There is no bank file (SEPA) in this spec. Paying the money is done outside Qula Plus, as today |
| B16 | Ask Qula | It cannot request or give approval, and it has no action that posts a payment or a run. Searching payments shows each draft's approval state, and it can list runs waiting for approval |
| B17 | Notification | As for documents: the app (home count, Worth a look, list filter) and email through `email_outbox` with the same adapter, switch and failed-email list |
| B18 | Audit | Every request, approval and refusal on a payment or a run, every change to supplier bank details and every run action is recorded with who, when and the note |
| B19 | Existing data | No organisation has a payment rule, a bank change window, supplier bank details or a run at the time of the migration. Existing drafts and posted payments are unaffected |

## Phase 1: supplier bank details

### 1.1 Columns and history

- Add `iban`, `bic` and `bank_account_name` (all nullable) to `suppliers`, with the IBAN and BIC checks bank accounts use.
- Add `supplier_bank_changes` (standard scoping, no direct writes by people): the organisation, the supplier, the old and new IBAN, BIC and account name, who and when. A trigger on `suppliers` writes a row when one of the three fields changes from a non-empty value, and does nothing when they are first set.
- Add `bank_change_days` to `organisation_defaults` (null, or 1 to 90). Owners and admins set it, with the lock date.
- `private.bank_changed_recently(p_supplier_id)` says whether the latest change is within the window. Null window means no.

### 1.2 Screens

- The supplier form gets the three fields in the standard record form. A saved supplier's code stays read-only as before.
- The Organisations screen gets the window beside the lock date.
- A supplier's recent bank changes are listed on the supplier form, newest first, for owners and admins.

### Acceptance

- [ ] An IBAN is checked and stored without spaces, in capitals. A wrong IBAN is refused with the message bank accounts give.
- [ ] Setting bank details on a supplier that had none writes no change row. Changing the IBAN, BIC or account name writes one, with the old and new values and who made it.
- [ ] With the window blank, no supplier counts as recently changed. With 14 days, a supplier changed today does and one changed 15 days ago does not.
- [ ] A member can read suppliers, edit the fields and see no change history. An owner or admin sees the history. Nobody can write `supplier_bank_changes` directly.
- [ ] Changes appear in the audit log.

## Phase 2: payment approval rules and the gate

### 2.1 Database

- Relax the rule check so a rule can be for a payment type of kind `payment`, in either direction, as well as a purchase invoice or order type. A type that has rules keeps its direction and kind, as now.
- Add the approval columns to `payments` (the same as `transaction_headers` has) and the same guard so only the approval functions write them.
- `private.payment_approval_check(p_payment_id)` returns whether approval is needed, the role and the reason (`amount`, `bank details` or `amount and bank details`). A payment needs it when it is a draft of kind `payment`, and either an active rule applies to its home amount, or the supplier's bank details changed within the window (a supplier payment only, since a customer has no bank details here).
- `private.payment_approval_hash` is the fingerprint in B5.
- `request_payment_approval`, `approve_payment` and `reject_payment` are the three actions, with the same checks as for documents except B6: the requester is refused whatever the roles in the organisation.
- `post_payment` calls `private.require_payment_approval` after its existing checks, with messages that say what to do.
- `payment_approval_status(p_payment_ids uuid[])` for the screens, and `payment_approval_queue(p_organisation_id)` for Worth a look and the home count.

### Acceptance

- [ ] With no rule and no window, posting a payment behaves exactly as before.
- [ ] A rule of €5,000 for admin on a supplier payment type: a €4,999.99 payment posts for a member and a €5,000.00 one is refused with the request message.
- [ ] A member requests, an admin approves, and then a member posts it.
- [ ] A ladder of €5,000 for admin and €25,000 for owner works as for documents.
- [ ] The requester cannot approve or refuse their own request, even when they are the only owner. The message says someone else has to decide it.
- [ ] A member cannot approve. An admin cannot approve a payment that needs an owner.
- [ ] Changing the amount, the supplier, the bank account, the date or an allocation of a requested or approved payment sets it back to needing approval. Saving without a change does not.
- [ ] A refusal without a reason is refused. A refused payment can be changed and asked again.
- [ ] A payment to a supplier whose bank details changed inside the window needs an admin whatever its amount, with or without amount rules, and the reason says so.
- [ ] A receipt, a supplier refund and a draft of any other kind are never held back.
- [ ] Nobody can write the approval columns directly. A posted payment's approval record cannot change.
- [ ] Requests, approvals and refusals are in the audit log with the note.

## Phase 3: payment screens

- **Rules.** The Approval rules screen offers payment types as well, with a short line saying payments are held back from their amount.
- **Payment form.** The status row says what is needed, as for documents. Where approval is needed the Post button becomes **Request approval** (it saves first, as the other buttons do). An approver sees **Approve** and **Refuse** on a requested payment. The requester sees no Approve button and a line saying someone else must decide.
- **List.** An Approval column and filter on the payments lists, shown only when a draft needs approval.
- **Worth a look and home.** Payments waiting for the person's approval, with the oldest and its amount, and the person's own refused ones. The home count includes them.
- **Email.** Requests, approvals and refusals queue emails as for documents, through `email_outbox`, which gains a `payment_id` and a `run_id`. A row is about a document, a payment or a run, never more than one.

### Acceptance

- [ ] A member sees Request approval where a rule applies, and Post where none does.
- [ ] An approver sees Approve and Refuse only on a requested payment and only with a high enough role. The requester never does.
- [ ] Request approval on a form with unsaved edits saves first, and a failed save does not request.
- [ ] The list filter finds payments waiting for approval, and the home count matches it.
- [ ] A payment waiting for approval appears in Worth a look for an admin and not for a member.
- [ ] A request emails every eligible approver except the requester, and a decision emails the requester. A failed email never stops an approval.

## Phase 4: payment run

### 4.1 Database

- `payment_runs` (standard scoping): organisation, number, payment type, bank account, currency, payment date, status, reference text, the approval columns, total and home total, and who and when.
- `payments.payment_run_id` (nullable) links a draft payment to its run.
- `create_payment_run(p_run jsonb)` creates the run and one draft payment per supplier, with planned allocations for the full open amount of each chosen invoice, in one transaction. It refuses an invoice that is not posted, has nothing open, is in another currency than the run, or is already in another draft run.
- `remove_run_payment`, `cancel_payment_run` and `payment_run_approval` actions (`request_run_approval`, `approve_run`, `reject_run`) as in B12 to B14, and `post_payment_run`, which posts every payment and fails whole.
- A payment in a run reserves what its allocations hold, as a draft payment does today, so the same invoice cannot go in two runs.

### 4.2 Screens

- A **Payment runs** list under Transactions with a status filter and an Add button.
- The run form: choose the payment type, bank account and date, then pick invoices from the posted purchase invoices with an amount due, filterable by due date and supplier, with a total. Save creates the draft payments.
- The run screen lists its payments by supplier with the invoices paid, the bank change warning where it applies, the status row, Request approval, Approve and Refuse, Post run, Cancel run and Export to Excel.

### Acceptance

- [ ] Choosing five invoices of three suppliers creates one run and three draft payments, each allocating the full open amount of its invoices.
- [ ] An invoice already in a draft run, with nothing open, or in another currency is refused with a clear message.
- [ ] A payment in a run cannot be posted on its own. The message says to post the run.
- [ ] A run over a rule's amount, or with a supplier inside the bank change window, cannot be posted until approved. The screen lists the suppliers whose details changed.
- [ ] The requester cannot approve their own run.
- [ ] Taking a supplier out of the run, or changing any payment in it, cancels an approval.
- [ ] Posting the run posts every payment and makes every allocation effective, or posts nothing if one fails (an invoice paid elsewhere since).
- [ ] Cancelling a draft run deletes its draft payments and frees the invoices.
- [ ] The Excel export lists each supplier's bank details, amount and invoices.
- [ ] A member can create and save a run and request approval, and cannot approve it unless their role is high enough and they did not request it.

## Phase 5: Ask Qula and imports

- Ask Qula can search payments with their approval state and list runs waiting for approval. It cannot request or give approval and cannot post a payment or a run.
- The payments help text for Ask Qula says that large payments and payments to suppliers with new bank details need approval.

### Acceptance

- [ ] Ask Qula lists payments and runs waiting for approval and shows each state.
- [ ] Asked to post a payment, it says it cannot and where to do it.

## Phase 6: end-to-end tests

New flows, numbered from 28, each with amounts no other flow uses:

28. An owner sets a payment rule. A member's supplier payment over it cannot be posted. The member requests approval, an admin approves it and the member posts it.
29. The requester cannot approve their own payment, even as the only person with the role. Another admin does.
30. Editing a requested payment cancels the request.
31. Changing a supplier's IBAN inside the window makes a small payment to that supplier need an admin, and a supplier changed outside the window does not.
32. A payment run of invoices for two suppliers is created, approved by an admin who is not the requester, posted, and every invoice shows paid.
33. A payment in a run cannot be posted alone, and removing a supplier from an approved run cancels the approval.
34. With the mock email adapter, a payment request records an email to each approver and none to the requester, and the decision records one to the requester.

### Acceptance

- [ ] All seven flows pass in CI, and the existing flows pass without changes beyond any new setup they need.

## Out of scope

- A bank file for the run (SEPA credit transfer, `pain.001`) and sending it to a bank, and bank feeds. A run is a controlled list that a person pays outside Qula Plus. This belongs with bank statement import and live connectors.
- Approving receipts, supplier refunds, voids and sales documents.
- More than one approver in a chain, named approvers, delegation and out-of-office cover.
- Approval of a change to supplier bank details itself (a second person confirming the new IBAN). The change is recorded and holds payments back for the window, and the record is there if a rule for it is wanted later.
- Runs across several bank accounts or currencies in one go, part payments of an invoice in a run, and scheduled or recurring runs.
- Payment terms discounts, withholding and fees.

## Questions for review

1. **Sole owner (B6).** An organisation with one owner and nobody else cannot approve its own large payment. Is that what you want, or should the sole owner be allowed, as for documents, with the record saying so? Default: as written, never.
2. **Bank change window (B10).** Blank by default (off), 1 to 90 days when set, and it holds back any payment to that supplier whether or not amount rules exist. Is 14 days the figure to suggest on the screen, and should it also apply to the first payment ever made to a supplier? Default: suggest 14, and do not count a first payment.
3. **Run payments (B12).** Approve the run only, not each payment in it. Default: as written.
4. **Run scope (B11).** One bank account, one currency and the full amount open on each invoice. Part payments and mixed currencies wait. Default: as written.
5. **Changing bank details (B9).** The change is recorded and holds payments, but the change itself is not approved. Do you want a second person to confirm a changed IBAN before it takes effect? Default: no, for now.

## Done when

- [ ] All SQL, unit and end-to-end tests pass on a fresh database built from all migrations in order.
- [ ] With no rule, no bank change window, no supplier bank details and no run, every existing flow passes unchanged.
- [ ] Types are regenerated.
- [ ] `CORE.md`, `TECHNICAL.md` and `docs/QULA_PLUS_REFERENCE.md` describe payment approvals, supplier bank details and payment runs, and `npm run check:docs` passes.
- [x] The migrations are applied to the hosted FinTran project, with the date recorded. Applied 19 November 2026 as versions `20261119123844`, `20261119124618` and `20261119131003`. With no rule, no bank change window and no run, nothing changes for anyone.
